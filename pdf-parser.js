const zlib = require('zlib');
const fs = require('fs');

// Minimal PDF text extractor — handles FlateDecode streams, BT/ET text blocks.
// Covers ~90% of novel PDFs without pulling in 57MB of pdfjs-dist.
//
// PDF parser: finds objects → decompresses streams → extracts text from BT/ET blocks.

function findStreams(buf) {
  const str = buf.toString('latin1');
  const streams = [];

  // Find all "obj ... endobj" blocks
  let pos = 0;
  while ((pos = str.indexOf(' obj', pos)) !== -1) {
    pos += 4;
    const streamStart = str.indexOf('stream\r\n', pos);
    const streamStart2 = str.indexOf('stream\n', pos);
    let headerEnd, dataStart;

    if (streamStart !== -1 && (streamStart2 === -1 || streamStart < streamStart2)) {
      dataStart = streamStart + 8; // 'stream\r\n'.length
    } else if (streamStart2 !== -1) {
      dataStart = streamStart2 + 7; // 'stream\n'.length
    } else {
      continue;
    }

    const endStream = str.indexOf('endstream', dataStart);
    if (endStream === -1) continue;

    // Get the dictionary between "obj ... stream"
    const dict = str.slice(pos, streamStart !== -1 && streamStart < streamStart2 ? streamStart : streamStart2);

    // Determine filter
    const filterMatch = dict.match(/\/Filter\s*\/FlateDecode/i);
    const asciiFilter = dict.match(/\/Filter\s*\/ASCIIHexDecode/i);
    const ascii85Filter = dict.match(/\/Filter\s*\/ASCII85Decode/i);

    const raw = buf.slice(dataStart, endStream);
    let data = null;
    let filter = 'none';

    try {
      if (filterMatch) {
        filter = 'FlateDecode';
        data = zlib.inflateRawSync(raw);
      } else if (ascii85Filter) {
        filter = 'ASCII85Decode';
        data = Buffer.from(decodeAscii85(raw.toString('latin1')), 'latin1');
      } else if (asciiFilter) {
        filter = 'ASCIIHexDecode';
        data = Buffer.from(decodeAsciiHex(raw.toString('latin1')), 'latin1');
      } else {
        data = raw;
      }
    } catch {
      // Try without header if inflateRaw fails
      try { data = zlib.inflateSync(raw); filter = 'FlateDecode'; } catch { data = raw; }
    }

    // Check for nested filters (e.g. /FlateDecode /ASCII85Decode)
    if (filterMatch && dict.match(/\/Filter\s*\[/)) {
      // Multi-filter — attempt simple FlateDecode first, skip if fails
    }

    if (data) {
      streams.push({ dict, data, filter });
    }
    pos = endStream + 9;
  }

  return streams;
}

function decodeAscii85(str) {
  let out = '';
  let group = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '~') break;
    if (c >= '!' && c <= 'u') {
      group.push(c.charCodeAt(0) - 33);
      if (group.length === 5) {
        let n = group[0] * 85 * 85 * 85 * 85 + group[1] * 85 * 85 * 85 + group[2] * 85 * 85 + group[3] * 85 + group[4];
        out += String.fromCharCode((n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
        group = [];
      }
    }
  }
  if (group.length > 0) {
    for (let j = group.length; j < 5; j++) group.push(84);
    let n = group[0] * 85 * 85 * 85 * 85 + group[1] * 85 * 85 * 85 + group[2] * 85 * 85 + group[3] * 85 + group[4];
    for (let j = 0; j < group.length - 1; j++) out += String.fromCharCode((n >> (24 - j * 8)) & 255);
  }
  return out;
}

function decodeAsciiHex(str) {
  let out = '';
  const hex = str.replace(/\s/g, '');
  for (let i = 0; i < hex.length - 1; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

function extractText(content) {
  const result = [];
  const str = typeof content === 'string' ? content : content.toString('latin1');

  // Find BT ... ET blocks and extract text operators
  let pos = 0;
  while ((pos = str.indexOf('BT', pos)) !== -1) {
    const etPos = str.indexOf('ET', pos + 2);
    if (etPos === -1) break;

    const block = str.slice(pos + 2, etPos);
    let text = '';

    // Tj: (string) Tj  — show text
    let tjPos = 0;
    while ((tjPos = block.indexOf('Tj', tjPos)) !== -1) {
      // Find the string before Tj by looking backwards for balanced parens
      const before = block.slice(0, tjPos);
      const m = before.match(/\(([^)]*)\)\s*$/);
      if (m) text += unescapePdfString(m[1]) + '\n';
      tjPos++;
    }

    // TJ: [(str1) num (str2) ...] TJ  — show text array
    let tjArrPos = 0;
    while ((tjArrPos = block.indexOf('TJ', tjArrPos)) !== -1) {
      const before = block.slice(0, tjArrPos);
      const arrMatch = before.match(/\[([^\]]*)\]\s*$/);
      if (arrMatch) {
        const strs = arrMatch[1].match(/\(([^)]*)\)/g);
        if (strs) {
          for (const s of strs) {
            text += unescapePdfString(s.slice(1, -1));
          }
          text += '\n';
        }
      }
      tjArrPos += 2;
    }

    // ': (\') operator — single quote, next line show text
    let sqPos = 0;
    while ((sqPos = block.indexOf("'", sqPos)) !== -1) {
      const before = block.slice(0, sqPos);
      const m = before.match(/\(([^)]*)\)\s*$/);
      if (m) text += unescapePdfString(m[1]);
      sqPos++;
    }

    // ": (") operator — double quote, set word/char spacing and show
    let dqPos = 0;
    while ((dqPos = block.indexOf('"', dqPos)) !== -1) {
      const before = block.slice(0, dqPos);
      const m = before.match(/\(([^)]*)\)\s*$/);
      if (m) text += unescapePdfString(m[1]);
      dqPos++;
    }

    if (text.trim()) result.push(text);
    pos = etPos + 2;
  }

  // If no BT/ET blocks found, try raw text extraction from decompressed content
  if (result.length === 0) {
    const raw = str.replace(/[^\x20-\x7e一-鿿㐀-䶿＀-￯　-〿가-힯
一-鿿㐀-䶿]/g, '');
    if (raw.length > 200) result.push(raw);
  }

  return result.join('\n');
}

function unescapePdfString(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\[0-7]{1,3}/g, m => String.fromCharCode(parseInt(m.slice(1), 8)));
}

/**
 * Extract readable text from a PDF file. Returns null on failure.
 */
function extractPdfText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const streams = findStreams(buf);
    const allText = [];

    for (const s of streams) {
      const text = extractText(s.data);
      if (text && text.length > 50) {
        allText.push(text);
      }
    }

    // Filter out binary/structure streams
    const readable = allText.filter(t => {
      const chineseRatio = (t.match(/[一-鿿]/g) || []).length / Math.max(t.length, 1);
      const asciiRatio = (t.match(/[a-zA-Z]/g) || []).length / Math.max(t.length, 1);
      return chineseRatio > 0.05 || asciiRatio > 0.15;
    });

    if (readable.length === 0) return null;
    return readable.join('\n\n');
  } catch (err) {
    console.error('PDF extract error:', err.message);
    return null;
  }
}

module.exports = { extractPdfText };
