// 선택 테스트: NODE_PATH에 Playwright가 있을 때 node tests/browser-smoke.js
const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const sample = async () => ({});
    sample.json = async prompt => prompt.includes('학습 조교다') ? { answer: 'FCFS는 먼저 도착한 작업부터 처리해요.', pages: [1], uncertainty: '' } :
      { title: '프로세스 스케줄링', overview: '스케줄링의 기본을 다룹니다.', sections: [{ heading: 'FCFS', points: [{ text: '먼저 도착한 작업부터 처리한다.', pages: [1] }] }], terms: [], formulas: [], examPoints: [] };
    sample.limits = async () => ({ images: { maxCount: 0 } });
    window.claude = { use: async name => name === 'sample' ? sample : null };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
  await page.locator('.ai-team-open').click();
  assert.strictEqual(await page.locator('.provider-field').count(), 7);
  assert.match(await page.locator('.agent-details').textContent(), /독립된 모델 수가 아니라/);
  await page.route('https://api.mistral.ai/v1/chat/completions', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }) }));
  await page.getByRole('textbox', { name: 'Mistral API 키' }).fill('test-only');
  await page.locator('.provider-field').filter({ hasText: 'Mistral' }).getByRole('button', { name: '연결 확인' }).click();
  await page.locator('.provider-field').filter({ hasText: 'Mistral' }).locator('[data-state="ready"]').waitFor();
  await page.getByRole('button', { name: '설정 적용' }).click();
  assert.match(await page.locator('.ai-pill').first().innerText(), /확인/);
  await page.evaluate(() => AI.configure({ mistralKey: '' }));
  await page.waitForTimeout(700);
  await page.locator('.newcourse input').fill('운영체제');
  await page.getByRole('button', { name: '과목 만들기' }).click();
  await page.locator('.bnav').waitFor();
  await page.locator('.bnav a').filter({ hasText: '강의' }).click();
  await page.locator('.paste summary').click();
  await page.locator('.paste textarea').fill('FCFS는 먼저 도착한 작업부터 처리한다. '.repeat(5));
  await page.locator('.paste button').filter({ hasText: '정리하기' }).click();
  await page.locator('.item-list .item').first().waitFor({ timeout: 15000 });
  await page.locator('.item-list .item').first().getByText('보기').click();
  await page.getByRole('button', { name: '이 강의에 질문' }).click();
  await page.locator('.ask-dialog textarea').fill('FCFS가 어떻게 동작하나요?');
  await page.locator('.ask-dialog button[type="submit"]').click();
  await page.locator('.ask-answer').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.ask-sources').innerText(), /p\.1/);
  await page.locator('.ask-dialog').screenshot({ path: path.join(__dirname, '..', 'screenshots', 'v08-ask.png') });
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
  await mobile.locator('.ai-team-open').click();
  assert.strictEqual(await mobile.locator('.provider-field').count(), 7);
  assert.strictEqual(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.locator('.ai-dialog').screenshot({ path: path.join(__dirname, '..', 'screenshots', 'v08-settings-mobile.png') });
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('통과  설정·연결 확인·강의 질문·모바일 화면');
})().catch(e => { console.error(e); process.exit(1); });
