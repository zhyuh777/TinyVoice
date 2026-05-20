const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Books
  importBook: () => ipcRenderer.invoke('import-book'),
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  getLibrary: () => ipcRenderer.invoke('get-library'),
  saveLibrary: (library) => ipcRenderer.invoke('save-library', library),

  // TTS
  ttsGenerate: (sentences, outputDir) => ipcRenderer.invoke('tts-generate', sentences, outputDir),
  ttsReadAudio: (filePath) => ipcRenderer.invoke('tts-read-audio', filePath),

  // Settings
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),

  // Files
  deleteFile: (path) => ipcRenderer.invoke('delete-file', path),
  importAudio: () => ipcRenderer.invoke('import-audio'),

  // Playlists
  savePlaylists: (data) => ipcRenderer.invoke('save-playlists', data),
  loadPlaylists: () => ipcRenderer.invoke('load-playlists'),

  // Export
  exportAudio: () => ipcRenderer.invoke('export-audio'),
});
