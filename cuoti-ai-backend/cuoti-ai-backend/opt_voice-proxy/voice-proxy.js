/**
 * 火山引擎豆包语音 · 端到端实时语音代理
 * --------------------------------------
 * 作用：把"客户端 → 火山"的 WebSocket 连接代理转发，并在握手时注入鉴权头，
 *       避免把 API Key / Access Token 暴露在前端（网页 / 小程序）。
 *
 * 协议：客户端连本服务 → 本服务连火山 wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue
 *       双向透传（JSON 文本帧 / 二进制帧原样转发，保留帧类型）。
 *       新版 Seeduplex 协议为 JSON 文本事件帧，代理不解析，客户端负责拼协议。
 *
 * 部署：node voice-proxy.js   （或 pm2 start voice-proxy.js --name voice-proxy）
 *
 * 环境变量（推荐用 pm2 env 或 systemd）：
 *   PORT             代理监听端口，默认 8650
 *   VOLC_API_KEY     火山引擎【新版控制台】API Key（控制台 → API Key 管理）
 *   PROXY_KEY        客户端连接密钥（防公网盗刷，前端连接时带 ?key=xxx）
 *   VOLC_URL         火山端点，默认 wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue
 *
 * 旧版兼容（如仍用旧控制台的 AppID/Token，二选一）：
 *   VOLC_APP_ID      旧版 App ID
 *   VOLC_ACCESS_TOKEN旧版 Access Token（无需 Bearer 前缀）
 */
'use strict';

const http = require('http');
const { URL } = require('url');
const WebSocket = require('ws');

const PORT = parseInt(process.env.PORT || '8650', 10);
const VOLC_API_KEY = process.env.VOLC_API_KEY || '';
const VOLC_APP_ID = process.env.VOLC_APP_ID || '';
const VOLC_ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN || '';
const PROXY_KEY = process.env.PROXY_KEY || '';
const VOLC_URL = process.env.VOLC_URL || 'wss://openspeech.bytedance.com/api/v3/duplex/realtime/dialogue';
// 流量上报：后端地址与内部密钥（代理与后端在同一台机器，走内网）
const REPORT_URL = process.env.REPORT_URL || 'http://127.0.0.1:8651/api/voice/call-report';
const REPORT_KEY = process.env.REPORT_KEY || 'voice-report-2026';

const warn = (msg) => console.warn('[voice-proxy]', msg);

const configured = !!(VOLC_API_KEY || (VOLC_APP_ID && VOLC_ACCESS_TOKEN));

/* ---------- 健康检查 / HTTP ---------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, name: 'voice-proxy', volcConfigured: configured }));
    return;
  }
  res.writeHead(404);
  res.end('Not Found');
});

/* ---------- WebSocket 代理 ---------- */
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const u = new URL(req.url, 'http://localhost');
  // PROXY_KEY 校验已移除——voice-proxy 是内部服务，由 nginx 反代保护外部访问
  // 小程序用户通过 JWT token 鉴权（由主后端校验），不需要代理密钥

  // 配置检查
  if (!configured) {
    warn('未配置 VOLC_API_KEY（或旧版 VOLC_APP_ID/VOLC_ACCESS_TOKEN），拒绝握手');
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (clientWs, req) => {
  // 用户身份：连接时带 ?token=用户token（后端 /api/voice/call-report 会校验）
  // call_id：客户端生成的通话唯一ID（幂等去重，与 /api/voice/end 共用）
  const u = new URL(req.url, 'http://localhost');
  const userToken = u.searchParams.get('token') || (req.headers['x-user-token'] || '');
  const callId = u.searchParams.get('call_id') || '';

  // 流量统计
  const stats = { up: 0, down: 0, start: Date.now() };
  const addBytes = (obj, data, isBinary) => {
    if (isBinary) { obj += Buffer.byteLength(data); }
    else { obj += Buffer.byteLength(String(data), 'utf8'); }
    return obj;
  };

  // 火山鉴权头：新版用 X-Api-Key，旧版用 App-ID/Access-Key
  const headers = { 'X-Api-Connect-Id': (Math.random().toString(36).slice(2) + Date.now().toString(36)) };
  if (VOLC_API_KEY) {
    headers['X-Api-Key'] = VOLC_API_KEY;
  } else {
    headers['X-Api-App-ID'] = VOLC_APP_ID;
    headers['X-Api-Access-Key'] = VOLC_ACCESS_TOKEN;
    headers['X-Api-Resource-Id'] = 'volc.speech.dialog';
    headers['X-Api-App-Key'] = 'PlgvMymc7f3tQnJ6';
  }
  // 连接火山
  const volcWs = new WebSocket(VOLC_URL, { headers, perMessageDeflate: false });
  let volcReady = false;
  const pending = []; // 火山未就绪前暂存的客户端帧 {buf, binary}

  const flush = () => {
    while (volcReady && pending.length) {
      const p = pending.shift();
      try { volcWs.send(p.buf, { binary: p.binary }); } catch (e) { /* ignore */ }
    }
  };

  const toClient = (data, isBinary) => {
    stats.down = addBytes(stats.down, data, isBinary);
    try { clientWs.send(data, { binary: isBinary }); } catch (e) { /* ignore */ }
  };
  const toVolc = (data, isBinary) => {
    const buf = isBinary ? Buffer.from(data) : data;
    stats.up = addBytes(stats.up, data, isBinary);
    if (volcReady) {
      try { volcWs.send(buf, { binary: isBinary }); } catch (e) { warn('volc send err: ' + e.message); }
    } else {
      pending.push({ buf, binary: isBinary });
      if (pending.length > 2000) { warn('pending 队列过长，丢帧'); pending.shift(); }
    }
  };

  // 连接关闭 → 上报流量明细
  const report = (code, reason) => {
    const seconds = Math.round((Date.now() - stats.start) / 1000);
    const payload = {
      token: userToken,
      call_id: callId,
      seconds,
      up_bytes: stats.up,
      down_bytes: stats.down,
      total_bytes: stats.up + stats.down,
      close_code: code
    };
    // 只上报有实际流量的通话（>=1秒 或 有字节）
    if (seconds >= 1 || payload.total_bytes > 0) {
      const body = JSON.stringify(payload);
      const hreq = http.request(REPORT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Report-Key': REPORT_KEY,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 5000
      }, (hres) => {
        hres.resume();
        if (hres.statusCode !== 200) warn('上报失败 HTTP ' + hres.statusCode);
      });
      hreq.on('error', (e) => warn('上报异常: ' + e.message));
      hreq.on('timeout', () => hreq.destroy());
      hreq.end(body);
    }
  };

  clientWs.on('message', (data, isBinary) => toVolc(data, isBinary));
  clientWs.on('close', (code) => { report(code); try { volcWs.close(); } catch (e) { /* ignore */ } });
  clientWs.on('error', () => { report(); try { volcWs.close(); } catch (e) { /* ignore */ } });

  volcWs.on('open', () => { volcReady = true; flush(); });
  volcWs.on('message', (data, isBinary) => toClient(data, isBinary));
  volcWs.on('close', (code, reason) => {
    try { clientWs.close(code || 1006, reason ? reason.toString() : undefined); } catch (e) { /* ignore */ }
  });
  volcWs.on('error', (e) => {
    warn('火山连接错误: ' + e.message);
    try { clientWs.close(4402, 'volc error'); } catch (err) { /* ignore */ }
  });
});

server.listen(PORT, () => {
  console.log(`[voice-proxy] 监听 :${PORT}`);
  console.log(`[voice-proxy] 火山端点 ${VOLC_URL}`);
  const auth = VOLC_API_KEY ? `API Key(${VOLC_API_KEY.slice(0,6)}…${VOLC_API_KEY.slice(-4)})` : (configured ? '旧版 AppID/Token' : '【未配置】');
  console.log(`[voice-proxy] 鉴权 ${auth} / key保护 ${PROXY_KEY ? '开' : '【关】'}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });
