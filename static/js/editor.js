(() => {
  "use strict";

  const DB_NAME = "flask-text-editor";
  const DB_VERSION = 1;
  const STORE_NAME = "documents";
  const AUTOSAVE_DELAY = 650;

  const elements = {
    newButton: document.getElementById("newDocumentButton"),
    importButton: document.getElementById("importButton"),
    importFile: document.getElementById("importFile"),
    documentList: document.getElementById("documentList"),
    documentCount: document.getElementById("documentCount"),
    title: document.getElementById("documentTitle"),
    downloadButton: document.getElementById("downloadButton"),
    saveStatus: document.getElementById("saveStatus"),
    loading: document.getElementById("editorLoading"),
    editorApp: document.getElementById("editorApp"),
    editorError: document.getElementById("editorError"),
    searchInput: document.getElementById("searchInput"),
    searchStatus: document.getElementById("searchStatus"),
    searchPrev: document.getElementById("searchPrevButton"),
    searchNext: document.getElementById("searchNextButton"),
    characterCount: document.getElementById("characterCount"),
    wordCount: document.getElementById("wordCount")
  };

  let db;
  let quill;
  let activeDocumentId = null;
  let saveTimer = null;
  let savePromise = null;
  let isDirty = false;
  let suppressChanges = false;
  let changeVersion = 0;
  let searchMatches = [];
  let currentMatchIndex = -1;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB не поддерживается этим браузером."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Не удалось открыть хранилище браузера."));
      request.onblocked = () => reject(new Error("Хранилище браузера заблокировано другой вкладкой."));
    });
  }

  function storeRequest(mode, operation) {
    return new Promise((resolve, reject) => {
      let transaction;
      let request;
      let result;

      try {
        transaction = db.transaction(STORE_NAME, mode);
        request = operation(transaction.objectStore(STORE_NAME));
      } catch (error) {
        reject(error);
        return;
      }

      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        reject(request.error || new Error("Ошибка запроса к хранилищу браузера."));
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => {
        reject(transaction.error || request.error || new Error("Не удалось завершить операцию с хранилищем."));
      };
      transaction.onabort = () => {
        reject(transaction.error || new Error("Операция с хранилищем прервана."));
      };
    });
  }

  const getAllDocuments = () => storeRequest("readonly", store => store.getAll());
  const getDocument = id => storeRequest("readonly", store => store.get(id));
  const putDocument = document => storeRequest("readwrite", store => store.put(document));

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function safeTitle(value) {
    const cleaned = String(value || "").trim().slice(0, 160);
    return cleaned || "Без названия";
  }

  function setStatus(message, kind = "") {
    elements.saveStatus.textContent = message;
    elements.saveStatus.classList.toggle("saved", kind === "saved");
    elements.saveStatus.classList.toggle("error", kind === "error");
  }

  function formatDate(timestamp) {
    if (!timestamp) return "";
    try {
      return new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit"
      }).format(new Date(timestamp));
    } catch (_) {
      return new Date(timestamp).toLocaleString();
    }
  }

  async function renderDocumentList() {
    const documents = (await getAllDocuments()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    elements.documentCount.textContent = String(documents.length);
    elements.documentList.replaceChildren();

    if (!documents.length) {
      const empty = document.createElement("p");
      empty.className = "empty-list";
      empty.textContent = "Документов пока нет. Создай новый или импортируй DOCX-файл.";
      elements.documentList.appendChild(empty);
      return;
    }

    for (const item of documents) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "document-item" + (item.id === activeDocumentId ? " active" : "");
      button.setAttribute("aria-current", item.id === activeDocumentId ? "page" : "false");

      const icon = document.createElement("span");
      icon.className = "document-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▤";

      const copy = document.createElement("span");
      copy.className = "document-copy";

      const title = document.createElement("span");
      title.className = "document-title";
      title.textContent = safeTitle(item.title);

      const date = document.createElement("span");
      date.className = "document-date";
      date.textContent = `Изменён: ${formatDate(item.updatedAt)}`;

      copy.append(title, date);
      button.append(icon, copy);
      button.addEventListener("click", () => {
        openDocument(item.id).catch(showStorageError);
      });
      elements.documentList.appendChild(button);
    }
  }

  function resetEditor(html) {
    suppressChanges = true;
    try {
      quill.setText("\n", "silent");
      if (html && html.trim()) {
        quill.clipboard.dangerouslyPasteHTML(html, "silent");
      }
      quill.setSelection(0, 0, "silent");
    } finally {
      suppressChanges = false;
    }
    updateCounts();
    refreshSearch();
  }

  async function openDocument(id) {
    await flushSave();
    const item = await getDocument(id);
    if (!item) {
      await renderDocumentList();
      return;
    }

    activeDocumentId = item.id;
    elements.title.value = safeTitle(item.title);
    resetEditor(item.html || "");
    isDirty = false;
    changeVersion += 1;
    setStatus("Сохранено в браузере", "saved");
    await renderDocumentList();
  }

  async function createDocument() {
    await flushSave();
    const now = Date.now();
    const item = {
      id: createId(),
      title: "Новый документ",
      html: "<p><br></p>",
      createdAt: now,
      updatedAt: now
    };
    await putDocument(item);
    activeDocumentId = item.id;
    elements.title.value = item.title;
    resetEditor(item.html);
    isDirty = false;
    changeVersion += 1;
    setStatus("Новый документ создан", "saved");
    await renderDocumentList();
    quill.focus();
  }

  function scheduleSave() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      saveCurrent().catch(showStorageError);
    }, AUTOSAVE_DELAY);
  }

  async function saveCurrent() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (savePromise) await savePromise;
    if (!activeDocumentId || !isDirty) return;

    const id = activeDocumentId;
    const versionAtStart = changeVersion;
    const existing = await getDocument(id);
    if (!existing || activeDocumentId !== id) return;

    const updated = {
      ...existing,
      title: safeTitle(elements.title.value),
      html: quill.root.innerHTML,
      updatedAt: Date.now()
    };

    setStatus("Сохраняем…");
    let thisSave;
    thisSave = putDocument(updated)
      .then(async () => {
        if (activeDocumentId === id && changeVersion === versionAtStart) {
          isDirty = false;
          setStatus("Сохранено в браузере", "saved");
        }
        await renderDocumentList();
      })
      .catch(error => {
        if (activeDocumentId === id) setStatus("Ошибка автосохранения", "error");
        throw error;
      })
      .finally(() => {
        if (savePromise === thisSave) savePromise = null;
      });

    savePromise = thisSave;
    await thisSave;

    if (activeDocumentId === id && isDirty && !saveTimer) scheduleSave();
  }

  async function flushSave() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (savePromise) await savePromise;
    if (isDirty) await saveCurrent();
  }

  function updateCounts() {
    if (!quill) return;
    const text = quill.getText().replace(/\n$/, "");
    const characters = Array.from(text).length;
    const words = text.match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || [];
    elements.characterCount.textContent = `Символов: ${characters}`;
    elements.wordCount.textContent = `Слов: ${words.length}`;
  }

  function refreshSearch() {
    const query = elements.searchInput.value.trim();
    searchMatches = [];
    currentMatchIndex = -1;

    if (!query || !quill) {
      elements.searchStatus.textContent = "Введите текст для поиска";
      return;
    }

    const text = quill.getText();
    const haystack = text.toLocaleLowerCase();
    const needle = query.toLocaleLowerCase();
    let fromIndex = 0;

    while (fromIndex <= haystack.length - needle.length) {
      const foundAt = haystack.indexOf(needle, fromIndex);
      if (foundAt === -1) break;
      searchMatches.push({ index: foundAt, length: query.length });
      fromIndex = foundAt + Math.max(needle.length, 1);
    }

    if (!searchMatches.length) {
      elements.searchStatus.textContent = "Совпадений не найдено";
      return;
    }

    elements.searchStatus.textContent = `Найдено: ${searchMatches.length}`;
    // Typing in the search box must not move focus into Quill. Navigation is explicit.
  }

  function jumpToMatch(index) {
    if (!searchMatches.length) return;
    currentMatchIndex = ((index % searchMatches.length) + searchMatches.length) % searchMatches.length;
    const match = searchMatches[currentMatchIndex];
    quill.focus();
    quill.setSelection(match.index, match.length, "user");
    elements.searchStatus.textContent = `${currentMatchIndex + 1} из ${searchMatches.length}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function safeFilename(value, extension) {
    const cleaned = safeTitle(value)
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim() || "document";
    return `${cleaned}.${extension}`;
  }

  function safeColor(value) {
    if (!value) return undefined;
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1];
      return raw.length === 3 ? raw.split("").map(c => c + c).join("").toUpperCase() : raw.toUpperCase();
    }
    const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb) return rgb.slice(1).map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
    return undefined;
  }

  function textRunOptions(text, format = {}) {
    const options = { text };
    if (format.bold) options.bold = true;
    if (format.italics) options.italics = true;
    if (format.underline) options.underline = {};
    if (format.strike) options.strike = true;
    if (format.font) options.font = format.font;
    if (format.color) options.color = format.color;
    if (format.size) options.size = format.size;
    return options;
  }

  function imageRunFromElement(element) {
    if (!window.docx || typeof window.docx.ImageRun !== "function") return null;
    const src = element.getAttribute("src") || "";
    const match = src.match(/^data:image\/(png|jpe?g|gif|bmp);base64,([a-z0-9+/=\s]+)$/i);
    if (!match) return null;

    try {
      const binary = window.atob(match[2].replace(/\s/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const requestedWidth = Number(element.getAttribute("width")) || 360;
      const requestedHeight = Number(element.getAttribute("height")) || 240;
      const width = Math.max(40, Math.min(600, requestedWidth));
      const height = Math.max(40, Math.min(600, requestedHeight));
      return new window.docx.ImageRun({
        data: bytes,
        transformation: { width, height }
      });
    } catch (error) {
      console.warn("Не удалось добавить изображение в DOCX:", error);
      return null;
    }
  }

  function safeExternalLink(value) {
    const href = String(value || "").trim();
    if (!href) return null;
    try {
      const parsed = new URL(href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
        return parsed.href;
      }
    } catch (_) {
      return null;
    }
    return null;
  }

  function inlineRuns(node, inherited = {}) {
    const runs = [];
    for (const child of Array.from(node.childNodes || [])) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.nodeValue) {
          const options = textRunOptions(child.nodeValue, inherited);
          if (inherited.hyperlink) {
            options.style = "Hyperlink";
            options.color = "0563C1";
            options.underline = {};
          }
          runs.push(new window.docx.TextRun(options));
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();
      if (child.classList.contains("ql-ui")) continue;
      if (tag === "ul" || tag === "ol") continue;

      if (tag === "br") {
        runs.push(new window.docx.TextRun({ text: "", break: 1 }));
        continue;
      }
      if (tag === "img") {
        const imageRun = imageRunFromElement(child);
        if (imageRun) runs.push(imageRun);
        else if (child.getAttribute("alt")) {
          runs.push(new window.docx.TextRun(textRunOptions(`[${child.getAttribute("alt")}]`, inherited)));
        }
        continue;
      }

      const next = { ...inherited };
      if (["strong", "b"].includes(tag)) next.bold = true;
      if (["em", "i"].includes(tag)) next.italics = true;
      if (tag === "u") next.underline = true;
      if (["s", "strike", "del"].includes(tag)) next.strike = true;
      if (tag === "code" || tag === "pre") next.font = "Courier New";
      const style = child.getAttribute("style") || "";
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) next.bold = true;
      if (/font-style\s*:\s*italic/i.test(style)) next.italics = true;
      if (/text-decoration[^;]*underline/i.test(style)) next.underline = true;
      if (/text-decoration[^;]*line-through/i.test(style)) next.strike = true;
      const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
      if (colorMatch) next.color = safeColor(colorMatch[1].trim());

      if (tag === "a") {
        const href = safeExternalLink(child.getAttribute("href") || "");
        const innerRuns = inlineRuns(child, { ...next, hyperlink: Boolean(href) });
        if (href && innerRuns.length) {
          if (typeof window.docx.ExternalHyperlink !== "function") {
            throw new Error("Библиотека DOCX не поддерживает экспорт гиперссылок. Обнови страницу и попробуй ещё раз.");
          }
          runs.push(new window.docx.ExternalHyperlink({ link: href, children: innerRuns }));
        } else {
          runs.push(...innerRuns);
        }
      } else {
        runs.push(...inlineRuns(child, next));
      }
    }
    return runs;
  }

  function getParagraphAlignment(element, AlignmentType) {
    const style = element.getAttribute("style") || "";
    if (element.classList.contains("ql-align-center") || /text-align\s*:\s*center/i.test(style)) return AlignmentType.CENTER;
    if (element.classList.contains("ql-align-right") || /text-align\s*:\s*right/i.test(style)) return AlignmentType.RIGHT;
    if (element.classList.contains("ql-align-justify") || /text-align\s*:\s*justify/i.test(style)) return AlignmentType.JUSTIFIED;
    return AlignmentType.LEFT;
  }

  function makeParagraph(element, context = {}) {
    const { Paragraph, TextRun, HeadingLevel, AlignmentType } = window.docx;
    const tag = element.tagName.toLowerCase();
    const inherited = {};
    if (context.quote) inherited.italics = true;
    if (tag === "pre") inherited.font = "Courier New";

    let children = inlineRuns(element, inherited);
    if (!children.length) children = [new TextRun("")];

    const options = {
      children,
      alignment: getParagraphAlignment(element, AlignmentType),
      spacing: { after: 160 }
    };

    if (tag === "h1") options.heading = HeadingLevel.HEADING_1;
    else if (tag === "h2") options.heading = HeadingLevel.HEADING_2;
    else if (tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") options.heading = HeadingLevel.HEADING_3;

    if (context.quote) options.indent = { left: 720 };
    if (tag === "pre") {
      options.indent = { left: 240 };
      options.shading = { fill: "F2F4F7" };
    }
    return new Paragraph(options);
  }

  function makeListParagraph(item, kind, level = 0) {
    const { Paragraph, TextRun } = window.docx;
    const indentClass = Array.from(item.classList || []).map(name => name.match(/^ql-indent-(\d+)$/)).find(Boolean);
    const itemLevel = Math.min(8, Math.max(level, indentClass ? Number(indentClass[1]) : 0));
    const children = inlineRuns(item);
    const options = {
      children: children.length ? children : [new TextRun("")],
      spacing: { after: 80 }
    };
    if (kind === "bullet") {
      options.numbering = { reference: "bullet-list", level: itemLevel };
    } else {
      options.numbering = { reference: "ordered-list", level: itemLevel };
    }
    return new Paragraph(options);
  }

  function htmlToDocxParagraphs(htmlContent) {
    const { Paragraph, TextRun } = window.docx;
    const parsed = new DOMParser().parseFromString(`<body>${htmlContent}</body>`, "text/html");
    const root = parsed.body;
    const paragraphs = [];

    function processList(listElement, depth = 0) {
      const directItems = Array.from(listElement.children).filter(child => child.tagName.toLowerCase() === "li");
      for (const item of directItems) {
        const dataList = (item.getAttribute("data-list") || "").toLowerCase();
        const kind = dataList === "bullet" || (!dataList && listElement.tagName.toLowerCase() === "ul") ? "bullet" : "ordered";
        paragraphs.push(makeListParagraph(item, kind, depth));

        for (const child of Array.from(item.children)) {
          if (["ul", "ol"].includes(child.tagName.toLowerCase())) processList(child, depth + 1);
        }
      }
    }

    function walk(parent, context = {}) {
      for (const node of Array.from(parent.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          const value = node.nodeValue || "";
          if (value.trim()) paragraphs.push(new Paragraph({ children: [new TextRun(value.trim())], spacing: { after: 160 } }));
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const tag = node.tagName.toLowerCase();
        if (["script", "style", "meta", "link"].includes(tag)) continue;

        if (tag === "ul" || tag === "ol") {
          processList(node, context.listDepth || 0);
        } else if (tag === "blockquote") {
          if (Array.from(node.children).some(child => ["p", "h1", "h2", "h3", "h4", "h5", "h6"].includes(child.tagName.toLowerCase()))) {
            walk(node, { ...context, quote: true });
          } else {
            paragraphs.push(makeParagraph(node, { quote: true }));
          }
        } else if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "pre"].includes(tag)) {
          paragraphs.push(makeParagraph(node, context));
        } else if (["div", "section", "article", "main"].includes(tag)) {
          walk(node, context);
        } else if (tag === "img") {
          const imageRun = imageRunFromElement(node);
          if (imageRun) paragraphs.push(new Paragraph({ children: [imageRun], spacing: { after: 160 } }));
        } else {
          const hasBlockChildren = Array.from(node.children).some(child =>
            ["p", "div", "ul", "ol", "blockquote", "h1", "h2", "h3", "pre"].includes(child.tagName.toLowerCase())
          );
          if (hasBlockChildren) walk(node, context);
          else if ((node.textContent || "").trim()) paragraphs.push(new Paragraph({ children: inlineRuns(node), spacing: { after: 160 } }));
        }
      }
    }

    walk(root);
    return paragraphs.length ? paragraphs : [new Paragraph({ children: [new TextRun("")] })];
  }

  function createNumberingConfig() {
    const { LevelFormat, AlignmentType } = window.docx;
    const orderedLevels = [];
    const bulletLevels = [];
    for (let level = 0; level <= 8; level += 1) {
      const indent = { left: 720 * (level + 1), hanging: 260 };
      orderedLevels.push({
        level,
        format: LevelFormat.DECIMAL,
        text: `%${level + 1}.`,
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent } }
      });
      bulletLevels.push({
        level,
        format: LevelFormat.BULLET,
        text: ["•", "◦", "▪"][level % 3],
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent } }
      });
    }
    return {
      config: [
        { reference: "ordered-list", levels: orderedLevels },
        { reference: "bullet-list", levels: bulletLevels }
      ]
    };
  }

  async function downloadDocx() {
    if (!window.docx || !window.docx.Document || !window.docx.Packer) {
      throw new Error("Не удалось загрузить библиотеку DOCX. Проверь подключение к интернету и обнови страницу.");
    }
    await flushSave();

    const title = safeTitle(elements.title.value);
    const paragraphs = htmlToDocxParagraphs(quill.root.innerHTML);
    const documentFile = new window.docx.Document({
      creator: "Flask Text Editor",
      title,
      description: "Документ, созданный в Flask Text Editor",
      numbering: createNumberingConfig(),
      sections: [{ properties: {}, children: paragraphs }]
    });

    setStatus("Создаём DOCX…");
    const blob = await window.docx.Packer.toBlob(documentFile);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = safeFilename(title, "docx");
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    setStatus("DOCX-файл подготовлен", "saved");
  }

  function sanitizeImportedHtml(rawHtml) {
    const parsed = new DOMParser().parseFromString(rawHtml, "text/html");
    parsed.querySelectorAll("script, iframe, object, embed, form, input, button, textarea, select, link, meta, base, style").forEach(node => node.remove());

    // Remove inline event handlers and dangerous URL schemes before passing markup to Quill.
    for (const element of parsed.body.querySelectorAll("*")) {
      for (const attribute of Array.from(element.attributes)) {
        if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      }
      for (const attributeName of ["href", "src"]) {
        const value = element.getAttribute(attributeName);
        if (value && /^\s*javascript:/i.test(value)) element.removeAttribute(attributeName);
      }
    }

    const bodyHtml = parsed.body ? parsed.body.innerHTML.trim() : "";
    if (bodyHtml) return bodyHtml;
    const text = parsed.body?.textContent || rawHtml;
    return `<p>${escapeHtml(text)}</p>`;
  }

  async function importDocxFile(file) {
    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".docx")) {
      throw new Error("Выбери файл с расширением .docx.");
    }
    if (!window.mammoth || typeof window.mammoth.convertToHtml !== "function") {
      throw new Error("Не удалось загрузить библиотеку импорта DOCX. Проверь подключение к интернету и обнови страницу.");
    }

    setStatus("Импортируем DOCX…");
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.convertToHtml({ arrayBuffer });
    const importedHtml = sanitizeImportedHtml(result.value || "");
    await flushSave();

    const filenameTitle = file.name.replace(/\.docx$/i, "").replace(/[_-]+/g, " ").trim();
    const now = Date.now();

    resetEditor(importedHtml);
    elements.title.value = safeTitle(filenameTitle);
    activeDocumentId = createId();

    const item = {
      id: activeDocumentId,
      title: safeTitle(elements.title.value),
      html: quill.root.innerHTML,
      createdAt: now,
      updatedAt: now
    };
    await putDocument(item);
    isDirty = false;
    changeVersion += 1;
    setStatus("DOCX импортирован", "saved");
    await renderDocumentList();
    quill.focus();

    if (result.messages && result.messages.length) {
      console.info("Сообщения Mammoth при импорте DOCX:", result.messages);
    }
  }

  function showStorageError(error) {
    console.error(error);
    setStatus(error?.message || "Ошибка работы с браузерным хранилищем", "error");
    if (error?.message) elements.searchStatus.textContent = error.message;
  }

  function wireEvents() {
    elements.newButton.addEventListener("click", () => createDocument().catch(showStorageError));
    elements.importButton.addEventListener("click", () => elements.importFile.click());
    elements.importFile.addEventListener("change", async event => {
      const file = event.target.files && event.target.files[0];
      try {
        await importDocxFile(file);
      } catch (error) {
        showStorageError(error);
        window.alert(error?.message || "Не удалось импортировать DOCX-файл.");
      } finally {
        event.target.value = "";
      }
    });

    elements.title.addEventListener("input", () => {
      if (suppressChanges) return;
      isDirty = true;
      changeVersion += 1;
      setStatus("Есть несохранённые изменения");
      scheduleSave();
    });

    quill.on("text-change", () => {
      if (suppressChanges) return;
      isDirty = true;
      changeVersion += 1;
      setStatus("Есть несохранённые изменения");
      updateCounts();
      refreshSearch();
      scheduleSave();
    });

    elements.searchInput.addEventListener("input", () => refreshSearch());
    elements.searchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        if (event.shiftKey) {
          jumpToMatch(currentMatchIndex < 0 ? searchMatches.length - 1 : currentMatchIndex - 1);
        } else {
          jumpToMatch(currentMatchIndex < 0 ? 0 : currentMatchIndex + 1);
        }
      } else if (event.key === "Escape") {
        elements.searchInput.value = "";
        refreshSearch();
      }
    });
    elements.searchPrev.addEventListener("click", () => {
      jumpToMatch(currentMatchIndex < 0 ? searchMatches.length - 1 : currentMatchIndex - 1);
    });
    elements.searchNext.addEventListener("click", () => {
      jumpToMatch(currentMatchIndex < 0 ? 0 : currentMatchIndex + 1);
    });
    elements.downloadButton.addEventListener("click", () => {
      downloadDocx().catch(error => {
        showStorageError(error);
        window.alert(error?.message || "Не удалось создать DOCX-файл.");
      });
    });

    document.addEventListener("keydown", event => {
      const isSaveShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
      if (isSaveShortcut) {
        event.preventDefault();
        saveCurrent().catch(showStorageError);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && isDirty) saveCurrent().catch(showStorageError);
    });

    window.addEventListener("pagehide", () => {
      if (isDirty) saveCurrent().catch(showStorageError);
    });
  }

  async function init() {
    if (typeof window.Quill !== "function") {
      elements.loading.hidden = true;
      elements.editorError.hidden = false;
      elements.editorApp.hidden = true;
      setStatus("Quill не загружен", "error");
      return;
    }

    try {
      db = await openDatabase();
      quill = new window.Quill("#editor", {
        theme: "snow",
        placeholder: "Начните писать здесь…",
        modules: { toolbar: "#toolbar" }
      });
      elements.loading.hidden = true;
      elements.editorApp.hidden = false;
      wireEvents();

      const documents = await getAllDocuments();
      if (documents.length) {
        const mostRecent = documents.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
        await openDocument(mostRecent.id);
      } else {
        await createDocument();
      }
      updateCounts();
      setStatus("Сохранено в браузере", "saved");
    } catch (error) {
      showStorageError(error);
      elements.loading.hidden = true;
      elements.editorError.hidden = false;
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
