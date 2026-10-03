// 저장과 파일 읽기. 모든 자료는 사용자의 브라우저(IndexedDB)에만 저장한다.
const Store = (() => {
  const mem = new Map();
  let dbp = null, useMem = false;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(resolve => {
      try {
        const r = indexedDB.open('lecturebook', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => { useMem = true; resolve(null); };
      } catch { useMem = true; resolve(null); }
    });
    return dbp;
  }
  async function run(mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('저장 공간이 부족할 수 있어요.'));
    });
  }
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  async function getMany(keys) {
    const db = await open();
    if (!db) return keys.map(k => clone(mem.get(k)));
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readonly'), store = t.objectStore('kv'), out = new Array(keys.length);
      keys.forEach((k, i) => { const r = store.get(k); r.onsuccess = () => { out[i] = r.result; }; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('자료를 읽지 못했어요.'));
    });
  }
  async function dump() {
    const db = await open();
    if (!db) return Object.fromEntries([...mem].map(([k, v]) => [k, clone(v)]));
    return new Promise((resolve, reject) => {
      const t = db.transaction('kv', 'readonly'), store = t.objectStore('kv');
      const kr = store.getAllKeys(), vr = store.getAll();
      t.oncomplete = () => resolve(Object.fromEntries(kr.result.map((k, i) => [k, vr.result[i]])));
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('백업 자료를 읽지 못했어요.'));
    });
  }
  return {
    get persistent() { return !useMem; },
    get: k => run('readonly', s => (s ? s.get(k) : { result: clone(mem.get(k)) })),
    getMany,
    set: (k, v) => run('readwrite', s => (s ? s.put(v, k) : (mem.set(k, clone(v)), null))),
    del: k => run('readwrite', s => (s ? s.delete(k) : (mem.delete(k), null))),
    keys: () => run('readonly', s => (s ? s.getAllKeys() : { result: [...mem.keys()] })),
    dump,
    async load(obj) { for (const [k, v] of Object.entries(obj)) await this.set(k, v); }
  };
})();

// 파일 → 페이지 목록 [{n, text, image?}]. 글자가 거의 없는 PDF 페이지(스캔본)는 이미지로 만든다
const Extract = (() => {
  const SPARSE = 40;
  const clean = t => t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  async function pdf(file, onProgress) {
    await Assets.pdf();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let text = '';
      for (const it of tc.items) text += it.str + (it.hasEOL ? '\n' : ' ');
      text = clean(text);
      const entry = { n, text };
      if (text.length < SPARSE) entry.image = await render(page);
      pages.push(entry);
      onProgress && onProgress(n, doc.numPages);
    }
    return pages;
  }
  async function render(page) {
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.sqrt(1200000 / (v1.width * v1.height)));
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    return new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
  }
  // PPTX, DOCX: 압축 안의 XML에서 글자만 꺼낸다
  async function office(file, kind) {
    await Assets.zip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const xmlText = (xml, tag) => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const paras = [...doc.getElementsByTagName(kind === 'pptx' ? 'a:p' : 'w:p')];
      return clean(paras.map(p => [...p.getElementsByTagName(tag)].map(t => t.textContent).join('')).filter(Boolean).join('\n'));
    };
    if (kind === 'pptx') {
      const slides = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
        .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
      const pages = [];
      for (const [i, f] of slides.entries()) {
        let text = xmlText(await zip.file(f).async('string'), 'a:t');
        const notes = zip.file(f.replace('slides/slide', 'notesSlides/notesSlide'));
        if (notes) { const nt = xmlText(await notes.async('string'), 'a:t'); if (nt) text += '\n[발표자 노트] ' + nt; }
        pages.push({ n: i + 1, text });
      }
      return pages;
    }
    const body = xmlText(await zip.file('word/document.xml').async('string'), 'w:t');
    return splitText(body);
  }
  function splitText(t, size = 2500) {
    const pages = []; let buf = '';
    for (const para of t.split(/\n/)) {
      if ((buf + para).length > size && buf) { pages.push(buf); buf = ''; }
      buf += para + '\n';
    }
    if (buf.trim()) pages.push(buf);
    return pages.map((text, i) => ({ n: i + 1, text: clean(text) }));
  }
  async function file(f, onProgress) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.pdf') || f.type === 'application/pdf') return { kind: 'pdf', pages: await pdf(f, onProgress) };
    if (name.endsWith('.pptx')) return { kind: 'pptx', pages: await office(f, 'pptx') };
    if (name.endsWith('.docx')) return { kind: 'docx', pages: await office(f, 'docx') };
    if (/^image\/(jpeg|png|webp|gif)$/.test(f.type)) return { kind: 'image', pages: [{ n: 1, text: '', image: f }] };
    if (/\.(txt|md|csv)$/.test(name) || f.type.startsWith('text/')) return { kind: 'text', pages: splitText(await f.text()) };
    if (/\.(ppt|doc|hwp|hwpx)$/.test(name)) throw new Error('이 형식은 아직 못 읽어요. PDF로 저장해서 올려 주세요.');
    throw new Error('지원하지 않는 파일 형식이에요. PDF, PPTX, DOCX, 이미지, 텍스트를 올려 주세요.');
  }
  return { file, text: t => splitText(t), SPARSE };
})();

if (typeof module !== 'undefined') module.exports = { Extract };
