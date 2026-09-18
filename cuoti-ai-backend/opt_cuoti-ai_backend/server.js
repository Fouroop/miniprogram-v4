const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');

const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true }));
// 虚拟支付发货推送是 XML（text/xml），用文本解析拿到原始 XML
app.use(express.text({ type: ['text/xml', 'application/xml'] }));

// 统一返回格式 { ok, data, error }
app.use((req, res, next) => {
  res.ok = (data) => res.json({ ok: true, data });
  res.fail = (error, code = 400) => res.status(code).json({ ok: false, error });
  next();
});

// ---------- API 路由 ----------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/home', require('./routes/home'));
app.use('/api/questions', require('./routes/questions'));
app.use('/api/mistakes', require('./routes/mistakes'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/vip', require('./routes/vip'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api/user', require('./routes/user'));
app.use('/api/my', require('./routes/api_access'));
// 个人虚拟支付（发货推送无鉴权，须先于 /api/vpay 挂载）
const vpay = require('./routes/vpay');
app.use('/api/vpay/notify', vpay.notifyRouter);
app.use('/api/vpay', vpay.router);
app.use('/api/knowledge', require('./routes/knowledge'));
app.use('/api/admin', require('./routes/admin'));

// ---------- 上传文件静态服务（微信头像等） ----------
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------- 管理后台静态文件（/admin/） ----------
const adminDir = path.join(__dirname, '..', 'admin');
if (fs.existsSync(adminDir)) {
  app.use('/admin', express.static(adminDir));
  app.get('/admin/', (req, res) => res.sendFile(path.join(adminDir, 'index.html')));
}

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, data: { status: 'up', port: config.port } }));

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ ok: false, error: '服务器内部错误: ' + err.message });
});

app.listen(config.port, () => {
  console.log(`[cuoti-ai] 后端已启动: http://0.0.0.0:${config.port}`);
  console.log(`[cuoti-ai] API 前缀: /api`);
  console.log(`[cuoti-ai] 管理后台: http://127.0.0.1:${config.port}/admin/`);
});
