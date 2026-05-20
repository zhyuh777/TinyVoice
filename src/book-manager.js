/* ============================================
   Book Manager - 书库管理、文本解析、章节分割
   ============================================ */

class BookManager {
  constructor() {
    this.library = [];
    this.currentBook = null;
    this.currentContent = '';
    this.chapters = [];

    this.onLibraryChange = null;
  }

  async loadLibrary() {
    if (window.electronAPI) {
      this.library = await window.electronAPI.getLibrary();
    } else {
      // Demo mode: load sample books
      this.library = [];
    }
    if (this.onLibraryChange) this.onLibraryChange(this.library);
    return this.library;
  }

  async importBook() {
    if (!window.electronAPI) {
      const demoBook = this._createDemoBook();
      this.library.push(demoBook);
      await this._saveLibrary();
      if (this.onLibraryChange) this.onLibraryChange(this.library);
      return demoBook;
    }

    const bookData = await window.electronAPI.importBook();
    if (!bookData) return null;

    this.library.push(bookData);
    await this._saveLibrary();
    if (this.onLibraryChange) this.onLibraryChange(this.library);
    return bookData;
  }

  async selectBook(bookId) {
    const book = this.library.find(b => b.id === bookId);
    if (!book) return null;

    this.currentBook = book;

    // Load content if not cached
    if (!book.content) {
      if (book.demo) {
        const demo = this._createDemoBook();
        book.content = demo.content;
      } else if (book.path && window.electronAPI) {
        // Re-import to re-parse the file
        book.content = await window.electronAPI.readFile(book.path);
      }
    }

    this.currentContent = book.content || '';
    this.chapters = this._splitChapters(this.currentContent);

    return {
      book,
      chapters: this.chapters,
      content: this.currentContent,
    };
  }

  removeBook(bookId) {
    this.library = this.library.filter(b => b.id !== bookId);
    if (this.currentBook && this.currentBook.id === bookId) {
      this.currentBook = null;
      this.currentContent = '';
      this.chapters = [];
    }
    this._saveLibrary();
    if (this.onLibraryChange) this.onLibraryChange(this.library);
  }

  async _saveLibrary() {
    if (window.electronAPI) {
      // Strip content before saving (too large)
      const toSave = this.library.map(b => ({
        ...b,
        content: undefined,
      }));
      await window.electronAPI.saveLibrary(toSave);
    }
  }

  // ---- Chapter Parsing ----

  _splitChapters(text) {
    const chapters = [];

    // Match Chinese chapter titles
    const chapterRegex = /(?:^|\n)\s*((?:第[一二三四五六七八九十百千\d]+[章节回卷]|Chapter\s*\d+|序章|楔子|尾声|番外).*?)(?:\n|$)/gm;

    let lastIndex = 0;
    let match;
    let chapterIndex = 0;

    // Collect all matches
    const matches = [];
    while ((match = chapterRegex.exec(text)) !== null) {
      matches.push({ index: match.index, title: match[1].trim() });
    }

    if (matches.length === 0) {
      // No chapters found — treat entire text as one chapter
      chapters.push({
        index: 0,
        title: '正文',
        content: text,
        startOffset: 0,
        endOffset: text.length,
      });
      return chapters;
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index;
      const end = i < matches.length - 1 ? matches[i + 1].index : text.length;

      chapters.push({
        index: i,
        title: matches[i].title,
        content: text.slice(start, end),
        startOffset: start,
        endOffset: end,
      });
    }

    return chapters;
  }

  getChapter(index) {
    return this.chapters[index] || null;
  }

  // ---- Demo Content ----

  _createDemoBook() {
    return {
      id: 'demo-001',
      name: '示例小说 - 星辰之海',
      format: 'txt',
      demo: true,
      size: 0,
      addedAt: new Date().toISOString(),
      content: `第一章 意外的启程

星历 2147 年，人类的足迹早已遍布银河系。

在边缘星球 KR-3 上，年轻的探险员林默正在检修他那艘老旧的飞船。这艘名叫"星尘号"的飞船陪伴他度过了无数个孤独的航行日。

"你真的要一个人去探索那片未知星域？"通讯器里传来好友苏晚的声音，带着明显的担忧。

林默轻轻笑了笑，手指在控制面板上快速滑动："放心吧，我又不是第一次独自出航了。那片区域虽然没被完整测绘过，但根据数据推测，应该是个安全的星带。"

"可我听总部说，最近那片区域有异常的能量波动。"苏晚的语气变得更加急切，"你好歹也等一等，我这边任务马上结束了，到时候跟你一起去！"

"等你？"林默忍不住笑出声，"你上次也是这么说的，结果让我等了整整三个月。算了，我先去探探路，有什么发现我会第一时间通知你。"

苏晚沉默了几秒，最终叹了口气："好吧，那你一定要小心。记住，遇到任何异常情况就立刻返航，听到没有？"

"听到了，听到了。"林默漫不经心地回答着，按下了引擎启动的按钮。

星尘号发出一阵低沉的轰鸣，船身在轻微的震动中缓缓升空。透过舷窗，林默看着逐渐变小的基地，心中涌起一股难以言喻的激动之情。

每一次出发，都像是一次全新的冒险。而这次，他有一种预感——这趟航程将改变他的一生。

他不知道的是，这个预感将在接下来的四十八小时内，以一种他永远无法想象的方式成真。

第二章 异常信号

航行到第二天的时候，一切都很顺利。

星尘号按着既定航线穿越 KR 星系的外围，周围的星空安静而美丽。林默靠在驾驶座上，手里端着一杯已经凉透的咖啡，目光懒散地扫过仪表盘。

就在这时，飞船的探测器突然发出了急促的警报声。

"嗯？这是什么？"林默放下咖啡杯，迅速凑近屏幕。

仪表盘上，一个神秘的信号正在以极快的频率跳动着。信号源来自于航线偏离三个光分的一片区域——那片区域在星图上被标注为"未勘测"。

"奇怪，这种波形我从来没见过......"林默皱起眉头，手指在键盘上飞速敲击，试图分析信号的来源和性质。

突然，通讯器里传来一阵刺耳的噪音，紧接着，一个断断续续的声音从噪音中浮现出来——那是一种林默从未听过的语言，但诡异的是，他竟然能够理解其中的含义。

"帮......帮我......我们被困......时间不多了......"

林默的心猛地揪紧了。他几乎是下意识地调整了航线，将星尘号对准了信号源的方向。

"有人在求救。"他喃喃自语道，眼神变得坚定起来，"不管是谁，我都要去看看。"

引擎发出一声怒吼，星尘号如同离弦之箭，冲入了那片未知的黑暗之中。

他不知道等待他的会是什么，但他知道一件事——真正的探险者，永远不会对求救信号视而不见。`,
    };
  }
}

// Export as global
window.BookManager = BookManager;
