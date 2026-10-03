// 큰 문서 도구는 첫 화면에 싣지 않고, 실제로 필요한 순간 한 번만 불러온다.
const Assets = (() => {
  const pending = new Map();
  const CDN = {
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    zip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
    pdfExport: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
  };

  function script(src, ready) {
    if (ready()) return Promise.resolve();
    if (pending.has(src)) return pending.get(src);
    const task = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src; el.async = true;
      if (!src.startsWith('file:')) el.crossOrigin = 'anonymous'; // dist/index.html을 파일로 바로 열면 CORS 모드 스크립트는 막힌다
      el.onload = () => ready() ? resolve() : reject(new Error('도구를 시작하지 못했어요.'));
      el.onerror = () => reject(new Error('문서 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'));
      document.head.append(el);
    }).catch(err => { pending.delete(src); throw err; });
    pending.set(src, task);
    return task;
  }

  async function pdf() {
    await script(CDN.pdf, () => !!window.pdfjsLib);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;
  }
  const local = (file, ready) => script(new URL(file, document.baseURI).href, ready);
  const zip = () => script(CDN.zip, () => !!window.JSZip);
  async function pdfExport() {
    await Promise.all([
      script(CDN.pdfExport, () => !!window.jspdf),
      local('font.js', () => !!window.LB_FONT),
      local('book.js', () => !!window.Book)
    ]);
  }
  const translate = () => Promise.all([zip(), local('translate.js', () => !!window.PptxTranslate)]);
  return { pdf, zip, pdfExport, translate };
})();

window.Assets = Assets;
