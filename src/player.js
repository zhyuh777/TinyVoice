/* ============================================
   Player Controller v11 — Tabs + Modals
   ============================================ */

class PlayerController {
  constructor(tts, books) {
    this.tts = tts; this.books = books;

    // Playlists
    this.playlists = { '__default__': { name: '🏠 我的收藏', tracks: [] } };
    this.activePlaylist = '__default__'; this.playlistOrder = ['__default__'];

    // Playback
    this.currentTrack = -1; this.currentPlaylist = '__default__';
    this.audio = null; this.isPlaying = false; this.isPaused = false; this._playToken = 0;

    // Export
    this.exportingBook = null; this.exportSentences = []; this.exportAbort = false;

    // Settings
    this.settings = {
      theme:'light', exportPath:'', fontSize:'13', zoom:'100',
      speed:'90', naturalness:'40', pauseMs:'200', emotion:'50', narratorGender:'female',
    };

    this.el = {}; this._cache(); this._bindEvents();
  }

  _cache() {
    const ids = [
      'book-list','book-list-empty','playlist-nav','sidebar-books','sidebar-playlists',
      'main-books','main-playlists','book-detail','playlist-title',
      'track-list','track-list-empty',
      'player-bar','player-track-name','player-time','player-seek',
      'btn-play','btn-stop','speed-slider-play','speed-label','volume',
      'btn-import-book','btn-import-audio','btn-new-playlist','btn-delete-playlist',
      'btn-settings','btn-close-settings','btn-settings2',
      'settings-export-path','btn-choose-export-path',
      'export-path-display','btn-change-export-path',
      'font-size-select','zoom-slider','zoom-val',
      'modal-overlay','export-overlay','settings-modal',
      'export-book-name','btn-close-export',
      'speed-slider','speed-val','naturalness','naturalness-val',
      'pause-ms','pause-val','emotion-level','emotion-val',
      'btn-start-export','export-progress',
    ];
    ids.forEach(id => { this.el[id.replace(/-([a-z])/g, (_,c)=>c.toUpperCase())] = document.getElementById(id); });
    // Also cache settings2 which has different ID pattern
    if (!this.el.btnSettings2) this.el.btnSettings2 = document.getElementById('btn-settings2');
  }

  _bindEvents() {
    // Tabs
    document.querySelectorAll('.sidebar-tab').forEach(tab => {
      tab.addEventListener('click', () => this._switchTab(tab.dataset.view));
    });

    // Books
    this.el.btnImportBook.addEventListener('click', () => this.importBook());

    // Playlists
    this.el.btnImportAudio.addEventListener('click', () => this._importAudio());
    this.el.btnNewPlaylist.addEventListener('click', () => this._newPlaylist());
    this.el.btnDeletePlaylist.addEventListener('click', () => this._deleteCurrentPlaylist());

    // Player
    this.el.btnPlay.addEventListener('click', () => this._togglePlay());
    this.el.btnStop.addEventListener('click', () => this._stop());
    this.el.speedSliderPlay.addEventListener('input', e => {
      const v = parseInt(e.target.value)/100;
      if (this.audio) this.audio.playbackRate = v;
      this.el.speedLabel.textContent = v.toFixed(2)+'x';
    });
    this.el.volume.addEventListener('input', e => {
      if (this.audio) this.audio.volume = parseInt(e.target.value)/100;
    });
    this.el.playerSeek.addEventListener('input', e => {
      if (this.audio?.duration) this.audio.currentTime = (parseInt(e.target.value)/1000)*this.audio.duration;
    });

    // Settings
    this.el.btnSettings.addEventListener('click', () => this._openModal('settings'));
    this.el.btnSettings2.addEventListener('click', () => this._openModal('settings'));
    this.el.btnCloseSettings.addEventListener('click', () => this._closeModal('settings'));
    this.el.modalOverlay.addEventListener('click', e => { if (e.target === this.el.modalOverlay) this._closeModal('settings'); });
    this.el.exportOverlay.addEventListener('click', e => { if (e.target === this.el.exportOverlay) this._closeModal('export'); });
    this.el.btnCloseExport.addEventListener('click', () => this._closeModal('export'));

    // Theme buttons
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.theme-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.documentElement.setAttribute('data-theme', b.dataset.theme);
        this.settings.theme = b.dataset.theme; this._saveSettings();
      });
    });

    // Font size
    this.el.fontSizeSelect.addEventListener('change', e => {
      document.body.style.fontSize = e.target.value+'px'; this.settings.fontSize = e.target.value; this._saveSettings();
    });
    // Zoom
    this.el.zoomSlider.addEventListener('input', e => {
      this.el.zoomVal.textContent = e.target.value+'%'; this.settings.zoom = e.target.value;
    });
    this.el.zoomSlider.addEventListener('change', () => this._saveSettings());

    // Export path
    this.el.btnChooseExportPath.addEventListener('click', () => this._pickExportPath());
    this.el.btnChangeExportPath.addEventListener('click', () => this._pickExportPath());

    // Export settings
    this.el.speedSlider.addEventListener('input', e => { this.el.speedVal.textContent = (parseInt(e.target.value)/100).toFixed(2)+'x'; });
    this.el.speedSlider.addEventListener('change', () => { this.settings.speed = this.el.speedSlider.value; this._saveSettings(); });
    this.el.naturalness.addEventListener('input', e => { this.el.naturalnessVal.textContent = e.target.value; });
    this.el.naturalness.addEventListener('change', () => { this.settings.naturalness = this.el.naturalness.value; this._saveSettings(); });
    this.el.pauseMs.addEventListener('input', e => { this.el.pauseVal.textContent = e.target.value+'ms'; });
    this.el.pauseMs.addEventListener('change', () => { this.settings.pauseMs = this.el.pauseMs.value; this._saveSettings(); });
    this.el.emotionLevel.addEventListener('input', e => { this.el.emotionVal.textContent = e.target.value; });
    this.el.emotionLevel.addEventListener('change', () => { this.settings.emotion = this.el.emotionLevel.value; this._saveSettings(); });

    // Narrator gender
    document.querySelectorAll('.voice-gender-btn').forEach(b => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.voice-gender-btn').forEach(x => x.classList.remove('active-male','active-female'));
        b.classList.add(b.dataset.g==='male'?'active-male':'active-female');
        this.tts.setNarratorGender(b.dataset.g);
        this.settings.narratorGender = b.dataset.g; this._saveSettings();
      });
    });

    // Export
    this.el.btnStartExport.addEventListener('click', () => this._startExport());
  }

  // ======== TABS ========

  _switchTab(view) {
    document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    this.el.sidebarBooks.style.display = view==='books' ? 'flex' : 'none';
    this.el.sidebarPlaylists.style.display = view==='playlists' ? 'flex' : 'none';
    this.el.mainBooks.style.display = view==='books' ? 'flex' : 'none';
    this.el.mainPlaylists.style.display = view==='playlists' ? 'flex' : 'none';
    if (view === 'playlists') this._renderTracks();
  }

  // ======== MODALS ========

  _openModal(type) {
    if (type === 'settings') this.el.modalOverlay.style.display = 'flex';
    else this.el.exportOverlay.style.display = 'flex';
  }
  _closeModal(type) {
    if (type === 'settings') this.el.modalOverlay.style.display = 'none';
    else { this.exportAbort = true; this.el.exportOverlay.style.display = 'none'; }
  }

  async _pickExportPath() {
    const folder = await window.electronAPI.chooseFolder();
    if (folder) { this.settings.exportPath = folder; this._updateExportPathUI(); this._saveSettings(); }
  }
  _updateExportPathUI() {
    const p = this.settings.exportPath || '~/Downloads';
    if (this.el.settingsExportPath) this.el.settingsExportPath.textContent = p;
    if (this.el.exportPathDisplay) this.el.exportPathDisplay.textContent = p;
  }

  // ======== BOOKS ========

  async loadLibrary() { this._renderBooks(await this.books.loadLibrary()); }

  async importBook() {
    const b = await this.books.importBook();
    if (b) { this._renderBooks(this.books.library); this._openExport(b.id); }
  }

  _renderBooks(lib) {
    const l = this.el.bookList, e = this.el.bookListEmpty;
    if (lib.length===0) { l.style.display='none'; e.style.display='block'; return; }
    l.style.display='block'; e.style.display='none';
    l.innerHTML = lib.map(b => `<li class="book-item" data-id="${b.id}"><span class="icon">📄</span><span class="name">${this._esc(b.name)}</span></li>`).join('');
    l.querySelectorAll('.book-item').forEach(li => {
      li.addEventListener('click', () => this._openExport(li.dataset.id));
    });
  }

  async _openExport(bookId) {
    const r = await this.books.selectBook(bookId);
    if (!r) return;
    this.exportingBook = r;
    this.el.exportBookName.textContent = '📖 '+r.book.name;
    this.el.exportProgress.textContent = r.content.length < 1000 ? r.content.length+'字' : (r.content.length/10000).toFixed(1)+'万字';
    this._updateExportPathUI();
    try { this.exportSentences = this.tts.analyzeText(r.content); }
    catch { this.exportSentences = this._simpleSplit(r.content); }

    // Highlight the book and show detail
    this._renderBooks(this.books.library);
    this.el.bookDetail.innerHTML = `<span class="empty-icon">📖</span><p>${r.book.name}</p><p class="hint">${this.el.exportProgress.textContent} · ${r.book.format.toUpperCase()}</p><p class="hint" style="margin-top:8px">点击「📖 导入电子书」旁弹出导出设置</p>`;
    this.el.mainBooks.querySelector('#book-detail').style.display = 'flex';
    this._openModal('export');
  }

  // ======== PLAYLISTS ========

  _newPlaylist() {
    const name = prompt('歌单名称：'); if (!name) return;
    const id = 'pl_'+Date.now();
    this.playlists[id] = { name, tracks:[] };
    this.playlistOrder.push(id);
    this._switchPlaylist(id); this._savePlaylists();
  }

  _deleteCurrentPlaylist() {
    if (this.activePlaylist === '__default__') return;
    if (!confirm('删除此歌单？音频文件不会被删除。')) return;
    delete this.playlists[this.activePlaylist];
    this.playlistOrder = this.playlistOrder.filter(id => id !== this.activePlaylist);
    this.activePlaylist = '__default__';
    this._switchPlaylist('__default__'); this._savePlaylists();
  }

  _switchPlaylist(id) {
    this.activePlaylist = id;
    this.el.playlistTitle.textContent = this.playlists[id]?.name || '歌单';
    this.el.btnDeletePlaylist.style.display = id === '__default__' ? 'none' : 'inline-block';
    this._renderTracks(); this._renderPlaylistNav();
  }

  _renderPlaylistNav() {
    const ul = this.el.playlistNav;
    ul.innerHTML = this.playlistOrder.map(id => {
      const pl = this.playlists[id]; if (!pl) return '';
      return `<li class="pl-nav-item${id===this.activePlaylist?' active':''}" data-id="${id}"><span class="name">${pl.name}</span><span class="count">${pl.tracks.length}</span></li>`;
    }).join('');
    ul.querySelectorAll('.pl-nav-item').forEach(li => {
      li.addEventListener('click', () => this._switchPlaylist(li.dataset.id));
    });
  }

  _renderTracks() {
    const pl = this.playlists[this.activePlaylist];
    const tracks = pl?.tracks || [];
    const ul = this.el.trackList, empty = this.el.trackListEmpty;
    if (tracks.length===0) { ul.style.display='none'; empty.style.display='flex'; return; }
    ul.style.display='block'; empty.style.display='none';
    ul.innerHTML = tracks.map((t,i) => `
      <li class="track-item${i===this.currentTrack&&this.currentPlaylist===this.activePlaylist?' active':''}" data-idx="${i}">
        <span class="track-idx">${String(i+1).padStart(2,'0')}</span><span class="track-icon">🎵</span>
        <div class="track-info"><div class="track-name">${this._esc(t.name)}</div><div class="track-meta">${this._fmtDur(t.duration)}</div></div>
        <button class="track-del" data-idx="${i}">×</button>
      </li>`).join('');
    ul.querySelectorAll('.track-item').forEach(li => {
      li.addEventListener('click', e => { if (!e.target.classList.contains('track-del')) this._playTrack(parseInt(li.dataset.idx)); });
    });
    ul.querySelectorAll('.track-del').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this._deleteTrack(parseInt(btn.dataset.idx)); });
    });
  }

  _deleteTrack(idx) {
    const pl = this.playlists[this.activePlaylist]; if (!pl) return;
    const t = pl.tracks[idx]; if (!t) return;
    if (t.path && window.electronAPI) window.electronAPI.deleteFile(t.path);
    pl.tracks.splice(idx,1);
    if (this.currentTrack===idx&&this.currentPlaylist===this.activePlaylist) this._stop();
    else if (this.currentTrack>idx&&this.currentPlaylist===this.activePlaylist) this.currentTrack--;
    this._savePlaylists(); this._renderTracks(); this._renderPlaylistNav();
  }

  // ======== EXPORT ========

  async _startExport() {
    const prog = this.el.exportProgress;
    prog.textContent = '⏳ 检查数据...';
    if (!this.exportingBook) { prog.textContent = '❌ 未选择书籍'; return; }
    if (!this.exportSentences || this.exportSentences.length === 0) { prog.textContent = '❌ 文本分析失败，请重新导入'; return; }
    this.exportAbort = false;
    const SEG = 1000;
    const totalSegs = Math.ceil(this.exportSentences.length / SEG);
    if (!confirm(`导出 ${totalSegs} 个音频（每段${SEG}句），约 ${Math.round(totalSegs*5)}MB。\n音频加入「我的收藏」。\n确定？`)) {
      prog.textContent = '已取消';
      return;
    }

    const speed = parseInt(this.el.speedSlider.value)/100;
    const nat = parseInt(this.el.naturalness.value)/100;
    const pauseMs = parseInt(this.el.pauseMs.value);
    const rPct = Math.round((speed-1)*100);
    const book = this.exportingBook.book;
    const playlist = this.playlists['__default__'];
    this.el.btnStartExport.disabled = true; this.el.btnStartExport.textContent = '导出中...';

    for (let i = 0; i < totalSegs; i++) {
      if (this.exportAbort) break;
      const segSents = this.exportSentences.slice(i*SEG, Math.min((i+1)*SEG, this.exportSentences.length));
      const parts = segSents.map(s => this.tts.naturalizeText(s.text));
      const sep = pauseMs>0 ? '。'.repeat(Math.max(1,Math.round(pauseMs/200))) : '。';
      const combined = parts.join(sep);
      const pitchBase = nat>0.5 ? this._shiftHz('+0Hz', Math.round((Math.random()-0.5)*6*nat)) : '+0Hz';
      const data = [{ text:combined, voiceGender:this.tts.narratorGender, pitch:pitchBase, rate:rPct>=0?'+'+rPct+'%':rPct+'%' }];
      try {
        prog.textContent = `${i+1}/${totalSegs} 生成中...`;
        const res = await window.electronAPI.ttsGenerate(data, this.settings.exportPath||null);
        const fp = res?.files?.[0];
        if (fp) {
          playlist.tracks.push({ name:`${book.name}_段${i+1}`, path:fp, duration:segSents.length*3 });
          prog.textContent = `${i+1}/${totalSegs} ✅`;
        } else {
          prog.textContent = `${i+1}/${totalSegs} ⚠️ 未返回文件路径`;
        }
      } catch (err) { prog.textContent = `❌ 段${i+1}: ${err.message}`; alert(`导出失败: ${err.message}`); break; }
    }
    this.el.btnStartExport.disabled = false; this.el.btnStartExport.textContent = '开始导出';
    if (playlist.tracks.length > 0) {
      prog.textContent = `完成！${playlist.tracks.length} 个音频已加入「我的收藏」`;
    }
    this._savePlaylists(); this._renderPlaylistNav();
  }

  // ======== PLAYBACK ========

  _playTrack(idx) {
    const pl = this.playlists[this.activePlaylist]; if (!pl) return;
    const t = pl.tracks[idx]; if (!t?.path) return;
    this.currentPlaylist = this.activePlaylist; this.currentTrack = idx;
    this._playToken = Date.now(); this._playCurrentTrack();
  }

  _playCurrentTrack() {
    const pl = this.playlists[this.currentPlaylist]; if (!pl) return;
    const t = pl.tracks[this.currentTrack]; if (!t?.path) { this._stop(); return; }
    this._killAudio();
    const token = this._playToken;
    const speed = parseFloat(this.el.speedLabel?.textContent)||1;
    window.electronAPI.ttsReadAudio(t.path).then(b64 => {
      if (this._playToken !== token) return;
      if (!b64) { this._nextTrack(); return; }
      this._killAudio();
      const mime = t.path.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg';
      const blob = new Blob([Uint8Array.from(atob(b64), c=>c.charCodeAt(0))],{type:mime});
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url); audio.playbackRate = speed;
      audio.volume = parseInt(this.el.volume.value)/100;
      this.audio = audio; this.isPlaying = true; this.isPaused = false; this._updateBtn(); this._renderTracks();
      audio.ontimeupdate = () => {
        if (audio.duration) { this.el.playerSeek.value = Math.round((audio.currentTime/audio.duration)*1000); this.el.playerTime.textContent = this._fmtDur(audio.currentTime)+' / '+this._fmtDur(audio.duration); }
      };
      audio.onended = () => { URL.revokeObjectURL(url); if (this.audio===audio) this._nextTrack(); };
      audio.onerror = () => { URL.revokeObjectURL(url); if (this.audio===audio) this._nextTrack(); };
      this.el.playerTrackName.textContent = t.name; audio.play().catch(()=>{});
    }).catch(() => { if (this._playToken===token) this._nextTrack(); });
  }

  _killAudio() { if (this.audio) { this.audio.pause(); this.audio.src=''; this.audio.load(); this.audio=null; } }
  _nextTrack() {
    const pl = this.playlists[this.currentPlaylist];
    if (pl && this.currentTrack+1 < pl.tracks.length) { this.currentTrack++; this._playToken = Date.now(); this._playCurrentTrack(); }
    else this._stop();
  }
  _togglePlay() {
    if (!this.audio) { this._playTrack(0); return; }
    if (this.audio.paused) { this.audio.play(); this.isPlaying=true; this.isPaused=false; }
    else { this.audio.pause(); this.isPlaying=false; this.isPaused=true; }
    this._updateBtn();
  }
  _stop() {
    this._playToken = Date.now(); this._killAudio();
    this.isPlaying=false; this.isPaused=false; this.currentTrack=-1; this._updateBtn(); this._renderTracks();
    this.el.playerTrackName.textContent='未在播放'; this.el.playerTime.textContent='00:00 / 00:00'; this.el.playerSeek.value=0;
  }
  _updateBtn() { this.el.btnPlay.textContent = this.isPlaying && !this.isPaused ? '⏸' : '▶'; }

  // ======== AUDIO IMPORT ========

  async _importAudio() {
    if (!window.electronAPI) return;
    const files = await window.electronAPI.importAudio();
    if (!files?.length) return;
    const pl = this.playlists[this.activePlaylist] || this.playlists['__default__'];
    for (const f of files) pl.tracks.push({ name:f.name, path:f.path, duration:f.duration||180 });
    this._switchPlaylist(this.activePlaylist); this._savePlaylists();
  }

  // ======== SETTINGS PERSISTENCE ========

  async loadSettings() {
    if (!window.electronAPI) return;
    const saved = await window.electronAPI.loadSettings();
    if (saved) Object.assign(this.settings, saved);
    this._applySettings();
  }

  _applySettings() {
    const s = this.settings;
    document.documentElement.setAttribute('data-theme', s.theme||'light');
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme===(s.theme||'light')));
    this._updateExportPathUI();
    if (this.el.fontSizeSelect) { this.el.fontSizeSelect.value = s.fontSize||'13'; document.body.style.fontSize = (s.fontSize||'13')+'px'; }
    if (this.el.zoomSlider) { this.el.zoomSlider.value = s.zoom||'100'; this.el.zoomVal.textContent = (s.zoom||'100')+'%'; }
    if (this.el.speedSlider) { this.el.speedSlider.value = s.speed||'90'; this.el.speedVal.textContent = ((parseInt(s.speed)||90)/100).toFixed(2)+'x'; }
    if (this.el.naturalness) { this.el.naturalness.value = s.naturalness||'40'; this.el.naturalnessVal.textContent = s.naturalness||'40'; }
    if (this.el.pauseMs) { this.el.pauseMs.value = s.pauseMs||'200'; this.el.pauseVal.textContent = (s.pauseMs||'200')+'ms'; }
    if (this.el.emotionLevel) { this.el.emotionLevel.value = s.emotion||'50'; this.el.emotionVal.textContent = s.emotion||'50'; }
    if (s.narratorGender) this.tts.setNarratorGender(s.narratorGender);
    document.querySelectorAll('.voice-gender-btn').forEach(b => {
      b.classList.toggle('active-male', b.dataset.g==='male'&&s.narratorGender==='male');
      b.classList.toggle('active-female', b.dataset.g==='female'&&s.narratorGender!=='male');
    });
  }

  async _saveSettings() { if (window.electronAPI) await window.electronAPI.saveSettings(this.settings); }

  // ======== PLAYLIST PERSISTENCE ========

  async _savePlaylists() {
    if (!window.electronAPI) return;
    await window.electronAPI.savePlaylists({ order:this.playlistOrder, playlists:this.playlists });
  }
  async loadPlaylists() {
    if (!window.electronAPI) return;
    const data = await window.electronAPI.loadPlaylists();
    if (data?.playlists) { this.playlists = data.playlists; this.playlistOrder = data.order||Object.keys(data.playlists); this.activePlaylist = this.playlistOrder[0]||'__default__'; }
    this._renderPlaylistNav(); this._switchPlaylist(this.activePlaylist);
  }

  // ======== HELPERS ========

  _simpleSplit(text) { const r=[]; const re=/([^。！？.!?\n]+[。！？.!?\n]?)/g; let m; while((m=re.exec(text))!==null){const s=m[1].trim();if(s&&s.length>1)r.push({text:s,type:'narration'});} return r; }
  _fmtDur(s) { const m=Math.floor(s/60),sec=Math.floor(s%60); return m+':'+String(sec).padStart(2,'0'); }
  _esc(t) { const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }
  _shiftHz(c,d) { const v=parseFloat(c)||0; const r=Math.round(v+d); return (r>=0?'+':'')+r+'Hz'; }
}

window.PlayerController = PlayerController;
