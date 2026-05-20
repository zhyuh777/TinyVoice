/* ============================================
   App — 初始化
   ============================================ */

(async function init() {
  const tts = new TTSEngine();
  const books = new BookManager();
  const player = new PlayerController(tts, books);

  // Load data
  await player.loadSettings();
  await player.loadLibrary();
  await player.loadPlaylists();

  // Demo book if empty
  const hasReal = books.library.some(b => !b.demo && b.path);
  if (!hasReal) {
    books.library = [books._createDemoBook()];
    await books._saveLibrary();
  }
  player._renderBooks(books.library);
})();
