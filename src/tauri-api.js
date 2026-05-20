// Tauri adapter — same API surface as the old electronAPI
// Retries until Tauri runtime is ready (may take a moment in packaged apps)

(function() {
  var invoke = null;

  function tryInit() {
    var t = window.__TAURI__;
    if (t && t.core && t.core.invoke) {
      invoke = function(cmd, args) {
        return t.core.invoke(cmd, args || {});
      };
      console.log('Tauri API ready');
      return;
    }
    console.log('Tauri API not ready, retrying...');
    setTimeout(tryInit, 100);
  }

  tryInit();

  function call(cmd, args) {
    if (invoke) return invoke(cmd, args);
    return new Promise(function(resolve) {
      // Wait up to 5 seconds for Tauri to initialize
      var start = Date.now();
      function wait() {
        if (invoke) { resolve(invoke(cmd, args)); return; }
        if (Date.now() - start > 5000) { console.log('Tauri timeout for ' + cmd); resolve(null); return; }
        setTimeout(wait, 50);
      }
      wait();
    });
  }

  window.electronAPI = {
    importBook:    function()  { return call('import_book'); },
    readFile:      function(p) { return call('read_file', { path: p }); },
    getLibrary:    function()  { return call('get_library'); },
    saveLibrary:   function(l) { return call('save_library', { library: l }); },
    ttsGenerate:   function(s, d) { return call('tts_generate', { sentences: s, outputDir: d }); },
    ttsReadAudio:  function(p) { return call('tts_read_audio', { path: p }); },
    saveSettings:  function(d) { return call('save_settings', { data: d }); },
    loadSettings:  function()  { return call('load_settings'); },
    chooseFolder:  function()  { return call('choose_folder'); },
    deleteFile:    function(p) { return call('delete_file', { path: p }); },
    importAudio:   function()  { return call('import_audio'); },
    savePlaylists: function(d) { return call('save_playlists', { data: d }); },
    loadPlaylists: function()  { return call('load_playlists'); },
    exportAudio:   function()  { return call('export_audio'); },
  };
})();
