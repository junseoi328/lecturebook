// One-folder development server: rebuild site/ into dist/ and refresh the browser on save.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'site');
const output = path.join(root, 'dist');
const clients = new Set();
const reloadScript = `<script>new EventSource('/__reload').onmessage=()=>location.reload()</script>`;

function build() {
  execFileSync(process.execPath, [path.join(root, 'build.js')], { cwd: root, stdio: 'inherit' });
  for (const response of clients) response.write('data: update\n\n');
}

async function start({ port = Number(process.env.LECTUREBOOK_PORT || 4173), watch = true } = {}) {
  build();
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/__reload') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      response.write(': connected\n\n');
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    const file = { '/': 'index.html', '/index.html': 'index.html', '/standalone.html': 'standalone.html', '/font.js': 'font.js' }[pathname];
    if (!file) { response.writeHead(404); response.end('Not found'); return; }
    const content = fs.readFileSync(path.join(output, file));
    response.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(file === 'index.html' ? content.toString().replace('</body>', `${reloadScript}</body>`) : content);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  let timer;
  const watcher = watch ? fs.watch(source, () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { build(); } catch (error) { console.error('빌드 실패:', error.message); } }, 120);
  }) : null;
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise(resolve => { clearTimeout(timer); watcher?.close(); for (const client of clients) client.end(); server.close(resolve); })
  };
}

if (require.main === module) start().then(dev => {
  console.log(`렉처북 개발 화면: ${dev.url}`);
  console.log('site/ 파일을 저장하면 같은 dist/에 다시 빌드되고 화면이 새로고침됩니다.');
}).catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { start };
