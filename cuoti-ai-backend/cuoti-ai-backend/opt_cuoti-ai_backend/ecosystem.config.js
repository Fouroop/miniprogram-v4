module.exports = {
  apps: [{
    name: 'cuoti-ai-api',
    cwd: '/opt/cuoti-ai/backend',
    script: 'server.js',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: '8651',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'cuoti',
      DB_PASSWORD: 'Cuoti2026!Secure',
      DB_NAME: 'cuoti_ai',
      JWT_USER_SECRET: 'cuoti-user-secret-2026-change-me',
      JWT_ADMIN_SECRET: 'cuoti-admin-secret-2026-change-me'
    }
  }]
};
