const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('site/index.html', 'utf8');
assert(source.includes('src="assets.js"'), '지연 로더가 먼저 연결되어야 한다');
assert(!source.includes('pdf.min.js'), 'PDF 파서는 첫 화면에서 불러오지 않는다');
assert(!source.includes('jszip.min.js'), 'ZIP 파서는 첫 화면에서 불러오지 않는다');
assert(!source.includes('jspdf.umd.min.js'), 'PDF 생성기는 첫 화면에서 불러오지 않는다');
assert(!source.includes('src="font.js"'), '한글 PDF 폰트는 첫 화면에서 실행하지 않는다');
assert(!source.includes('src="book.js"') && !source.includes('src="translate.js"'), 'PDF 생성기와 번역 엔진은 첫 화면에서 실행하지 않는다');

if (fs.existsSync('dist/index.html')) {
  const bytes = fs.statSync('dist/index.html').size;
  assert(bytes < 250 * 1024, `최적화 실행본은 250KB 미만이어야 한다: ${bytes}`);
  for (const f of ['font.js', 'book.js', 'translate.js']) assert(fs.existsSync('dist/' + f), f + ' 지연 자산이 따로 있어야 한다');
}

console.log('통과  무거운 문서 도구와 한글 폰트는 필요할 때만 불러온다');
