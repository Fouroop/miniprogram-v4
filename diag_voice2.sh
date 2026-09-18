#!/bin/bash
echo "=== 当前运行 voice-proxy 版本关键段 ==="
head -60 /opt/voice-proxy/voice-proxy.js | grep -nE "PROXY_KEY|upgrade|configured|VOLC" | head -15
echo "=== upgrade 处理段 ==="
grep -n "server.on('upgrade'" /opt/voice-proxy/voice-proxy.js
sed -n "$(grep -n "server.on('upgrade'" /opt/voice-proxy/voice-proxy.js | head -1 | cut -d: -f1),+30p" /opt/voice-proxy/voice-proxy.js
echo "=== 启动 env（是否带 VOLC_API_KEY）==="
pm2 env 4 2>/dev/null | grep -E "VOLC|PROXY_KEY|APP_ID|ACCESS" | head -10
echo "=== /ai/voice-config 接口测试 ==="
TOKEN=$(curl -s -m 10 -X POST https://zblw.com.cn/cuoti/api/auth/login -H "Content-Type: application/json" -d '{"username":"demo","password":"demo123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "token_ok=${#TOKEN}"
curl -s -m 10 "https://zblw.com.cn/cuoti/api/ai/voice-config" -H "Authorization: Bearer $TOKEN"
echo ""
