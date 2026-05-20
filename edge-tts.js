// Edge TTS client — implements the Microsoft Edge Read Aloud WebSocket
// protocol using only Node.js built-in modules. No Python needed.
// Supports HTTP CONNECT proxy for users behind firewalls.

const http = require('http');
const tls = require('tls');
const crypto = require('crypto');
const fs = require('fs');

const HOST = 'speech.platform.bing.com';
const PATH = '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

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
  // Fallback for common proxy tools (clash, v2ray)
  if (process.platform === 'win32') return { host: '127.0.0.1', port: 7890 };
  return null;
}

function synthesize(text, voiceGender, pitchHz, rateStr, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const voice = VOICES[voiceGender] || VOICES.female;
      const wsKey = crypto.randomBytes(16).toString('base64');
      const proxy = _getProxy();

      const wsHandshake = [
        `GET ${PATH} HTTP/1.1`,
        `Host: ${HOST}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        `Sec-WebSocket-Version: 13`,
        `Sec-WebSocket-Key: ${wsKey}`,
        'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        '', '',
      ].join('\r\n');

      function handleUpgrade(sock, viaProxy) {
        let buf = '';
        let upgraded = false;

        sock.on('data', d => {
          if (!upgraded) {
            buf += d.toString('latin1');
            const sep = buf.indexOf('\r\n\r\n');
            if (sep === -1) return;
            const status = buf.slice(0, sep).split('\r\n')[0];
            if (!status.includes('101')) {
              reject(new Error('Edge TTS: HTTP ' + status));
              return;
            }
            upgraded = true;
            // Remaining data after headers
            const remain = Buffer.from(buf.slice(sep + 4), 'latin1');

            // Send config + SSML
            const config = JSON.stringify({
              context: { synthesis: { audio: {
                metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              }}},
            });
            _wsSend(sock, config);
            const ssmlText = SSML(voice, rateStr, pitchHz, text);
            _wsSend(sock, ssmlText);

            // Collect audio
            const chunks = [];
            if (remain.length > 0) chunks.push(remain);
            const t = setTimeout(() => { sock.destroy(); reject(new Error('Edge TTS 服务响应超时')); }, 30000);

            sock.on('data', dd => { clearTimeout(t); chunks.push(dd); });
            sock.on('end', () => { clearTimeout(t); _decode(chunks, outputPath, resolve, reject); });
            sock.on('error', e => { clearTimeout(t); reject(e); });
          }
        });

        sock.on('error', e => {
          if (!upgraded) reject(new Error('Edge TTS 连接失败: ' + e.message));
        });

        const t = setTimeout(() => { sock.destroy(); reject(new Error('Edge TTS: WebSocket 握手超时，可能网络不通或代理未开')); }, 15000);
        sock.once('data', () => clearTimeout(t));

        sock.write(wsHandshake);
      }

      if (proxy) {
        // HTTP CONNECT tunnel through proxy
        const cr = http.request({
          hostname: proxy.host, port: proxy.port,
          method: 'CONNECT', path: `${HOST}:443`,
          timeout: 8000,
        });
        cr.on('connect', (res, raw) => {
          const ts = tls.connect({ socket: raw, host: HOST, servername: HOST }, () => {
            handleUpgrade(ts, true);
          });
          ts.on('error', e => reject(new Error('TLS失败: ' + e.message)));
        });
        cr.on('error', e => reject(new Error(`代理(${proxy.host}:${proxy.port})连接失败: ${e.message}。确认代理已开启？`)));
        cr.on('timeout', () => { cr.destroy(); reject(new Error('代理连接超时')); });
        cr.end();
      } else {
        // Direct TLS
        const ts = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 15000 }, () => {
          handleUpgrade(ts, false);
        });
        ts.on('error', e => reject(new Error('TLS连接失败: ' + e.message)));
        ts.on('timeout', () => { ts.destroy(); reject(new Error('Edge TTS 连接超时')); });
      }
    } catch (e) { reject(e); }
  });
}

// ---- WebSocket frame sender ----
function _wsSend(sock, payload) {
  const buf = Buffer.from(payload, 'utf-8');
  const len = buf.length;

  let hdr;
  if (len < 126) {
    hdr = Buffer.allocUnsafe(6);
    hdr[0] = 0x81; hdr[1] = len | 0x80;
  } else if (len < 65536) {
    hdr = Buffer.allocUnsafe(8);
    hdr[0] = 0x81; hdr[1] = 126 | 0x80;
    hdr.writeUInt16BE(len, 2);
  } else {
    hdr = Buffer.allocUnsafe(14);
    hdr[0] = 0x81; hdr[1] = 127 | 0x80;
    hdr.writeBigUInt64BE(BigInt(len), 2);
  }
  const mask = crypto.randomBytes(4);
  hdr[hdr.length - 4] = mask[0];
  hdr[hdr.length - 3] = mask[1];
  hdr[hdr.length - 2] = mask[2];
  hdr[hdr.length - 1] = mask[3];

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = buf[i] ^ mask[i % 4];

  sock.write(Buffer.concat([hdr, masked]));
}

function _esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Decode WebSocket binary frames → Edge TTS binary format → MP3
function _decode(chunks, outputPath, resolve, reject) {
  const full = Buffer.concat(chunks);
  const audio = [];
  let pos = 0;

  while (pos + 2 <= full.length) {
    const opcode = full[pos] & 0x0f;
    let plen = full[pos + 1] & 0x7f;
    let h = 2;
    if (plen === 126) { plen = full.readUInt16BE(pos + 2); h += 2; }
    else if (plen === 127) { plen = Number(full.readBigUInt64BE(pos + 2)); h += 8; }

    const masked = (full[pos + 1] & 0x80) !== 0;
    const mk = masked ? full.slice(pos + h, pos + h + 4) : null;
    if (masked) h += 4;

    if (pos + h + plen > full.length) break;
    const payload = full.slice(pos + h, pos + h + plen);

    if (masked) { for (let i = 0; i < payload.length; i++) payload[i] ^= mk[i % 4]; }

    if (opcode === 2 && payload.length > 2) {
      const hl = payload.readUInt16BE(0);
      if (payload.length > 2 + hl) {
        audio.push(payload.slice(2 + hl));
      }
    }

    pos += h + plen;
  }

  if (audio.length === 0) { reject(new Error('Edge TTS: 未收到音频数据')); return; }
  try { fs.writeFileSync(outputPath, Buffer.concat(audio)); resolve(outputPath); }
  catch (e) { reject(e); }
}

module.exports = { synthesize };
