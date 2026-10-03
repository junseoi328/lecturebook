// 선택 테스트: NODE_PATH에 Playwright가 있을 때 node build.js && node tests/translate-smoke.js [원본.pptx]
// 가짜 AI로 번역 PPT 카드의 올리기 → 번역 → 줄이기 → 내려받기 흐름을 확인한다. (JSZip은 CDN에서 받는다)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2] || path.join(__dirname, 'fixtures', 'os-week6.pptx');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const sample = async () => ({});
    // 첫 번역은 일부러 길게, 줄이기 요청에는 짧게 답한다
    sample.json = async prompt => {
      const items = JSON.parse(prompt.slice(prompt.lastIndexOf('입력:\n') + 4));
      const shorten = prompt.includes('들어가기엔 길다');
      (window.__calls = window.__calls || []).push(shorten ? 'shorten' : 'translate');
      return { items: items.map(x => ({ id: x.id, ko: shorten ? '짧은 번역' : '아주 길게 늘어진 한국어 번역 문장 '.repeat(4).trim() })) };
    };
    sample.limits = async () => ({ images: { maxCount: 0 } });
    window.claude = { use: async name => name === 'sample' ? sample : null };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
  const run = page.getByRole('button', { name: '한국어 PPT 만들기' });
  assert.strictEqual(await run.isDisabled(), true, '파일을 올리기 전에는 실행할 수 없다');
  await page.getByLabel('번역할 영어 PPTX').setInputFiles(source);
  await run.click();
  const get = page.getByRole('button', { name: '한국어 PPT 받기' });
  await get.waitFor({ timeout: 30000 });
  assert.match(await page.locator('.job.ok').last().innerText(), /한국어로 바꿨어요/);
  assert.deepStrictEqual([...new Set(await page.evaluate(() => window.__calls))], ['translate', 'shorten']);
  const [download] = await Promise.all([page.waitForEvent('download'), get.click()]);
  assert.match(download.suggestedFilename(), /_ko\.pptx$/);
  const out = path.join(__dirname, '..', 'screenshots', download.suggestedFilename());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await download.saveAs(out);
  // 결과 파일을 같은 페이지의 JSZip으로 다시 열어 한국어가 들어갔는지 본다
  const text = await page.evaluate(async b64 => {
    const zip = await JSZip.loadAsync(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    return zip.file(/^ppt\/slides\/slide\d+\.xml$/)[0].async('string');
  }, fs.readFileSync(out).toString('base64'));
  assert(text.includes('짧은 번역'), '줄인 번역이 슬라이드에 들어가야 한다');
  await page.locator('.quick-wrap').nth(1).screenshot({ path: path.join(__dirname, '..', 'screenshots', 'translate-card.png') });
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('통과  번역 PPT: 올리기·번역·줄이기·내려받기 →', out);
})().catch(e => { console.error(e); process.exit(1); });
