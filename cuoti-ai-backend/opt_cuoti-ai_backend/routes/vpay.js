// routes/vpay.js —— 微信小程序「个人虚拟支付」道具直购（个人主体可开通，无需商户号）
// 链路：前端 wx.requestVirtualPayment(payData) → 平台「发货推送」xpay_goods_deliver_notify → 本服务验幂等发货
//       推送丢失 → 定时 query_order 兜底补发
// 配置（settings.vpay_config）：offer_id / appkey / appid / appsecret / product_single / product_monthly / product_yearly
const express = require('express');
const crypto = require('crypto');
const https = require('https');
const pool = require('../db/pool');
const { userAuth } = require('../middleware/auth');

const router = express.Router();
router.use(userAuth);

// 发货推送路由：来自微信平台，无用户鉴权，独立挂载
const notifyRouter = express.Router();

const XPAY_BASE = 'https://api.weixin.qq.com';

// ---------- 配置 ----------
async function getConfig() {
  const [rows] = await pool.query("SELECT value FROM settings WHERE key_name='vpay_config'");
  if (!rows.length || !rows[0].value) return null;
  try {
    const cfg = JSON.parse(rows[0].value);
    if (!cfg.offer_id || !cfg.appkey) return null;
    return cfg;
  } catch (e) { return null; }
}

async function setConfig(cfg) {
  await pool.query(
    "INSERT INTO settings (key_name, value) VALUES ('vpay_config', ?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
    [JSON.stringify(cfg)]
  );
}

// ---------- HMAC-SHA256 ----------
function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(String(msg), 'utf8').digest('hex');
}

// ---------- 道具 ID ----------
function productIdOf(cfg, plan) {
  if (!cfg || !plan) return '';
  if (cfg['product_' + plan]) return cfg['product_' + plan];
  return cfg.product_id || '';
}

// ---------- code2Session（换 openid + session_key） ----------
function code2Session(cfg, code) {
  return new Promise((resolve, reject) => {
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(cfg.appid)}&secret=${encodeURIComponent(cfg.appsecret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    https.get(url, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

// ---------- 通用 HTTPS POST ----------
function httpsPost(url, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch (e) { resolve({ status: res.statusCode, body: { raw: d } }); } });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

// ---------- 支付状态（前端判断走哪种支付） ----------
router.get('/status', async (req, res) => {
  const cfg = await getConfig();
  res.json({ ok: true, data: { enabled: !!cfg, mode: cfg ? 'vpay' : 'none' } });
});

// ---------- 下单：生成 payData（前端 wx.requestVirtualPayment 参数） ----------
router.post('/order', async (req, res) => {
  const cfg = await getConfig();
  if (!cfg) return res.json({ ok: false, error: '虚拟支付未配置' });
  const { plan, code } = req.body;
  const [plans] = await pool.query('SELECT * FROM voice_plans WHERE plan=? AND is_active=1', [plan || '']);
  if (!plans.length) return res.json({ ok: false, error: '套餐不存在' });
  const p = plans[0];
  const productId = productIdOf(cfg, p.plan);
  if (!productId) return res.json({ ok: false, error: '未配置该套餐对应的道具ID' });
  if (!code) return res.json({ ok: false, error: '缺少登录凭证' });

  // code 换 session_key（用户态签名 signature 用）
  const sess = await code2Session(cfg, code);
  if (!sess.session_key) {
    return res.json({ ok: false, error: '换取会话失败：' + (sess.errmsg || '未知错误') });
  }
  // 绑定 openid
  if (sess.openid) await pool.query('UPDATE users SET openid=? WHERE id=?', [sess.openid, req.user.id]);

  // 唯一业务单号（8-32 位，不以 _ 开头）
  const outTradeNo = 'T' + Date.now().toString() + Math.floor(Math.random() * 1000000);
  const goodsPrice = Math.round(Number(p.price) * 100); // 单位分

  // 落订单（待支付）
  const [r] = await pool.query(
    'INSERT INTO voice_orders (user_id, plan, plan_name, minutes, amount, status, pay_type, trade_no) VALUES (?,?,?,?,?,?,?,?)',
    [req.user.id, p.plan, p.name, p.minutes, p.price, 'pending', 'vpay', outTradeNo]
  );

  // signData：键顺序固定，不能格式化
  const signData = JSON.stringify({
    offerId: cfg.offer_id,
    buyQuantity: 1,
    env: 0,
    currencyType: 'CNY',
    productId,
    goodsPrice,
    outTradeNo,
    attach: String(r.insertId)
  });
  const paySig = hmacSha256(cfg.appkey, 'requestVirtualPayment&' + signData);
  const signature = hmacSha256(sess.session_key, signData);

  res.json({
    ok: true,
    data: {
      order_id: r.insertId,
      trade_no: outTradeNo,
      payData: {
        signData,
        mode: 'short_series_goods',
        paySig,
        signature
      }
    }
  });
});

// ---------- 发货推送接收（平台支付成功后推送 XML） ----------
async function handleNotify(req) {
  const cfg = await getConfig();
  if (!cfg) return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[not configured]]></ErrMsg></xml>';
  let xml = req.body;
  if (xml && typeof xml === 'object') xml = JSON.stringify(xml); // 防御
  xml = String(xml || '');
  // 解析关键字段
  const field = (name) => {
    const m = xml.match(new RegExp('<' + name + '>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</' + name + '>'));
    return m ? m[1].trim() : '';
  };
  const event = field('Event');
  const openid = field('OpenId');
  const outTradeNo = field('OutTradeNo');
  const wxOrderId = field('MchOrderNo'); // WeChatPayInfo.MchOrderNo
  const productId = field('ProductId');   // GoodsInfo.ProductId
  const quantity = parseInt(field('Quantity')) || 1;

  if (event !== 'xpay_goods_deliver_notify') {
    return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';
  }
  if (!outTradeNo) return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[bad payload]]></ErrMsg></xml>';

  // 查单（幂等：已支付/已发货直接成功）
  const [orders] = await pool.query('SELECT * FROM voice_orders WHERE trade_no=?', [outTradeNo]);
  if (!orders.length) return '<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[order not found]]></ErrMsg></xml>';
  const o = orders[0];
  if (o.status === 'paid') return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';

  // 发货：标记已支付 + 加语音包
  await pool.query(
    "UPDATE voice_orders SET status='paid', transaction_id=?, pay_type='vpay' WHERE id=?",
    [wxOrderId || outTradeNo, o.id]
  );
  const { grantVoiceMinutes } = require('./voice');
  let days = 30;
  const [plans] = await pool.query('SELECT duration_days FROM voice_plans WHERE plan=?', [o.plan]);
  if (plans.length) days = plans[0].duration_days;
  await grantVoiceMinutes(o.user_id, o.minutes, days);

  console.log('[vpay] 发货成功 order=' + outTradeNo + ' user=' + o.user_id + ' minutes=' + o.minutes);
  return '<xml><ErrCode>0</ErrCode><ErrMsg><![CDATA[success]]></ErrMsg></xml>';
}

notifyRouter.post('/', async (req, res) => {
  try {
    const xml = await handleNotify(req);
    res.type('application/xml');
    res.send(xml);
  } catch (e) {
    console.error('[vpay] 发货推送处理失败:', e.message);
    res.type('application/xml');
    res.send('<xml><ErrCode>1</ErrCode><ErrMsg><![CDATA[internal error]]></ErrMsg></xml>');
  }
});

// ---------- 兜底查单：转发 /xpay/query_order，已支付则补发货 ----------
router.post('/query', async (req, res) => {
  const cfg = await getConfig();
  if (!cfg) return res.json({ ok: false, error: '虚拟支付未配置' });
  const { trade_no } = req.body;
  if (!trade_no) return res.json({ ok: false, error: '缺少单号' });
  const [orders] = await pool.query('SELECT * FROM voice_orders WHERE trade_no=?', [trade_no]);
  if (!orders.length) return res.json({ ok: false, error: '订单不存在' });
  const o = orders[0];
  if (o.status === 'paid') return res.json({ ok: true, data: { status: 'paid', already_delivered: true } });
  const [[u]] = await pool.query('SELECT openid FROM users WHERE id=?', [req.user.id]);
  if (!u || !u.openid) return res.json({ ok: false, error: '缺少 openid 无法查单' });
  const openid = u.openid;

  const body = JSON.stringify({ openid, env: 0, order_id: trade_no });
  const paySig = hmacSha256(cfg.appkey, '/xpay/query_order&' + body);
  const r = await httpsPost(XPAY_BASE + '/xpay/query_order', {
    'X-AppKey': cfg.appkey,
    'X-PaySig': paySig,
    'Content-Type': 'application/json'
  }, body);

  const st = r.body && (r.body.status || r.body.errcode);
  const isPaid = st === 'PAID' || st === 'SUCCESS' || (r.body && r.body.errcode === 0 && r.body.order_info);
  if (isPaid) {
    // 补发货
    await pool.query("UPDATE voice_orders SET status='paid', transaction_id=?, pay_type='vpay' WHERE id=?",
      [r.body.order_id || trade_no, o.id]);
    const { grantVoiceMinutes } = require('./voice');
    let days = 30;
    const [plans] = await pool.query('SELECT duration_days FROM voice_plans WHERE plan=?', [o.plan]);
    if (plans.length) days = plans[0].duration_days;
    await grantVoiceMinutes(o.user_id, o.minutes, days);
    return res.json({ ok: true, data: { status: 'paid', delivered: true } });
  }
  res.json({ ok: true, data: { status: String(st), delivered: false, resp: r.body } });
});

module.exports = { router, notifyRouter, getConfig, setConfig, handleNotify };
