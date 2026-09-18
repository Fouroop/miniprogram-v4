#!/bin/bash
# 严格校验证书的公网 wss 测试（模拟小程序 wx.connectSocket 行为）
cd /opt/voice-proxy
echo "=== 证书信息 ==="
echo | openssl s_client -servername zblw.com.cn -connect zblw.com.cn:443 2>/dev/null | openssl x509 -noout -subject -dates -issuer 2>/dev/null
echo "=== 严格证书校验 wss 连接 ==="
node -e '
const WebSocket = require("ws");
const url = "wss://zblw.com.cn/voice?token=test&call_id=diag_ssl_1";
console.log("连接:", url);
const ws = new WebSocket(url); // 默认 rejectUnauthorized=true
const to = setTimeout(() => { console.log("TIMEOUT 10s"); process.exit(2); }, 10000);
ws.on("open", () => { console.log("WS OPEN 证书校验通过"); clearTimeout(to); ws.close(); process.exit(0); });
ws.on("error", (e) => { console.log("WS ERROR:", e.message); clearTimeout(to); process.exit(4); });
ws.on("close", (c, r) => { console.log("WS CLOSE:", c, r && r.toString().slice(0, 120)); });
' 2>&1
echo "NODE_EXIT=$?"
