#!/bin/bash
echo "=== voice_configs ==="
mysql -ucuoti -p'Cuoti2026!Secure' cuoti_ai -e "SELECT id, proxy_url, voice_id, is_active FROM voice_configs;" 2>/dev/null
echo "=== 本机 http /voice ==="
curl -s -m 8 -o /dev/null -w "HTTP:%{http_code}\n" http://127.0.0.1/voice 2>&1
echo "=== 本机 https /voice ==="
curl -s -m 8 -o /dev/null -w "HTTPS:%{http_code}\n" -k https://zblw.com.cn/voice 2>&1
echo "=== nginx 实际代理 8650 直连 ==="
curl -s -m 8 -o /dev/null -w "DIRECT_8650:%{http_code}\n" http://127.0.0.1:8650/voice 2>&1
echo "=== voice-proxy health ==="
curl -s -m 5 http://127.0.0.1:8650/health 2>&1
echo ""
