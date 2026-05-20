// Minimal Edge TTS client — implements the Microsoft Edge Read Aloud
// WebSocket protocol using only Node.js built-in modules.
// Produces MP3 audio, no external dependencies or Python needed.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const EDGE_HOST = 'speech.platform.bing.com';
const EDGE_PATH = '/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';

const SSML_TMPL = (voice, rate, pitch, text) =>
`<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xmlns:emo="http://www.w3.org/2009/10/emotionml" version="1.0" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${rate}" pitch="${pitch}">${text}</prosody>
  </voice>
</speak>`;

const VOICES = { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' };

/**
 * Synthesize text to an MP3 file via Microsoft Edge TTS.
 * Returns a Promise that resolves with the output path on success.
 */
function synthesize(text, voiceGender, pitchHz, rateStr, outputPath) {
  return new Promise((resolve, reject) => {
    const voice = VOICES[voiceGender] || VOICES.female;
    const ssml = SSML_TMPL(voice, rateStr, pitchHz, _xmlEscape(text));

    // Connect and do WebSocket upgrade
    const req = https.request({
      hostname: EDGE_HOST,
      path: EDGE_PATH,
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Encoding': 'gzip, deflate, br',
      },
      rejectUnauthorized: true,
    });

    req.on('upgrade', (res, socket) => {
      // Send config message
      const config = JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: false, wordBoundaryEnabled: true },
              outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
            },
          },
        },
      });

      _wsSend(socket, config);
      _wsSend(socket, ssml);

      const chunks = [];
      socket.on('data', (data) => {
        chunks.push(data);
      });

      socket.on('end', () => {
        _processAudio(chunks, outputPath, resolve, reject);
      });

      socket.on('error', reject);
    });

    req.on('error', reject);
    req.end();
  });
}

// ---- WebSocket helpers ----

function _wsSend(socket, payload) {
  const buf = Buffer.from(payload, 'utf-8');
  const len = buf.length;
  const frame = Buffer.alloc(2 + (len < 126 ? 0 : 2) + 4 + len);

  // FIN + opcode=1 (text)
  frame[0] = 0x81;

  let offset = 2;
  if (len < 126) {
    frame[1] = len | 0x80; // mask bit set
  } else {
    frame[1] = 126 | 0x80;
    frame.writeUInt16BE(len, 2);
    offset = 4;
  }

  // Mask key
  const mask = crypto.randomBytes(4);
  mask.copy(frame, offset);
  offset += 4;

  // Payload (masked)
  buf.copy(frame, offset);
  for (let i = 0; i < len; i++) {
    frame[offset + i] ^= mask[i % 4];
  }

  socket.write(frame);
}

function _xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function _processAudio(chunks, outputPath, resolve, reject) {
  const full = Buffer.concat(chunks);
  const audioChunks = [];
  let pos = 0;

  // Parse WebSocket frames to extract binary payloads
  while (pos < full.length) {
    if (pos + 2 > full.length) break;
    const b0 = full[pos];
    const b1 = full[pos + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let payloadLen = b1 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) { payloadLen = full.readUInt16BE(pos + 2); headerLen += 2; }
    else if (payloadLen === 127) { payloadLen = Number(full.readBigUInt64BE(pos + 2)); headerLen += 8; }

    const maskKey = masked ? full.slice(pos + headerLen, pos + headerLen + 4) : null;
    if (masked) headerLen += 4;

    const payload = full.slice(pos + headerLen, pos + headerLen + payloadLen);
    if (masked) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }

    // Binary frames (opcode=2) contain audio, text frames (opcode=1) contain JSON headers
    if (opcode === 2 && payload.length > 0) {
      // Parse Edge TTS binary header: headerLen(2) + header + audio data
      if (payload.length >= 2) {
        const hLen = payload.readUInt16BE(0);
        const audioData = payload.slice(2 + hLen);
        if (audioData.length > 0) audioChunks.push(audioData);
      }
    }

    pos += headerLen + payloadLen;
  }

  if (audioChunks.length === 0) {
    reject(new Error('Edge TTS: no audio data received'));
    return;
  }

  try {
    fs.writeFileSync(outputPath, Buffer.concat(audioChunks));
    resolve(outputPath);
  } catch (e) {
    reject(e);
  }
}

module.exports = { synthesize };
