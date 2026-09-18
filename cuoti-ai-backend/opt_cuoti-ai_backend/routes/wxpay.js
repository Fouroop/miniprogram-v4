// routes/wxpay.js —— 微信支付 APIv3（JSAPI 小程序支付）
// 配置存 settings 表（管理后台可读写），未配置时返回 simulate 模式
const crypto = require('crypto');
const https = require('https');
const pool = require('../db/pool');

const WX_API = 'https://api.mch.weixin.qq.com';
const NOTIFY_URL = (process.env.WXPAY_NOTIFY_URL || '') || undefined;

// ---------- 配置读取 ----------
async function getConfig() {
  const [rows] = await pool.query("SELECT value FROM settings WHERE key_name='wxpay_config'");
  if (!rows.length || !rows[0].value) return null;
  try {
    const cfg = JSON.parse(rows[0].value);
    if (!cfg.mchid || !cfg.apiv3_key) return null;
    return cfg;
  } catch (e) { return null; }
}

async function setConfig(cfg) {
  await pool.query(
    "INSERT INTO settings (key_name, value) VALUES ('wxpay_config', ?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
    [JSON.stringify(cfg)]
  );
}

// ---------- 微信支付回调地址 ----------
function getNotifyUrl() {
  if (NOTIFY_URL) return NOTIFY_URL;
  // 默认：管理后台所在域名 + 回调路径（公网 /cuoti/ 前缀）
  return 'https://zblw.com.cn/cuoti/api/voice/wxpay/notify';
}

// ---------- RSA-SHA256 签名（商户私钥） ----------
function signWithPrivateKey(privateKeyPem, message) {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(message, 'utf8');
  sign.end();
  return sign.sign(privateKeyPem, 'base64');
}

// ---------- 构造微信 API 请求 Authorization 头 ----------
function buildAuthHeader(method, path, bodyStr, cfg) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  const signature = signWithPrivateKey(cfg.private_key, message);
  return `WECHATPAY2-SHA256-RSA2048 mchid="${cfg.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${cfg.serial_no}"`;
}

// ---------- 发起 HTTPS JSON 请求 ----------
function httpsJson(options, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: { raw: data } }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------- AES-256-GCM 解密（APIv3 密钥） ----------
function decryptResource(apiv3Key, resource) {
  const { ciphertext, nonce, associated_data } = resource;
  const key = Buffer.from(apiv3Key, 'utf8');
  const authTag = ciphertext.slice(-16);
  const data = ciphertext.slice(0, -16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  decipher.setAAD(Buffer.from(associated_data, 'utf8'));
  const decoded = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  return JSON.parse(decoded.toString('utf8'));
}

// ---------- 微信平台证书公钥缓存（回调验签用） ----------
let cachedPlatformPubKey = null;
let certFetching = null;

async function fetchPlatformCert(cfg) {
  if (cachedPlatformPubKey) return cachedPlatformPubKey;
  const path = '/v3/certificates';
  const bodyStr = '';
  const auth = buildAuthHeader('GET', path, bodyStr, cfg);
  const r = await httpsJson({
    hostname: 'api.mch.weixin.qq.com', path, method: 'GET',
    headers: { 'Authorization': auth, 'Accept': 'application/json' }
  }, '');
  if (r.status !== 200 || !r.body.data || !r.body.data.length) {
    throw new Error('获取微信平台证书失败: ' + JSON.stringify(r.body).slice(0, 200));
  }
  const item = r.body.data[0];
  const certObj = decryptResource(cfg.apiv3_key, item.encrypt_certificate);
  cachedPlatformPubKey = certObj.certificate; // PEM 格式
  return cachedPlatformPubKey;
}

// 并发保护拉证书
function getPlatformCert(cfg) {
  if (cachedPlatformPubKey) return Promise.resolve(cachedPlatformPubKey);
  if (!certFetching) {
    certFetching = fetchPlatformCert(cfg).finally(() => { certFetching = null; });
  }
  return certFetching;
}

// 清除平台证书缓存（配置变更后强制重拉，用于管理后台连接测试）
function resetPlatformCertCache() {
  cachedPlatformPubKey = null;
  certFetching = null;
}

// ---------- 回调验签（微信支付平台证书） ----------
async function verifyNotifySign(cfg, headers, rawBody) {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  if (!timestamp || !nonce || !signature) return false;
  try {
    const pubPem = await getPlatformCert(cfg);
    const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
    const verify = crypto.createVerify('RSA-SHA256');
    verify.update(message, 'utf8');
    verify.end();
    return verify.verify(pubPem, signature, 'base64');
  } catch (e) {
    console.error('[wxpay] 验签失败:', e.message);
    return false;
  }
}

// ---------- JSAPI 下单 ----------
async function prepay(user, plan, code) {
  const cfg = await getConfig();
  if (!cfg) return { ok: false, error: '微信支付未配置' };

  const [plans] = await pool.query('SELECT * FROM voice_plans WHERE plan=? AND is_active=1', [plan]);
  if (!plans.length) return { ok: false, error: '套餐不存在' };
  const p = plans[0];

  // 1. code 换 openid
  let openid = user.openid;
  if (!openid) {
    if (!code) return { ok: false, error: '缺少登录凭证' };
    if (!cfg.appsecret) return { ok: false, error: '未配置小程序 secret' };
    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${cfg.appid}&secret=${cfg.appsecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const sess = await new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
      }).on('error', reject);
    });
    if (!sess.openid) return { ok: false, error: '换取 openid 失败: ' + (sess.errmsg || '未知错误') };
    openid = sess.openid;
    // 绑定 openid 到用户
    await pool.query('UPDATE users SET openid=? WHERE id=?', [openid, user.id]);
  }

  // 2. 创建待支付订单
  const tradeNo = 'VP' + Date.now() + Math.floor(Math.random() * 1000);
  const amountFen = Math.round(p.price * 100);
  const [r] = await pool.query(
    'INSERT INTO voice_orders (user_id, plan, plan_name, minutes, amount, status, pay_type, trade_no) VALUES (?,?,?,?,?,?,?,?)',
    [user.id, p.plan, p.name, p.minutes, p.price, 'pending', 'wxpay', tradeNo]
  );

  // 3. 统一下单
  const path = '/v3/pay/transactions/jsapi';
  const body = {
    appid: cfg.appid,
    mchid: cfg.mchid,
    description: p.name + '（' + p.minutes + '分钟语音）',
    out_trade_no: tradeNo,
    notify_url: getNotifyUrl(),
    amount: { total: amountFen, currency: 'CNY' },
    payer: { openid }
  };
  const bodyStr = JSON.stringify(body);
  const auth = buildAuthHeader('POST', path, bodyStr, cfg);
  const resp = await httpsJson({
    hostname: 'api.mch.weixin.qq.com', path, method: 'POST',
    headers: { 'Authorization': auth, 'Content-Type': 'application/json', 'Accept': 'application/json' }
  }, bodyStr);

  if (resp.status !== 200 || !resp.body.prepay_id) {
    await pool.query('UPDATE voice_orders SET status=? WHERE id=?', ['fail', r.insertId]);
    return { ok: false, error: '下单失败: ' + JSON.stringify(resp.body).slice(0, 200) };
  }

  // 4. 生成小程序端 wx.requestPayment 参数
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const packageStr = 'prepay_id=' + resp.body.prepay_id;
  const paySignMsg = `${cfg.appid}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`;
  const paySign = signWithPrivateKey(cfg.private_key, paySignMsg);

  return {
    ok: true,
    data: {
      order_id: r.insertId,
      trade_no: tradeNo,
      timeStamp, nonceStr, package: packageStr, signType: 'RSA',
      paySign,
      mode: 'wxpay'
    }
  };
}

// ---------- 支付回调处理 ----------
async function handleNotify(req) {
  const cfg = await getConfig();
  if (!cfg) return { code: 500, body: { code: 'FAIL', message: '未配置微信支付' } };

  const rawBody = JSON.stringify(req.body);
  const headers = req.headers;
  const valid = await verifyNotifySign(cfg, headers, rawBody);
  if (!valid) {
    console.error('[wxpay] 回调验签失败');
    return { code: 401, body: { code: 'FAIL', message: '验签失败' } };
  }

  try {
    const event = decryptResource(cfg.apiv3_key, req.body.resource);
    const { out_trade_no, transaction_id, trade_state, amount } = event;
    if (trade_state !== 'SUCCESS') {
      return { code: 200, body: { code: 'SUCCESS', message: '成功' } };
    }
    const [orders] = await pool.query(
      'SELECT * FROM voice_orders WHERE trade_no=? AND status=?', [out_trade_no, 'pending']
    );
    if (!orders.length) {
      // 订单不存在或已处理，幂等返回成功
      return { code: 200, body: { code: 'SUCCESS', message: '成功' } };
    }
    const o = orders[0];
    // 校验金额（单位分）
    if (amount && amount.total !== Math.round(o.amount * 100)) {
      return { code: 400, body: { code: 'FAIL', message: '金额不符' } };
    }
    // 发货：标记已支付 + 加语音包
    await pool.query(
      "UPDATE voice_orders SET status='paid', transaction_id=?, pay_type='wxpay' WHERE id=?",
      [transaction_id, o.id]
    );
    await grantVoiceMinutes(o.user_id, o.minutes, o.plan);
    return { code: 200, body: { code: 'SUCCESS', message: '成功' } };
  } catch (e) {
    console.error('[wxpay] 回调处理失败:', e.message);
    return { code: 500, body: { code: 'FAIL', message: '处理失败' } };
  }
}

// 回调里用的发货：按套餐时长（订单表无 duration_days，从套餐查）
async function grantVoiceMinutes(userId, minutes, plan) {
  const { grantVoiceMinutes: g } = require('./voice');
  let days = 30;
  if (plan) {
    const [plans] = await pool.query('SELECT duration_days FROM voice_plans WHERE plan=?', [plan]);
    if (plans.length) days = plans[0].duration_days;
  }
  return g(userId, minutes, days);
}

module.exports = { getConfig, setConfig, prepay, handleNotify, getNotifyUrl, buildAuthHeader, httpsJson, getPlatformCert, resetPlatformCertCache };
