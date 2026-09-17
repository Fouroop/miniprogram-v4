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

module.exports = { userAuth, adminAuth };
