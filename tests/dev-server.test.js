const assert = require('assert');
const { start } = require('../tools/dev');

(async () => {
  const dev = await start({ port: 0, watch: false });
  try {
    const page = await fetch(dev.url);
    assert.strictEqual(page.status, 200);
    const html = await page.text();
    assert.match(html, /new EventSource\('\/__reload'\)/);
    assert.match(html, /렉처북/);
    for (const lazy of ['font.js', 'book.js', 'translate.js']) assert.strictEqual((await fetch(new URL(lazy, dev.url))).status, 200, lazy);
    const unknown = await fetch(new URL('README.md', dev.url));
    assert.strictEqual(unknown.status, 404);
    console.log('통과  한 폴더 개발 서버·실행 파일·파일 접근 제한');
  } finally { await dev.close(); }
})().catch(error => { console.error(error); process.exit(1); });
