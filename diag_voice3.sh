#!/bin/bash
TOKEN=$(curl -s -m 10 -X POST https://zblw.com.cn/cuoti/api/auth/login -H "Content-Type: application/json" -d '{"username":"demo","password":"demo123"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])" 2>/dev/null)
if [ -z "$TOKEN" ]; then echo "LOGIN_FAIL"; exit 1; fi
echo "token_len=${#TOKEN}"
echo "=== /ai/voice-config ==="
curl -s -m 10 "https://zblw.com.cn/cuoti/api/ai/voice-config" -H "Authorization: Bearer $TOKEN"
echo ""
echo "=== 后端 ai 路由中 voice-config 定义 ==="
grep -rn "voice-config\|voiceConfig" /opt/cuoti-ai/backend/routes/*.js | head -10
