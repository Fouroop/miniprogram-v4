// utils/volc.js —— 火山引擎费用中心 OpenAPI 客户端（V2 签名）
// 用途：查询豆包语音（Seeduplex）官方账单金额与账户余额，用于管理后台"火山用量"页
// 依赖：settings 表存 volc_account（AK/SK 已加密）；config.jwt.adminSecret 派生加密密钥
'use strict';
const crypto = require('crypto');
const https = require('https');
const pool = require('../db/pool');
const config = require('../config');

const HOST = 'open.volcengineapi.com';
const REGION = 'cn-beijing';
const SERVICE = 'billing';
const VERSION = '2022-01-01';

function sha256Hex(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }
function hmac(key, s) { return crypto.createHmac('sha256', key).update(s, 'utf8').digest(); }
function hmacHex(key, s) { return crypto.createHmac('sha256', key).update(s, 'utf8').digest('hex'); }

// AES-256-GCM 加密（密钥由 adminSecret 派生，固定 IV 前缀随机）
function encrypt(plain) {
  const key = crypto.createHash('sha256').update(config.jwt.adminSecret || 'volc-enc-key').digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return 'v1:' + iv.toString('base64') + ':' + tag.toString('base64') + ':' + enc.toString('base64');
}
function decrypt(stored) {
  try {
    if (!stored || !stored.startsWith('v1:')) return stored || '';
    const parts = stored.split(':');
    const iv = Buffer.from(parts[1], 'base64'), tag = Buffer.from(parts[2], 'base64'), enc = Buffer.from(parts[3], 'base64');
    const key = crypto.createHash('sha256').update(config.jwt.adminSecret || 'volc-enc-key').digest();
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (e) { return ''; }
}

async function getAccount() {
  const [rows] = await pool.query("SELECT value FROM settings WHERE key_name='volc_account'");
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}
async function setAccount(cfg) {
  const stored = JSON.stringify({ ...cfg, secret_key: encrypt(cfg.secret_key || '') });
  await pool.query(
    "INSERT INTO settings (key_name, value) VALUES ('volc_account', ?) ON DUPLICATE KEY UPDATE value=VALUES(value)",
    [stored]
  );
}

// V2 签名并发送请求（method=POST，JSON body）
function callApi(ak, sk, action, body) {
  const xDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // YYYYMMDDTHHMMSSZ
  const date = xDate.slice(0, 8);
  const payload = JSON.stringify(body || {});
  const hashedPayload = sha256Hex(payload);
  const qs = `Action=${action}&Version=${VERSION}`;
  const canonicalHeaders = `host:${HOST}\nx-content-sha256:${hashedPayload}\nx-date:${xDate}\n`;
  const signedHeaders = 'host;x-content-sha256;x-date';
  const canonicalRequest = ['POST', '/', qs, canonicalHeaders, signedHeaders, hashedPayload].join('\n');
  const scope = `${date}/${REGION}/${SERVICE}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(sk, date), kRegion = hmac(kDate, REGION), kService = hmac(kRegion, SERVICE), kSigning = hmac(kService, 'request');
  const signature = hmacHex(kSigning, stringToSign);
  const authorization = `HMAC-SHA256 Credential=${ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request({
      host: HOST, path: '/?' + qs, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': HOST,
        'X-Date': xDate,
        'X-Content-Sha256': hashedPayload,
        'Authorization': authorization,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let buf = '';
      res.on('data', (d) => buf += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, data: { raw: buf } }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 拉官方账单（按月）：返回该月各产品费用合计（ListBill 标准账单，无需开通分账能力）
async function fetchBillByMonth(ak, sk, month) {
  const r = await callApi(ak, sk, 'ListBill', {
    BillPeriod: month, // 2026-09
    NeedRecordNum: 0,
    Offset: 0,
    Limit: 100,
    GroupTerm: 1 // 聚合到产品
  });
  if (r.data && r.data.ResponseMetadata && r.data.ResponseMetadata.Error) {
    throw new Error(r.data.ResponseMetadata.Error.Code + ': ' + r.data.ResponseMetadata.Error.Message);
  }
  const list = (r.data && r.data.Result && r.data.Result.List) || [];
  return list.map(x => ({
    product: x.ProductName || x.Product || x.ProductCode || '',
    pretaxAmount: Number(x.PretaxAmount) || Number(x.PreTaxAmount) || 0,
    discountAmount: Number(x.DiscountAmount) || Number(x.Discount) || 0,
    amount: Number(x.Amount) || Number(x.AfterDiscountAmount) || (Number(x.PretaxAmount) - Number(x.DiscountAmount)) || 0,
    billCategory: x.BillCategory || '',
    billMonth: x.BillMonth || month
  }));
}

// 查询账户余额
async function fetchBalance(ak, sk) {
  const r = await callApi(ak, sk, 'QueryBalanceAcct', {});
  if (r.data && r.data.ResponseMetadata && r.data.ResponseMetadata.Error) {
    throw new Error(r.data.ResponseMetadata.Error.Code + ': ' + r.data.ResponseMetadata.Error.Message);
  }
  const res = (r.data && r.data.Result) || {};
  const list = res.BalanceAcctList || [];
  if (list.length) {
    return list.map(x => ({
      acctType: x.AcctType || x.AccountType || '',
      cashBalance: Number(x.CashBalance) || Number(x.AvailableBalance) || 0,
      frozenBalance: Number(x.FrozenBalance) || 0,
      availableBalance: Number(x.AvailableBalance) || Number(x.CashBalance) || 0,
      currency: x.Currency || 'CNY'
    }));
  }
  // 兼容返回顶层字段（无 BalanceAcctList）
  return [{
    acctType: '账户可用余额',
    cashBalance: Number(res.CashBalance) || 0,
    frozenBalance: Number(res.FreezeAmount) || 0,
    availableBalance: Number(res.AvailableBalance) || 0,
    currency: res.Currency || 'CNY'
  }];
}

module.exports = { getAccount, setAccount, callApi, fetchBillByMonth, fetchBalance, decrypt };
