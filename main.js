const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const AdmZip = require('adm-zip');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000, height: 640, minWidth: 780, minHeight: 500,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile('src/index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ---- Format Parsers ----

function parseEpub(filePath) {
  const zip = new AdmZip(filePath);
  const parts = [];
  for (const entry of zip.getEntries()) {
    const name = entry.entryName.toLowerCase();
    if (name.endsWith('.html') || name.endsWith('.xhtml') || name.endsWith('.htm')) {
      const text = entry.getData().toString('utf-8')
        .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#?\w+;/g, '')
        .replace(/\n{3,}/g, '\n\n').trim();
      if (text.length > 100) parts.push(text);
    }
  }
  return parts.join('\n\n');
}

function parseMd(filePath) {
  return fs.readFileSync(filePath, 'utf-8')
    .replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1').replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/!\[.*?\]\([^)]+\)/g, '')
    .replace(/^[>\s]*[>]\s?/gm, '').replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '').replace(/^---+$/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function parsePdf(filePath) {
  const { extractPdfText } = require('./pdf-parser');
  return extractPdfText(filePath) || '（PDF解析失败，请转TXT后导入）';
}

// ---- Book Import ----

ipcMain.handle('import-book', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入电子书',
    filters: [{ name: '电子书', extensions: ['epub', 'txt', 'pdf', 'md'] }, { name: '所有文件', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);
  const stats = fs.statSync(filePath);
  let content = null;

  try {
    if (ext === '.txt') content = fs.readFileSync(filePath, 'utf-8');
    else if (ext === '.md') content = parseMd(filePath);
    else if (ext === '.epub') content = parseEpub(filePath);
    else if (ext === '.pdf') content = parsePdf(filePath);
  } catch (err) { console.error('Parse error:', err.message); }

  return {
    id: Date.now().toString(), name: fileName.replace(ext, ''),
    path: filePath, format: ext.replace('.', ''), size: stats.size, content,
    addedAt: new Date().toISOString(),
  };
});

ipcMain.handle('read-file', async (_, p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return null; } });

// ---- Library ----

ipcMain.handle('get-library', async () => {
  const libPath = path.join(app.getPath('userData'), 'library.json');
  try { if (fs.existsSync(libPath)) return JSON.parse(fs.readFileSync(libPath, 'utf-8')); } catch {}
  return [];
});

ipcMain.handle('save-library', async (_, lib) => {
  const libPath = path.join(app.getPath('userData'), 'library.json');
  const dir = path.dirname(libPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(libPath, JSON.stringify(lib, null, 2));
  return true;
});

// ---- TTS ----

const BASE_VOICES = { female: 'zh-CN-XiaoxiaoNeural', male: 'zh-CN-YunxiNeural' };
// Windows SAPI Chinese voices (fallback order)
const SAPI_VOICES = { female: ['Microsoft Huihui Desktop', 'Microsoft Kangkang'], male: ['Microsoft Kangkang', 'Microsoft Huihui Desktop'] };

function synthesizeOne(text, voiceGender, pitchHz, rateStr, outputPath) {
  if (process.platform === 'win32') {
    return synthesizeWindows(text, voiceGender, pitchHz, rateStr, outputPath);
  }
  return synthesizeMacOS(text, voiceGender, pitchHz, rateStr, outputPath);
}

function synthesizeMacOS(text, voiceGender, pitchHz, rateStr, outputPath) {
  const voiceId = BASE_VOICES[voiceGender] || BASE_VOICES.female;
  const edgeTts = path.join(__dirname, '.venv', 'bin', 'edge-tts');

  return new Promise((resolve, reject) => {
    const proc = spawn(edgeTts, [
      '-v', voiceId, '--pitch', pitchHz, '--rate', rateStr,
      '-t', text, '--write-media', outputPath,
    ]);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code !== 0 || !fs.existsSync(outputPath)) { reject(new Error(stderr.trim() || `exit ${code}`)); return; }
      resolve(outputPath);
    });
    proc.on('error', reject);
  });
}

function synthesizeWindows(text, voiceGender, pitchHz, rateStr, outputPath) {
  const rateNum = parseFloat(rateStr) || 0;
  const pitchNum = parseInt(pitchHz) || 0;
  const sapiRate = Math.max(-10, Math.min(10, Math.round(rateNum / 10)));
  const sapiPitch = Math.max(-10, Math.min(10, Math.round(pitchNum / 1.5)));

  // XML-escape text for SSML (must happen BEFORE PS escaping)
  const xmlText = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  // PowerShell escaping for single-quoted string: only ' needs escaping as ''
  const psPath = outputPath.replace(/'/g, "''");

  const voices = SAPI_VOICES[voiceGender] || SAPI_VOICES.female;
  const voiceSelect = voices.map(v => `try { $s.SelectVoice('${v}'); $voiceFound='${v}' } catch {}`).join('; ');

  // Use a here-string for the SSML to avoid PS string escaping nightmares
  const psScript = `\
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voiceFound = ''
${voiceSelect}
if ($voiceFound -eq '') {
  Write-Error "NO_CHINESE_VOICE:请安装中文语音包(设置→语音→添加语音)"
  exit 1
}
$rate = ${sapiRate}
$pitch = ${sapiPitch}
$text = @'
${xmlText}
'@
$ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='$voiceFound'><prosody rate='$rate' pitch='$pitch'>$text</prosody></voice></speak>"
try {
  $s.SetOutputToWaveFile('${psPath}')
  $s.SpeakSsml($ssml)
  $s.Dispose()
  if (-not (Test-Path '${psPath}')) { Write-Error "WAV_NOT_CREATED"; exit 1 }
  Write-Output "OK:${psPath}"
} catch {
  Write-Error $_.Exception.Message
  exit 1
}`;

  const tmpScript = path.join(os.tmpdir(), `tts_${Date.now()}.ps1`);
  fs.writeFileSync(tmpScript, '﻿' + psScript, 'utf-8');

  return new Promise((resolve, reject) => {
    const proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-File', tmpScript], {
      windowsHide: true,
    });
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      try { fs.unlinkSync(tmpScript); } catch {}
      if (code !== 0) {
        const errMsg = stderr.trim() || stdout.trim() || `exit ${code}`;
        reject(new Error(errMsg));
        return;
      }
      // Double-check the file has actual content
      try {
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
          resolve(outputPath);
        } else {
          reject(new Error('WAV file empty or missing'));
        }
      } catch (e) {
        reject(new Error('WAV file check failed: ' + e.message));
      }
    });
    proc.on('error', err => {
      try { fs.unlinkSync(tmpScript); } catch {}
      reject(err);
    });
  });
}

ipcMain.handle('tts-generate', async (_, sentences, outputDir) => {
  const dir = outputDir || path.join(os.tmpdir(), 'novel-player-tts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const files = new Array(sentences.length).fill(null);
  const BATCH = 5;

  for (let i = 0; i < sentences.length; i += BATCH) {
    const batch = sentences.slice(i, i + BATCH).map(async (sent, bi) => {
      const idx = i + bi;
      const text = (sent.text || '').trim();
      if (!text) return;

      const gender = sent.voiceGender || 'female';
      const pitchHz = sent.pitch || '+0Hz';
      const rateStr = sent.rate || '+0%';
      const hash = require('crypto').createHash('md5').update(text + gender + pitchHz + rateStr).digest('hex').slice(0, 8);
      const outputPath = path.join(dir, `s_${String(idx).padStart(5, '0')}_${hash}${process.platform === 'win32' ? '.wav' : '.mp3'}`);

      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        files[idx] = outputPath;
      } else {
        try {
          await synthesizeOne(text, gender, pitchHz, rateStr, outputPath);
          files[idx] = outputPath;
        } catch (err) {
          console.error(`[tts] ${idx} FAILED:`, err.message);
        }
      }
    });
    await Promise.all(batch);
  }

  return { files, output_dir: outputDir };
});

ipcMain.handle('tts-read-audio', async (_, p) => {
  try { return fs.readFileSync(p).toString('base64'); } catch { return null; }
});

// Export audio files
ipcMain.handle('export-audio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const destDir = result.filePaths[0];
  const srcDir = path.join(os.tmpdir(), 'novel-player-tts');
  const exported = [];

  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir).filter(f => (f.endsWith('.mp3') || f.endsWith('.wav')));
    for (const f of files) {
      const src = path.join(srcDir, f);
      const dest = path.join(destDir, f);
      fs.copyFileSync(src, dest);
      exported.push(dest);
    }
  }

  return { count: exported.length, dir: destDir, files: exported };
});

ipcMain.handle('delete-file', async (_, filePath) => {
  try { fs.unlinkSync(filePath); return true; } catch { return false; }
});

// ---- Playlist persistence ----

ipcMain.handle('save-playlists', async (_, data) => {
  const p = path.join(app.getPath('userData'), 'playlists.json');
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); return true; } catch { return false; }
});

ipcMain.handle('load-playlists', async () => {
  const p = path.join(app.getPath('userData'), 'playlists.json');
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  return null;
});

// ---- Settings ----

ipcMain.handle('save-settings', async (_, data) => {
  const p = path.join(app.getPath('userData'), 'settings.json');
  try { fs.writeFileSync(p, JSON.stringify(data, null, 2)); return true; } catch { return false; }
});

ipcMain.handle('load-settings', async () => {
  const p = path.join(app.getPath('userData'), 'settings.json');
  try { if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  return null;
});

ipcMain.handle('choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ---- Import local audio files ----

ipcMain.handle('import-audio', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入音频文件',
    filters: [{ name: '音频', extensions: ['mp3', 'wav', 'aiff', 'm4a'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return [];
  return result.filePaths.map(fp => {
    const stats = fs.statSync(fp);
    return { name: path.basename(fp), path: fp, duration: Math.round(stats.size / 16000) };
  });
});

ipcMain.handle('list-generated-audio', async () => {
  const srcDir = path.join(os.tmpdir(), 'novel-player-tts');
  if (!fs.existsSync(srcDir)) return [];
  return fs.readdirSync(srcDir)
    .filter(f => (f.endsWith('.mp3') || f.endsWith('.wav')))
    .map(f => ({ name: f, path: path.join(srcDir, f), size: fs.statSync(path.join(srcDir, f)).size }))
    .sort((a, b) => a.name.localeCompare(b.name));
});
