// Deterministic storefront regression: product requests use the existing local database fixture.
// Start the frontend at :8000; a running backend is not required for this suite.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const database = path.resolve(__dirname, '../../Backend/db.json');
const bytes = fs.readFileSync(database);
const products = JSON.parse(bytes).products;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const api = 'http://localhost:3000/products';
const base = 'http://127.0.0.1:8000/';

async function checkSemantics(page) {
  const audit = await page.evaluate(() => {
    const visible = selector => [...document.querySelectorAll(selector)].filter(e => e.checkVisibility());
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id);
    return {
      h1: visible('h1').length,
      main: visible('main').length,
      unlabeledImages: document.querySelectorAll('img:not([alt])').length,
      duplicateIds: ids.filter((id, i) => ids.indexOf(id) !== i),
      missingIcons: [...document.querySelectorAll('use')].map(e => e.getAttribute('href')).filter(id => !document.querySelector(id)),
      font: getComputedStyle(document.body).fontFamily,
      faq: JSON.parse(document.querySelector('[type="application/ld+json"]').textContent).mainEntity
    };
  });
  assert.equal(audit.h1, 1);
  assert.equal(audit.main, 1);
  assert.equal(audit.unlabeledImages, 0);
  assert.deepEqual(audit.duplicateIds, []);
  assert.deepEqual(audit.missingIcons, []);
  assert.match(audit.font, /Saira/);
  for (const question of audit.faq) {
    const details = page.locator('#support details').filter({ hasText: question.name });
    assert.equal((await details.locator('p').textContent()).trim(), question.acceptedAnswer.text);
  }
}

async function checkHomeInteractions(page) {
  await page.goto(base);
  await page.waitForSelector('#featured-products .product-card');
  assert.equal(await page.locator('#featured-products .product-card').count(), 6);
  assert.equal(await page.locator('#discovery-products .product-card').count(), 9);
  assert.equal(await page.locator('#deal-products .product-card').count(), 5);
  assert.equal(await page.locator('#product-grid').innerHTML(), '', 'Inactive catalog does not duplicate the DOM');
  await checkSemantics(page);
  const first = page.locator('#featured-products .product-card').first();
  const id = await first.getAttribute('data-product-id');
  await first.locator('[data-add]').click();
  await first.locator('[data-favorite]').click();
  assert.equal(await page.locator('#cart-count').innerText(), '1');
  await first.locator('.product-title a').click();
  await page.waitForSelector('#detail-title');
  assert.equal(new URL(page.url()).hash, '#product/' + id);
  assert.equal(await page.locator('#featured-products').innerHTML(), '');
  await checkSemantics(page);
  await page.goBack();
  await page.waitForSelector('#featured-products .product-card');
  assert.equal(await page.locator('#featured-products [data-favorite]').first().getAttribute('aria-pressed'), 'true');
  await page.locator('#categories [data-home-brand="MSI"]').click();
  await page.waitForSelector('#product-grid .product-card');
  assert.equal(await page.locator('#product-grid .product-card').count(), products.filter(p => p.brand === 'MSI').length);
  await page.locator('#reset-filters').click();
  await page.locator('.brand').first().click();
  await page.locator('#header-search').fill('Katana');
  await page.locator('#header-search').press('Enter');
  await page.waitForSelector('#product-grid .product-card');
  assert.equal(await page.locator('#product-grid .product-card').count(), products.filter(p => /Katana/i.test(p.name)).length);
  await checkSemantics(page);
}

async function checkResponsive(page) {
  await page.goto(base);
  await page.waitForSelector('#featured-products .product-card');
  for (const [width, columns] of [[1440,6],[1280,6],[1024,6],[768,3],[390,2],[360,2],[320,2]]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.locator('#featured-products').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), columns);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}px`);
  }
  await page.locator('#newsletter-email').fill('test@example.com');
  await page.locator('#newsletter-form button').click();
  assert.match(await page.locator('#newsletter-note').innerText(), /chưa được gửi hoặc lưu/);
  await page.locator('.editorial-card summary').first().click();
  assert.equal(await page.locator('.editorial-card details').first().evaluate(e => e.open), true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: 'docs/ui-reference/reference-home-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'docs/ui-reference/reference-home-mobile.png', fullPage: true });
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    const consoleErrors = [];
    page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null } }));
    await page.route(api, route => route.fulfill({ json: products }));
    await checkHomeInteractions(page);
    await checkResponsive(page);
    assert.deepEqual(consoleErrors, [], 'No normal-operation console errors');
    await page.unroute(api);
    await page.route(api, route => route.fulfill({ status: 503, json: { error: 'unavailable' } }));
    await page.reload();
    await page.locator('#home-error').waitFor();
    assert.doesNotMatch(await page.locator('#home-error').innerText(), /localhost|JSON Server|Failed to fetch/);
    await page.unroute(api);
    await page.route(api, route => route.fulfill({ json: products }));
    await page.locator('#retry-home').click();
    await page.waitForSelector('#featured-products .product-card');
    assert.deepEqual(errors, []);
    assert.equal(digest(fs.readFileSync(database)), digest(bytes));
    console.log('PASS: home shelves, shared cart/favorites/detail, brand/search navigation, compact DOM, semantic headings/images/icons/FAQ, Saira, 320–1440px, newsletter/advice, API error/retry, unchanged database.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
