// 선택 테스트: NODE_PATH에 Playwright가 있을 때 node build.js && node tests/translate-smoke.js [원본.pdf]
// 가짜 AI로 번역 PDF 카드의 올리기 → 번역 → 줄이기 → 내려받기 흐름을 확인한다. (pdf.js와 jsPDF는 CDN에서 받는다)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const source = process.argv[2] || path.join(__dirname, 'fixtures', 'en-slides.pdf');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const sample = async () => ({});
    // 첫 번역은 일부러 길게, 줄이기 요청에는 짧게 답한다
    sample.json = async prompt => {
      if (window.__failOnce) { window.__failOnce = false; throw { code: 'rate_limited' }; }
      const items = JSON.parse(prompt.slice(prompt.lastIndexOf('입력:\n') + 4));
      const shorten = prompt.includes('들어가기엔 길다');
      (window.__calls = window.__calls || []).push(shorten ? 'shorten' : 'translate');
      (window.__en = window.__en || []).push(...(shorten ? [] : items.map(x => x.en)));
      return { items: items.map(x => ({ id: x.id, ko: shorten ? '줄인 한국어 번역' : '아주 길게 늘어진 한국어 번역 문장 '.repeat(12).trim() })) };
    };
    sample.limits = async () => ({ images: { maxCount: 0 } });
    window.claude = { use: async name => name === 'sample' ? sample : null };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
  const run = page.getByRole('button', { name: '한국어 PDF 만들기' });
  assert.strictEqual(await run.isDisabled(), true, '파일을 올리기 전에는 실행할 수 없다');
  await page.getByLabel('번역할 영어 PDF').setInputFiles(source);
  await run.click();
  const get = page.getByRole('button', { name: '한국어 PDF 받기' });
  await get.waitFor({ timeout: 60000 });
  assert.match(await page.locator('.job.ok').last().innerText(), /한국어로 바꿨어요/);
  assert.deepStrictEqual([...new Set(await page.evaluate(() => window.__calls))], ['translate', 'shorten']);
  if (!process.argv[2]) {
    const en = await page.evaluate(() => window.__en);
    assert(en.some(t => /in the order they arrive, which is simple but can cause/.test(t)), '줄바꿈된 문장은 한 문단으로 묶어 번역한다');
    assert(en.includes('Algorithm') && en.includes('Average waiting time'), '표의 칸은 따로 번역한다');
    assert(en.some(t => /^Preemptive scheduling can interrupt a running process/.test(t)) && !en.some(t => /interrupt a Non-preemptive/.test(t)), '두 단은 섞지 않는다');
  }
  const [download] = await Promise.all([page.waitForEvent('download'), get.click()]);
  assert.match(download.suggestedFilename(), /_ko\.pdf$/);
  const out = path.join(__dirname, '..', 'screenshots', download.suggestedFilename());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await download.saveAs(out);
  // 결과 파일을 같은 페이지의 pdf.js로 다시 열어 쪽수가 같은지 본다
  const pages = await page.evaluate(async ([a, b]) => {
    const count = async b64 => (await pdfjsLib.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise).numPages;
    return [await count(a), await count(b)];
  }, [fs.readFileSync(source).toString('base64'), fs.readFileSync(out).toString('base64')]);
  assert(pages[0] > 0 && pages[0] === pages[1], `쪽수가 원본과 같아야 한다: ${pages}`);
  if (!process.argv[2]) {
    // 수식 견본: 첨자는 V_{G} 표기로 한 문단에 묶이고, 수식 글꼴로 쓴 식은 보내지 않는다. 첫 요청이 실패해도 기다렸다가 끝까지 번역한다
    await page.evaluate(() => { window.__en = []; window.__failOnce = true; PdfTranslate.config.retryWaits = [0, 200, 200]; PdfTranslate.config.minGapMs = 0; });
    await page.getByLabel('번역할 영어 PDF').setInputFiles(path.join(__dirname, 'fixtures', 'en-math.pdf'));
    await run.click();
    await page.getByRole('button', { name: '한국어 PDF 받기' }).waitFor({ timeout: 60000 });
    const math = await page.evaluate(() => window.__en);
    assert(math.includes('See accumulation, depletion, and inversion as V_{G} changes'), '첨자를 살려 한 문단으로 묶는다: ' + JSON.stringify(math));
    assert(math.some(t => /^The oxide blocks current: the transferred charge .* \(ionized acceptors\)$/.test(t)), '글머리표 내어쓰기 문단을 한 문단으로 묶는다');
    assert(!math.some(t => /E_\{Fm\}|t_\{ox\} = 30|^p-Si$/.test(t)), '수식·단위·기호만 있는 줄은 번역 대상이 아니다');
    assert(math.includes('huge electron density: cannot be depleted') && math.includes('x_{d}: depletion width'), '그림 라벨도 번역한다');
    assert.strictEqual(await page.evaluate(() => window.__failOnce), false, '실패한 요청을 다시 보냈다');
  }
  assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('통과  번역 PDF: 올리기·문단 묶기·번역·줄이기·내려받기 →', out);
})().catch(e => { console.error(e); process.exit(1); });
