#!/bin/bash
# 公网 wss 链路测试：模拟小程序连接 wss://zblw.com.cn/voice（走 nginx → 8650）
cd /opt/voice-proxy
node -e '
const WebSocket = require("ws");
const url = "wss://zblw.com.cn/voice?token=test&call_id=diag_pub_1";
console.log("连接:", url);
const ws = new WebSocket(url, { rejectUnauthorized: false });
const to = setTimeout(() => { console.log("TIMEOUT 10s 未建立连接"); process.exit(2); }, 10000);
ws.on("open", () => {
  console.log("WS OPEN 公网握手成功");
  ws.send(JSON.stringify({ type: "session.create", session: { model: "1.2.6.0", instructions: "test", audio: { input: { format: { type: "pcm", rate: 16000 } }, output: { format: { type: "pcm_s16le", rate: 24000 }, voice: "zh_female_vv_jupiter_bigtts" } } } }));
});
ws.on("message", (d) => {
  const m = d.toString();
  console.log("收到:", m.slice(0, 150));
  try { const j = JSON.parse(m); if (j.type === "session.created") { clearTimeout(to); console.log("SESSION CREATED OK"); ws.close(); process.exit(0); } if (j.type === "error") { console.log("服务端错误:", JSON.stringify(j).slice(0, 300)); clearTimeout(to); ws.close(); process.exit(3); } } catch(e){}
});
ws.on("error", (e) => { console.log("WS ERROR:", e.message); clearTimeout(to); process.exit(4); });
ws.on("close", (c, r) => { console.log("WS CLOSE:", c, r && r.toString().slice(0, 120)); });
' 2>&1
echo "NODE_EXIT=$?"
