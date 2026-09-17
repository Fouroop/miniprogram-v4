module.exports = {
  apps: [{
    name: 'voice-proxy',
    script: 'voice-proxy.js',
    cwd: '/opt/voice-proxy',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '300M',
    env: {
      PORT: '8650',
      VOLC_API_KEY: '71c6a814-860c-4160-8332-7fa870d2c54c'
    }
  }]
};
