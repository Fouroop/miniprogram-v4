const jwt = require('jsonwebtoken');
const config = require('../config');

// 用户端鉴权：Authorization: Bearer <token>
function userAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: '未登录' });
  try {
    req.user = jwt.verify(token, config.jwt.userSecret);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: '登录已过期' });
  }
}

// 管理端鉴权：X-Admin-Token
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ ok: false, error: '未登录管理后台' });
  try {
    req.admin = jwt.verify(token, config.jwt.adminSecret);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: '管理员登录已过期' });
  }
}

// 个人 API 授权码鉴权（「我的-连接AI」生成）：X-Api-Token 或 Authorization: Bearer cu_xxx
async function apiTokenAuth(req, res, next) {
  let token = req.headers['x-api-token'] || '';
  if (!token) {
    const h = req.headers.authorization || '';
    if (h.startsWith('Bearer ')) token = h.slice(7);
  }
  token = String(token || '').trim();
  if (!token || !token.startsWith('cu_')) {
    return res.status(401).json({ ok: false, error: '缺少有效授权码，请在微信小程序「我的-连接AI」中获取' });
  }
  try {
    const pool = require('../db/pool');
    const [rows] = await pool.query(
      'SELECT id, username, nickname, grade, role, is_vip, vip_expire, voice_minutes, voice_expire FROM users WHERE api_token=?',
      [token]
    );
    if (!rows.length) {
      return res.status(401).json({ ok: false, error: '授权码无效或已失效，请重新生成' });
    }
    req.user = rows[0];
    next();
  } catch (e) {
    return res.status(500).json({ ok: false, error: '服务器内部错误' });
  }
}

module.exports = { userAuth, adminAuth, apiTokenAuth };
