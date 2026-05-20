// Tauri adapter — same API surface as the old electronAPI
// Uses window.__TAURI__ (injected by Tauri at runtime)

const invoke = window.__TAURI__?.core?.invoke;

if (!invoke) {
  console.warn('Tauri API not available — running outside Tauri');
}

window.electronAPI = {
  // Books
  importBook: () => invoke?.('import_book'),
  readFile: (path) => invoke?.('read_file', { path }),
  getLibrary: () => invoke?.('get_library'),
  saveLibrary: (library) => invoke?.('save_library', { library }),

  // TTS
  ttsGenerate: (sentences, outputDir) =>
    invoke?.('tts_generate', { sentences, outputDir }),
  ttsReadAudio: (filePath) =>
    invoke?.('tts_read_audio', { path: filePath }),

  // Settings
  saveSettings: (data) => invoke?.('save_settings', { data }),
  loadSettings: () => invoke?.('load_settings'),
  chooseFolder: () => invoke?.('choose_folder'),

  // Files
  deleteFile: (path) => invoke?.('delete_file', { path }),
  importAudio: () => invoke?.('import_audio'),

  // Playlists
  savePlaylists: (data) => invoke?.('save_playlists', { data }),
  loadPlaylists: () => invoke?.('load_playlists'),

  // Export
  exportAudio: () => invoke?.('export_audio'),
};
