/* ============================================
   TTS Engine v8 — 分段音频 + 滑动窗口缓冲
   每200句一段，先生成5段，播到第4段时再生成2段
   ============================================ */

class TTSEngine {
  constructor() {
    this.narratorGender = 'female';
    this.isSpeaking = false;
    this.speed = 1.0;
    this.emotionLevel = 0.5;
    this.volume = 0.8;
    this._pauseMs = 50;
    this.audioElement = null;

    // Segment management
    this.SEG_SIZE = 200;         // sentences per segment
    this.PRE_GEN = 5;            // generate this many segments ahead
    this.REFILL_AT = 2;          // when only this many left, generate more

    this.segments = [];          // { startIdx, endIdx, filePath, sentences }
    this.allSentences = [];
    this.currentSegIdx = 0;
    this.currentSentIdx = 0;
    this._genPromise = null;
    this._stopGen = false;

    this.onSentenceChange = null;
    this.onSegmentChange = null;
    this.onStart = null;
    this.onEnd = null;
    this.onProgress = null;
  }

  async init() { return true; }
  setNarratorGender(g) { this.narratorGender = g; }
  setSpeed(s) { this.speed = s; if (this.audioElement) this.audioElement.playbackRate = s; }
  setEmotionLevel(l) { this.emotionLevel = l; }
  setVolume(v) { this.volume = v; if (this.audioElement) this.audioElement.volume = v; }
  getCharacterList() { return []; }

  // ====== TEXT ANALYSIS ======

  analyzeText(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.replace(/\n{4,}/g, '\n\n\n').replace(/[ \t]{2,}/g, ' ');

    const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
    const sentences = [];
    let dialogueTone = 0;

    for (let pi = 0; pi < paragraphs.length; pi++) {
      const clean = paragraphs[pi].trim();
      if (/^(第[一二三四五六七八九十百千\d]+[章节回卷]|Chapter\s+\d+|序章|楔子|尾声|番外)/i.test(clean)) {
        sentences.push({ text: clean, type: 'chapter' });
        continue;
      }
      const parts = this._splitMixed(clean);
      const hasDialogue = parts.some(p => p.isDialogue);
      const prevPara = pi > 0 ? paragraphs[pi-1] : '';
      const isConnected = this._isConnected(prevPara, clean);
      if (hasDialogue && !isConnected) dialogueTone = 1 - dialogueTone;

      for (const p of parts) {
        if (p.isDialogue) {
          p._pitch = dialogueTone === 0 ? '+0Hz' : '+3Hz';
          p._rate  = dialogueTone === 0 ? '+0%'  : '+2%';
        } else {
          p._pitch = '+0Hz'; p._rate = '+0%';
        }
        sentences.push(p);
      }
    }

    for (const s of sentences) {
      s.voiceGender = s.voiceGender || this.narratorGender;
      if (!s.pitch) s.pitch = s._pitch || '+0Hz';
      if (!s.rate)  s.rate  = s._rate  || '+0%';
    }

    return sentences;
  }

  _isConnected(prev, cur) {
    const dRe = /(“|”|\x22|「)/;
    return dRe.test(prev) && /^\s*(“|”|\x22|「)/.test(cur);
  }

  _splitMixed(para) {
    const result = [];
    const dRe = /(“|”)[^“”]+?(“|”)|\x22([^\x22]+)\x22|「([^」]+)」/g;
    let lastIdx = 0, match;
    while ((match = dRe.exec(para)) !== null) {
      if (match.index > lastIdx) {
        const n = para.slice(lastIdx, match.index).trim();
        if (n) for (const s of this._toSentences(n)) result.push({ text: s, type: 'narration', isDialogue: false });
      }
      let inner;
      if (match[3] !== undefined) inner = match[3].trim();
      else if (match[4] !== undefined) inner = match[4].trim();
      else inner = match[0].slice(1, -1).trim();
      if (inner) result.push({ text: inner, type: 'dialogue', isDialogue: true, emotion: this._detectEmotion(inner) });
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < para.length) {
      const n = para.slice(lastIdx).trim();
      if (n) for (const s of this._toSentences(n)) result.push({ text: s, type: 'narration', isDialogue: false });
    }
    if (result.length === 0) {
      for (const s of this._toSentences(para)) result.push({ text: s, type: 'narration', isDialogue: false });
    }
    return result;
  }

  _toSentences(text) {
    const r = []; const re = /([^。！？.!?\n]+[。！？.!?\n]?)/g; let m;
    while ((m = re.exec(text)) !== null) { const s = m[1].trim(); if (s && s.length > 1) r.push(s); }
    return r;
  }

  _detectEmotion(text) {
    if (/(?:怒吼|咆哮|吼道|大喊|怒道|愤怒|暴怒|！{2})/.test(text)) return 'excited';
    if (/(?:哭|泪|伤心|难过|悲伤|痛苦|叹气|叹息)/.test(text)) return 'sad';
    if (/(?:轻声|悄悄|低声|小声|耳语|呢喃)/.test(text)) return 'whisper';
    return 'default';
  }

  // Naturalize tone particles for more human-like speech
  naturalizeText(text) {
    let t = text.trim();
    if (!t) return t;

    // Opening particles: add thinking pause
    t = t.replace(/^([唉哎嗯哦噢啧呵嘿])/, '...$1');

    // Soft sentence-ending particles: gentle ending
    t = t.replace(/([呢吧嘛])([。\s]*)$/g, '$1～$2');
    t = t.replace(/([啊呀啦哇])([。\s]*)$/g, '$1$2');

    // Question particles: ensure question mark
    if (/(吗|呢|吧|不成|否|是否)/.test(t) && !/[？?]$/.test(t)) {
      t = t.replace(/[。.]$/, '？');
      if (!/[？?。.]$/.test(t)) t += '？';
    }

    // Exclamation: ensure exclamation mark
    if (/(！|!|太|好|真|多么|多么|极了|死了|透了)/.test(t) && !/[！!]$/.test(t)) {
      if (/[。.]$/.test(t)) t = t.replace(/[。.]$/, '！');
    }

    // Emphasis words: add slight pause before
    t = t.replace(/([，,]\s*)(其实|但是|可是|然而|不过|只是|偏偏|竟然|居然|果然)/g, '$1...$2');

    // Whisper indicators
    t = t.replace(/(轻声|小声|悄悄|低声|耳语)(.{0,5})说/g, '$1$2...说');

    return t;
  }

  // ====== SEGMENT GENERATION ======

  async initSegments(sentences) {
    this.stop();
    this.allSentences = sentences;
    this.currentSegIdx = 0;
    this.currentSentIdx = 0;
    this._stopGen = false;

    // Split into segments
    this.segments = [];
    for (let i = 0; i < sentences.length; i += this.SEG_SIZE) {
      const end = Math.min(i + this.SEG_SIZE, sentences.length);
      this.segments.push({ startIdx: i, endIdx: end, filePath: null, ready: false });
    }

    // Generate first batch
    const count = Math.min(this.PRE_GEN, this.segments.length);
    this._genPromise = this._genSegments(0, count);
    await this._genPromise;
  }

  async _genSegments(fromIdx, count) {
    const end = Math.min(fromIdx + count, this.segments.length);
    const ratePct = Math.round((this.speed - 1) * 100);

    // Generate segments in parallel batches of 3
    for (let i = fromIdx; i < end; i += 3) {
      if (this._stopGen) break;
      const batch = [];
      for (let j = i; j < Math.min(i + 3, end); j++) {
        if (this.segments[j].ready) continue;
        const seg = this.segments[j];
        const sents = this.allSentences.slice(seg.startIdx, seg.endIdx);
        const joined = sents.map(s => {
          const pj = Math.round((Math.random() - 0.5) * 4);
          const rj = Math.round((Math.random() - 0.5) * 4);
          return {
            text: s.text,
            voiceGender: s.voiceGender || this.narratorGender,
            pitch: this._shiftHz(s.pitch || '+0Hz', pj),
            rate: this._shiftPct(this._shiftPct(s.rate || '+0%', ratePct), rj),
          };
        });
        batch.push({ idx: j, joined });
      }
      if (batch.length === 0) continue;

      const results = await Promise.all(batch.map(b =>
        window.electronAPI.ttsGenerate(b.joined).catch(() => null)
      ));

      for (let k = 0; k < results.length; k++) {
        const r = results[k];
        if (r && r.files[0]) {
          this.segments[batch[k].idx].filePath = r.files[0];
          this.segments[batch[k].idx].ready = true;
        }
      }
    }
  }

  _buildSegmentData(sentences) {
    const ratePct = Math.round((this.speed - 1) * 100);
    return sentences.map(s => {
      const pj = Math.round((Math.random() - 0.5) * 4);
      const rj = Math.round((Math.random() - 0.5) * 4);
      return {
        text: s.text,
        voiceGender: s.voiceGender || this.narratorGender,
        pitch: this._shiftHz(s.pitch || '+0Hz', pj),
        rate: this._shiftPct(this._shiftPct(s.rate || '+0%', ratePct), rj),
      };
    });
  }

  // ====== SEGMENT PLAYBACK ======

  stop() {
    this.isSpeaking = false;
    this._stopGen = true;
    if (this.audioElement) { this.audioElement.pause(); this.audioElement = null; }
  }

  playSegments() {
    this.isSpeaking = true;
    if (this.onStart) this.onStart();
    this._playCurrentSegment();
  }

  async _playCurrentSegment() {
    if (!this.isSpeaking || this.currentSegIdx >= this.segments.length) {
      this.isSpeaking = false;
      if (this.onEnd) this.onEnd();
      return;
    }

    const seg = this.segments[this.currentSegIdx];

    // Wait if segment not ready yet
    if (!seg.ready) {
      await new Promise(r => setTimeout(r, 500));
      if (this.isSpeaking) this._playCurrentSegment();
      return;
    }

    // Buffer check: generate more if running low
    const readyCount = this.segments.filter(s => s.ready).length;
    const remaining = readyCount - this.currentSegIdx;
    if (remaining <= this.REFILL_AT && !this._stopGen) {
      const nextToGen = this.currentSegIdx + readyCount;
      if (nextToGen < this.segments.length) {
        this._genSegments(nextToGen, this.PRE_GEN - remaining + this.REFILL_AT);
      }
    }

    if (this.onSegmentChange) this.onSegmentChange(this.currentSegIdx, seg);

    try {
      const b64 = await window.electronAPI.ttsReadAudio(seg.filePath);
      if (!b64) { this.currentSegIdx++; this._playCurrentSegment(); return; }

      const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = this.speed;
      audio.volume = this.volume;
      this.audioElement = audio;

      // Track sentence within segment
      const startTime = Date.now();
      const checkInterval = setInterval(() => {
        if (!this.isSpeaking || this.audioElement !== audio) { clearInterval(checkInterval); return; }
        const elapsed = (Date.now() - startTime) / 1000;
        const segSentences = seg.endIdx - seg.startIdx;
        const segDuration = segSentences * 3; // estimate ~3s per sentence
        const frac = Math.min(1, elapsed / segDuration);
        const sentIdx = seg.startIdx + Math.floor(frac * segSentences);
        if (sentIdx !== this.currentSentIdx && sentIdx < this.allSentences.length) {
          this.currentSentIdx = sentIdx;
          if (this.onSentenceChange) this.onSentenceChange(sentIdx);
        }
      }, 500);

      audio.onended = () => {
        clearInterval(checkInterval);
        URL.revokeObjectURL(url);
        this.audioElement = null;
        this.currentSegIdx++;
        if (this.isSpeaking) this._playCurrentSegment();
      };
      audio.onerror = () => {
        clearInterval(checkInterval);
        URL.revokeObjectURL(url);
        this.audioElement = null;
        this.currentSegIdx++;
        if (this.isSpeaking) this._playCurrentSegment();
      };
      audio.play().catch(() => {});
    } catch {
      this.currentSegIdx++;
      if (this.isSpeaking) this._playCurrentSegment();
    }
  }

  pause() { this.isSpeaking = false; if (this.audioElement) this.audioElement.pause(); }
  resume() { this.isSpeaking = true; if (this.audioElement) this.audioElement.play(); }
  skipForward(s) { if (this.audioElement) this.audioElement.currentTime += s; }
  skipBackward(s) { if (this.audioElement) this.audioElement.currentTime = Math.max(0, this.audioElement.currentTime - s); }

  _shiftHz(c, d) { const v = parseFloat(c) || 0; const r = Math.round(v + d); return (r>=0?'+':'')+r+'Hz'; }
  _shiftPct(c, d) { const v = parseFloat(c) || 0; const r = Math.round(v + d); return (r>=0?'+':'')+r+'%'; }
}

window.TTSEngine = TTSEngine;
