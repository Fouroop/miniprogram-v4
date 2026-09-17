/**
 * 语音通话模块单元测试
 * 运行: node utils/voice.test.cjs
 */

// ---- Mock wx API ----
const wxMock = {
  createWebAudioContext(opts) {
    return {
      state: 'suspended',
      sampleRate: (opts && opts.sampleRate) || 48000,
      destination: {},
      resume() { this.state = 'running'; return Promise.resolve(); },
      createBuffer(ch, len, rate) {
        const data = new Float32Array(len);
        return { getChannelData() { return data; }, copyToChannel(src, ch) { data.set(src); }, length: len, sampleRate: rate };
      },
      createBufferSource() {
        return { buffer: null, connect() {}, start() {}, stop() {}, onended: null };
      },
      createGain() {
        return { gain: { value: 1 }, connect() {} };
      },
      close() { this.state = 'closed'; }
    };
  },
  getRecorderManager() { return {}; },
  getStorageSync() { return ''; },
  connectSocket() { return { send() {}, onOpen() {}, onMessage() {}, onClose() {}, onError() {} } ; }
};
global.wx = wxMock;

// ---- Load module ----
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'voice.js'), 'utf-8')
  .replace(/const \{ request[^}]*\} = require\(.+?\);/, 'const request = function(){};');
const modFn = new Function('module', 'require', code + '\nreturn module.exports;');
const modObj = { exports: {} };
modFn(modObj, require);
const { VoiceCall } = modObj.exports;

// ---- 提取 resamplePcm16 ----
function extractFunction(src, name) {
  const marker = 'function ' + name;
  const start = src.indexOf(marker);
  if (start < 0) throw new Error('Cannot find ' + name);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.substring(start, i + 1);
}
const resamplePcm16 = new Function(extractFunction(code, 'resamplePcm16') + '\nreturn resamplePcm16;')();

// ---- 测试辅助 ----
let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.error('  ❌ ' + msg); }
}

// ===== 测试 1: 模块加载 =====
console.log('\n--- 测试 1: 模块加载 ---');
assert(typeof VoiceCall === 'function', 'VoiceCall 是构造函数');

// ===== 测试 2: resamplePcm16 重采样 =====
console.log('\n--- 测试 2: resamplePcm16 重采样 ---');
{
  const input = new Int16Array([16384, -16384, 0, 32767, -32768]);
  const same = resamplePcm16(input, 24000, 24000);
  assert(same.length === 5, '同采样率: 输出长度 = 5');
  assert(Math.abs(same[0] - 0.5) < 0.001, '16384/32768 ≈ 0.5');
  assert(Math.abs(same[4] + 1) < 0.001, '-32768/32768 = -1');

  const up = resamplePcm16(input, 24000, 48000);
  assert(up.length === 10, '24k→48k: 输出长度 10');

  const down = resamplePcm16(input, 24000, 16000);
  assert(down.length === Math.floor(5 / (24000 / 16000)), '24k→16k: 输出长度 3');
}

// ===== 测试 3: VoiceCall.start() 透传 audioContext =====
console.log('\n--- 测试 3: VoiceCall.start() 透传 audioContext ---');
{
  const vc = new VoiceCall();
  const mockAc = wxMock.createWebAudioContext();
  mockAc.state = 'running';

  let receivedAc = 'NOT_CALLED';
  vc.fetchConfig = () => Promise.resolve({ proxy_url: 'wss://test.example.com/ws' });
  vc._connect = function (proxyUrl, instructions, greeting, audioContext) {
    receivedAc = audioContext;
  };

  vc.start('instructions', 'hello', mockAc);

  setTimeout(() => {
    assert(receivedAc === mockAc, 'audioContext 正确透传到 _connect');
  }, 50);
}

// ===== 测试 4: VoiceCall.start() 无 audioContext 时传 undefined =====
console.log('\n--- 测试 4: 无 audioContext 参数 ---');
{
  const vc = new VoiceCall();
  let receivedAc = 'NOT_CALLED';
  vc.fetchConfig = () => Promise.resolve({ proxy_url: 'wss://test.example.com/ws' });
  vc._connect = function (proxyUrl, instructions, greeting, audioContext) {
    receivedAc = audioContext;
  };

  vc.start('instructions', 'hello');

  setTimeout(() => {
    assert(receivedAc === undefined, '无 audioContext 时传 undefined');
  }, 50);
}

// ===== 测试 5: VoiceCall.stop() 清理资源 =====
console.log('\n--- 测试 5: VoiceCall.stop() 清理资源 ---');
{
  const vc = new VoiceCall();
  vc.connected = true;
  vc.player = { stop() { this.stopped = true; } };
  vc.socket = {
    send() {},
    close() { this.closed = true; },
    onClose() {}
  };
  vc.stop();
  assert(!vc.connected, 'connected 重置为 false');
  assert(vc.socket === null, 'socket 置空');
  assert(vc.player === null, 'player 置空');
}

// ===== 测试 6: cleanAsrText 过滤 =====
console.log('\n--- 测试 6: cleanAsrText ---');
{
  // 通过 VoiceCall 事件间接测试
  const vc = new VoiceCall();
  let captured = null;
  vc.setCb('onUserText', t => { captured = t; });

  // 模拟识别完成事件
  vc._handleEvent({ type: 'conversation.item.input_audio_transcription.completed', text: '你好世界' });
  assert(captured === '你好世界', '有效中文文本通过');

  captured = null;
  vc._handleEvent({ type: 'conversation.item.input_audio_transcription.completed', text: 'a' });
  assert(captured === null, '单字符被过滤');

  captured = null;
  vc._handleEvent({ type: 'conversation.item.input_audio_transcription.completed', text: '' });
  assert(captured === null, '空文本被过滤');
}

// ===== 测试 7: _base64ToBytes 解码 =====
console.log('\n--- 测试 7: _base64ToBytes ---');
{
  const vc = new VoiceCall();
  // "SGVsbG8=" = "Hello"
  const bytes = vc._base64ToBytes('SGVsbG8=');
  assert(bytes instanceof ArrayBuffer, '返回 ArrayBuffer');
  assert(bytes.byteLength === 5, '解码长度 5');
  const u8 = new Uint8Array(bytes);
  assert(u8[0] === 72 && u8[1] === 101, 'H=72, e=101');

  const empty = vc._base64ToBytes('');
  assert(empty instanceof ArrayBuffer && empty.byteLength === 0, '空字符串返回空 ArrayBuffer');
}

// ===== 测试 8: _mergeDelta 文本合并 =====
console.log('\n--- 测试 8: _mergeDelta ---');
{
  const vc = new VoiceCall();
  assert(vc._mergeDelta('', '你好') === '你好', '空 + 文本 = 文本');
  assert(vc._mergeDelta('你好', '') === '你好', '文本 + 空 = 文本');
  assert(vc._mergeDelta('你好', '你好世界') === '你好世界', '前缀扩展');
  assert(vc._mergeDelta('你好世界', '世界') === '世界', '旧包含新 → 用新');
}

// ===== 测试 9: player 接受外部 ac 后 enqueue 不报错 =====
console.log('\n--- 测试 9: player + 外部 AudioContext 集成 ---');
{
  const externalAc = wxMock.createWebAudioContext();
  externalAc.state = 'running';

  // 通过 _connect 创建 player，传入外部 ac
  const vc = new VoiceCall();
  vc.fetchConfig = () => Promise.resolve({ proxy_url: 'wss://test.example.com/ws' });

  // 直接测试 _connect 内部：mock socket 行为
  let chunkCount = 0;
  vc.setCb('onAudioChunk', n => { chunkCount = n; });

  // 手动调用 _connect 路径，但需要 mock wx.connectSocket
  const origConnectSocket = wxMock.connectSocket;
  wxMock.connectSocket = () => ({
    send() {},
    onOpen() {},
    onMessage() {},
    onClose() {},
    onError() {},
    close() {}
  });

  vc._connect('wss://test.example.com/ws', 'inst', 'hello', externalAc);
  assert(vc.player !== null, 'player 创建成功');

  // enqueue 一个 640 字节的 buffer
  const testBuf = new ArrayBuffer(640);
  const view = new Int16Array(testBuf);
  for (let i = 0; i < view.length; i++) view[i] = Math.floor(Math.sin(i * 0.1) * 16000);

  vc.player.enqueue(testBuf);
  assert(chunkCount > 0, 'enqueue 触发 onAudioChunk 回调');

  // stop 不关闭外部 ac
  let acClosed = false;
  const origClose = externalAc.close.bind(externalAc);
  externalAc.close = () => { acClosed = true; origClose(); };
  vc.player.stop();
  assert(!acClosed, 'player.stop() 不关闭外部 AudioContext');

  wxMock.connectSocket = origConnectSocket;
  externalAc.close();
}

// ===== 测试 10: 暂停/恢复收音（全双工静音） =====
console.log('\n--- 测试 10: pauseMic/resumeMic 静音 ---');
{
  const vc = new VoiceCall();
  vc._micActive = true;
  vc.pcmCache = new Uint8Array([1, 2, 3]);
  vc.pauseMic();
  assert(vc._micPaused === true, 'pauseMic 后 _micPaused = true');
  assert(vc.pcmCache.length === 0, 'pauseMic 清空未发送的缓冲');
  vc.resumeMic();
  assert(vc._micPaused === false, 'resumeMic 后 _micPaused = false');
}

// ===== 测试 11: PTT 下 started 只展示状态，不干预播放/收音 =====
console.log('\n--- 测试 11: 识别 started（PTT：不打断 AI、不恢复麦克风） ---');
{
  const vc = new VoiceCall();
  let interrupted = false;
  vc.player = { interrupt() { interrupted = true; } };
  let speaking = null;
  vc.setCb('onUserSpeaking', on => { speaking = on; });
  vc._micPaused = true; // PTT：静音等待按住

  vc._handleEvent({ type: 'conversation.item.input_audio_transcription.started' });
  assert(interrupted === false, 'PTT 下 started 不打断 AI 播放');
  assert(speaking === true, 'onUserSpeaking(true) 发出');
  assert(vc._micPaused === true, 'PTT 下 started 不恢复麦克风（保持静音）');
}

// ---- 结果 ----
setTimeout(() => {
  console.log('\n========================================');
  console.log('  通过: ' + passed + ' / ' + (passed + failed));
  if (failed > 0) {
    console.log('  失败: ' + failed);
    process.exit(1);
  } else {
    console.log('  全部通过 ✅');
  }
  console.log('========================================\n');
}, 200);
