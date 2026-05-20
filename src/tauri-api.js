// Tauri adapter — same API surface as the old electronAPI

(function() {
  var t = window.__TAURI__;
  var invoke = t && t.core && t.core.invoke ? function(cmd, args) {
    return t.core.invoke(cmd, args || {});
  } : null;

  window.electronAPI = {
    importBook:    function()  { return invoke ? invoke('import_book') : Promise.resolve(null); },
    readFile:      function(p) { return invoke ? invoke('read_file', { path: p }) : Promise.resolve(null); },
    getLibrary:    function()  { return invoke ? invoke('get_library') : Promise.resolve([]); },
    saveLibrary:   function(l) { return invoke ? invoke('save_library', { library: l }) : Promise.resolve(false); },
    ttsGenerate:   function(s, d) { return invoke ? invoke('tts_generate', { sentences: s, outputDir: d }) : Promise.resolve(null); },
    ttsReadAudio:  function(p) { return invoke ? invoke('tts_read_audio', { path: p }) : Promise.resolve(null); },
    saveSettings:  function(d) { return invoke ? invoke('save_settings', { data: d }) : Promise.resolve(false); },
    loadSettings:  function()  { return invoke ? invoke('load_settings') : Promise.resolve(null); },
    chooseFolder:  function()  { return invoke ? invoke('choose_folder') : Promise.resolve(null); },
    deleteFile:    function(p) { return invoke ? invoke('delete_file', { path: p }) : Promise.resolve(false); },
    importAudio:   function()  { return invoke ? invoke('import_audio') : Promise.resolve([]); },
    savePlaylists: function(d) { return invoke ? invoke('save_playlists', { data: d }) : Promise.resolve(false); },
    loadPlaylists: function()  { return invoke ? invoke('load_playlists') : Promise.resolve(null); },
    exportAudio:   function()  { return invoke ? invoke('export_audio') : Promise.resolve(null); },
  };
})();
