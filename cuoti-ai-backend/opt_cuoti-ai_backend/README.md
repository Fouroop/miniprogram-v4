# 错题AI辅导 · 后端 API 服务

Node.js 18+ / Express / MySQL 8.0 / JWT / bcryptjs。

## 目录结构

```
backend/
├── server.js            # 入口，挂载路由 + 托管 /admin 静态文件
├── config.js            # 端口/DB/JWT/思维引导人设 配置
├── package.json
├── db/
│   ├── init.sql         # 建库建表 + 示例题目 + 默认配置
│   ├── init.js          # 一键初始化（执行 init.sql + 插入 admin/admin123、demo/demo123）
│   └── pool.js          # mysql2 连接池
├── middleware/
│   └── auth.js          # userAuth（学生 JWT）+ adminAuth（X-Admin-Token）
└── routes/
    ├── auth.js          # 学生登录/注册/me
    ├── home.js          # 首页统计
    ├── questions.js     # 题库 CRUD
    ├── mistakes.js      # 错题 CRUD + OCR（演示模拟）+ 复习标记
    ├── ai.js            # AI 对话（思维引导式）+ 对话历史 + 语音配置下发
    ├── vip.js           # 套餐/订单/激活码
    ├── user.js          # 我的资料/使用统计
    └── admin.js         # 管理端全部接口
```

## 本地/服务器启动步骤

```bash
cd /home/user/Doubao/chats/38441879264621826/cuoti-ai/backend
npm install

# 1) 初始化数据库（建表 + 默认管理员 + 示例数据）
node db/init.js
# 输出：默认管理员 admin / admin123，演示学生 demo / demo123

# 2) 开发启动
node server.js
# 监听 8651，日志见控制台
```

环境变量（可选，覆盖 config.js 默认值）：

| 变量 | 默认 | 说明 |
|------|------|------|
| PORT | 8651 | 后端端口 |
| DB_HOST | 127.0.0.1 | MySQL 地址 |
| DB_USER | root | |
| DB_PASSWORD | HrmanagMent001 | |
| DB_NAME | cuoti_ai | |
| JWT_USER_SECRET / JWT_ADMIN_SECRET | 内置 | 生产环境请改 |

## 管理后台

后端启动后直接访问：

- 本机：`http://127.0.0.1:8651/admin/`
- 线上：`https://zblw.com.cn/admin/`（由 Nginx 反代）

默认管理员：`admin / admin123`。

## pm2 配置示例（ecosystem.config.js）

在 backend 目录新建 `ecosystem.config.js`：

```js
module.exports = {
  apps: [{
    name: 'cuoti-ai-api',
    script: 'server.js',
    cwd: '/home/user/Doubao/chats/38441879264621826/cuoti-ai/backend',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 8651,
      DB_HOST: '127.0.0.1',
      DB_USER: 'root',
      DB_PASSWORD: 'HrmanagMent001',
      DB_NAME: 'cuoti_ai'
    }
  }]
};
```

启动 / 常用命令：

```bash
pm2 start ecosystem.config.js
pm2 logs cuoti-ai-api
pm2 restart cuoti-ai-api
pm2 save && pm2 startup
```

## Nginx 配置示例（追加到 zblw.com.cn 443 server 块）

```nginx
# API 反代
location /api/ {
    proxy_pass http://127.0.0.1:8651/api/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 120s;
}

# 管理后台静态文件（也可直接由后端 /admin/ 提供，二选一）
location /admin/ {
    alias /home/user/Doubao/chats/38441879264621826/cuoti-ai/admin/;
    index index.html;
}

# 健康检查
location = /health {
    proxy_pass http://127.0.0.1:8651/api/health;
}
```

改完执行 `nginx -t && nginx -s reload`。

## 接口自检（curl）

```bash
# 管理员登录
curl -X POST http://127.0.0.1:8651/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
# → 拿 token 后：
TOKEN=xxx

# 管理端统计
curl http://127.0.0.1:8651/api/admin/stats -H "X-Admin-Token: $TOKEN"

# 学生登录
curl -X POST http://127.0.0.1:8651/api/auth/login \
  -H "Content-Type: application/json" -d '{"username":"demo","password":"demo123"}'

# AI 对话（学生 token）
curl -X POST http://127.0.0.1:8651/api/ai/chat \
  -H "Authorization: Bearer <student_token>" -H "Content-Type: application/json" \
  -d '{"content":"这道题怎么做？"}'
```

## 关键实现说明

1. **AI 文字对话**：`routes/ai.js` 每次从 `llm_configs` 取 `is_active=1` 的配置，用 `fetch` 调 OpenAI 兼容 `/chat/completions`，system prompt 注入思维引导人设 + 关联错题题干；未配置真实 key 时走内置兜底思维引导话术，接口永远可用。
2. **语音配置下发**：`GET /api/ai/voice-config` 只返回 `proxy_url` + `voice_id`，API Key 仅存服务端；管理端查看时脱敏（前4后4）。
3. **数据隔离**：学生端所有业务查询按 `user_id` 过滤；公共题 `user_id IS NULL` 与个人题同时可见。
4. **VIP**：演示环境下单即模拟支付成功，直接开通 VIP；激活码批量生成后学生端 `/api/vip/activate` 兑换。
