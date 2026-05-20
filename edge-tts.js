// Edge TTS client — Microsoft Edge Read Aloud WebSocket protocol.
// Pure Node.js, no Python needed. Supports HTTP CONNECT proxy for GFW.

const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');

const HOST = 'speech.platform.bing.com';
const AUTH_URL = 'https://edge.microsoft.com/translate/auth';
const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const PATH = (token) =>
  `/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TOKEN}&ConnectionId=${token}`;

const SSML = (voice, rate, pitch, text) =>
`<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xmlns:emo="http://www.w3.org/2009/10/emotionml" version="1.0" xml:lang="zh-CN">
  <voice name="${voice}"><prosody rate="${rate}" pitch="${pitch}">${_esc(text)}</prosody></voice>
</speak>`;

const VOICES = { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' };

function _getProxy() {
  const u = process.env.https_proxy || process.env.HTTPS_PROXY ||
            process.env.http_proxy || process.env.HTTP_PROXY || '';
  const m = u.match(/https?:\/\/([^:]+):(\d+)/);
  if (m) return { host: m[1], port: parseInt(m[2]) };
  return null;
}

// Fetch authorization token from Microsoft
function _fetchToken() {
  return new Promise((resolve, reject) => {
    const opts = { hostname: 'edge.microsoft.com', path: '/translate/auth', method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0' },
      timeout: 10000 };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { if (d.trim()) resolve(d.trim()); else reject(new Error('空token')); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('token超时')); });
    req.end();
  });
}

function _connect(proxy) {
  return new Promise((resolve, reject) => {
    if (proxy) {
      const cr = http.request({
        hostname: proxy.host, port: proxy.port,
        method: 'CONNECT', path: `${HOST}:443`, timeout: 5000,
      });
      cr.on('connect', (res, raw) => {
        try { const ts = tls.connect({ socket: raw, host: HOST, servername: HOST }, () => resolve(ts)); ts.on('error', reject); }
        catch (e) { reject(e); }
      });
      cr.on('error', reject);
      cr.on('timeout', () => { cr.destroy(); reject(new Error('timeout')); });
      cr.end();
    } else {
      const ts = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 8000 }, () => resolve(ts));
      ts.on('error', reject);
      ts.on('timeout', () => { ts.destroy(); reject(new Error('timeout')); });
    }
  });
}

function synthesize(text, voiceGender, pitchHz, rateStr, outputPath) {
  return new Promise((resolve, reject) => {
    _fetchToken().then(authToken => {
      const voice = VOICES[voiceGender] || VOICES.female;
      const connectionId = crypto.randomUUID();
      const wsPath = PATH(connectionId);
      const wsKey = crypto.randomBytes(16).toString('base64');
      const proxy = _getProxy();

      const wsHandshake = [
        `GET ${wsPath} HTTP/1.1`,
        `Host: ${HOST}`,
        'Pragma: no-cache',
        'Cache-Control: no-cache',
        'Connection: Upgrade',
        'Upgrade: websocket',
        'Sec-WebSocket-Version: 13',
        `Sec-WebSocket-Key: ${wsKey}`,
        'Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits',
        `Authorization: Bearer ${authToken}`,
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
        'Accept-Language: zh-CN,zh;q=0.9',
        'Origin: https://www.bing.com',
        '', '',
      ].join('\r\n');

      const tryOrder = proxy ? [null, proxy] : [null];

      function attempt(idx) {
        if (idx >= tryOrder.length) { reject(new Error('Edge TTS: 直连和代理均已尝试，无法连接。请检查网络')); return; }
        _connect(tryOrder[idx]).then(sock => {
          let buf = '', upgraded = false;
          sock.on('data', d => {
            if (!upgraded) {
              buf += d.toString('latin1');
              const sep = buf.indexOf('\r\n\r\n');
              if (sep === -1) return;
              if (!buf.includes('101')) { reject(new Error('Edge TTS: ' + buf.slice(0, sep).split('\r\n')[0])); return; }
              upgraded = true;
              const remain = Buffer.from(buf.slice(sep + 4), 'latin1');
              _wsSend(sock, JSON.stringify({ context: { synthesis: { audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3' }}} }));
              _wsSend(sock, SSML(voice, rateStr, pitchHz, text));
              const chunks = remain.length > 0 ? [remain] : [];
              const t = setTimeout(() => { sock.destroy(); reject(new Error('Edge TTS 响应超时')); }, 30000);
              sock.on('data', dd => { clearTimeout(t); chunks.push(dd); });
              sock.on('end', () => { clearTimeout(t); _decode(chunks, outputPath, resolve, reject); });
              sock.on('error', e => { clearTimeout(t); reject(e); });
            }
          });
          sock.on('error', e => {
            if (!upgraded) { sock.destroy(); if (tryOrder[idx] === null && tryOrder.length > idx + 1) attempt(idx + 1); else reject(new Error('连接失败: ' + e.message)); }
          });
          const t = setTimeout(() => {
            if (!upgraded) { sock.destroy(); if (tryOrder[idx] === null && tryOrder.length > idx + 1) attempt(idx + 1); else reject(new Error('握手超时')); }
          }, 12000);
          sock.once('data', () => clearTimeout(t));
          sock.write(wsHandshake);
        }).catch(e => {
          if (tryOrder[idx] === null && tryOrder.length > idx + 1) attempt(idx + 1);
          else reject(new Error(`${tryOrder[idx] ? '代理' : '直连'}失败: ${e.message}`));
        });
      }
      attempt(0);
    }).catch(e => reject(new Error('获取认证token失败: ' + e.message)));
  });
}

// ---- helpers ----

function _wsSend(sock, payload) {
  const buf = Buffer.from(payload, 'utf-8');
  const len = buf.length;
  let hdr;
  if (len < 126) { hdr = Buffer.allocUnsafe(6); hdr[0] = 0x81; hdr[1] = len | 0x80; }
  else if (len < 65536) { hdr = Buffer.allocUnsafe(8); hdr[0] = 0x81; hdr[1] = 126 | 0x80; hdr.writeUInt16BE(len, 2); }
  else { hdr = Buffer.allocUnsafe(14); hdr[0] = 0x81; hdr[1] = 127 | 0x80; hdr.writeBigUInt64BE(BigInt(len), 2); }
  const mask = crypto.randomBytes(4);
  hdr[hdr.length - 4] = mask[0]; hdr[hdr.length - 3] = mask[1];
  hdr[hdr.length - 2] = mask[2]; hdr[hdr.length - 1] = mask[3];
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = buf[i] ^ mask[i % 4];
  sock.write(Buffer.concat([hdr, masked]));
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function _decode(chunks, outputPath, resolve, reject) {
  const full = Buffer.concat(chunks);
  const audio = [];
  let pos = 0;
  while (pos + 2 <= full.length) {
    const opcode = full[pos] & 0x0f, plen0 = full[pos + 1] & 0x7f;
    let plen = plen0, h = 2;
    if (plen0 === 126) { plen = full.readUInt16BE(pos + 2); h += 2; }
    else if (plen0 === 127) { plen = Number(full.readBigUInt64BE(pos + 2)); h += 8; }
    const masked = (full[pos + 1] & 0x80) !== 0;
    const mk = masked ? full.slice(pos + h, pos + h + 4) : null;
    if (masked) h += 4;
    if (pos + h + plen > full.length) break;
    const payload = full.slice(pos + h, pos + h + plen);
    if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i % 4];
    if (opcode === 2 && payload.length > 2) {
      const hl = payload.readUInt16BE(0);
      if (payload.length > 2 + hl) audio.push(payload.slice(2 + hl));
    }
    pos += h + plen;
  }
  if (audio.length === 0) { reject(new Error('未收到音频数据')); return; }
  try { fs.writeFileSync(outputPath, Buffer.concat(audio)); resolve(outputPath); } catch (e) { reject(e); }
}

module.exports = { synthesize };
