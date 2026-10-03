// 로컬 스크립트와 스타일을 한 파일로 묶는다 (외부 CDN 스크립트는 그대로). 실행: node build.js → dist/index.html
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'site');
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, f) => `<style>\n${fs.readFileSync(path.join(dir, f), 'utf8')}\n</style>`);
html = html.replace(/<script src="(?!https:)([^"]+)"><\/script>/g, (_, f) => {
  const js = fs.readFileSync(path.join(dir, f), 'utf8');
  if (/<\/script/i.test(js)) throw new Error(f + ' 안에 </script 가 있어 묶을 수 없음');
  return `<script>\n${js}\n</script>`;
});
fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist', 'index.html'), html);
const LAZY = ['font.js', 'book.js', 'translate.js']; // site/assets.js가 필요할 때 불러오는 파일
for (const f of LAZY) fs.copyFileSync(path.join(dir, f), path.join(__dirname, 'dist', f));
const standalone = html.replace('</body>', LAZY.map(f => `<script>\n${fs.readFileSync(path.join(dir, f), 'utf8')}\n</script>`).join('\n') + '\n</body>');
fs.writeFileSync(path.join(__dirname, 'dist', 'standalone.html'), standalone);
console.log('dist/index.html', (Buffer.byteLength(html) / 1024).toFixed(0) + ' KB');
console.log('dist/standalone.html', (Buffer.byteLength(standalone) / 1024 / 1024).toFixed(2) + ' MB');
