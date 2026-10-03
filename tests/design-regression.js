const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
    await page.locator('.home-top').waitFor();
    await page.waitForTimeout(600);
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px horizontal overflow`);
    assert.strictEqual(await page.locator('.ai-team-card').evaluate(el => getComputedStyle(el).opacity), '1', `${width}px AI card hidden offscreen`);
    assert.strictEqual(await page.locator('.hero').evaluate(el => getComputedStyle(el, '::after').animationName), 'none', `${width}px perpetual hero animation`);
    await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', `refresh-${width}.png`), fullPage: true });
    if (width === 1440) {
      await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
      await page.waitForTimeout(350);
      await page.screenshot({ path: path.join(__dirname, '..', 'screenshots', 'refresh-dark.png'), fullPage: true });
    }
    await page.close();
  }
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('통과  디자인: 전체 콘텐츠 가시성·애니메이션·반응형·콘솔');
})().catch(error => { console.error(error); process.exit(1); });
