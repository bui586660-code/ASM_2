// Run with the frontend at :8000 and the T-TECH backend at :3000.
// node ASM/frontend/tests/redesign.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const database = path.resolve(__dirname, '../../Backend/db.json');
const checksum = () => crypto.createHash('sha256').update(fs.readFileSync(database)).digest('hex');
const before = checksum();
const products = JSON.parse(fs.readFileSync(database, 'utf8')).products;
const sale = p => typeof p.sale_price === 'number' && p.sale_price >= 0 && p.sale_price < p.price ? p.sale_price : p.price;
const brand = p => (p.brand || p.name.split(' ')[0]).toLowerCase();
const expectedIds = rows => rows.map(p => String(p.id));

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    // Product regression only; real authentication is covered by auth-ui.cjs.
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: { id: 'fixture', name: 'Product tester', email: 'fixture@example.com', role: 'user', status: 'active' } } }));
    const runtimeErrors = [];
    const consoleErrors = [];
    page.on('requestfailed', request => console.log('Request failed:', request.url(), request.failure()?.errorText));
    page.on('pageerror', error => runtimeErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const response = await page.request.get('http://localhost:3000/products');
    assert.equal(response.status(), 200);
    const canonicalIds = rows => rows.map(p => ({ ...p, id: String(p.id) }));
    assert.deepEqual(canonicalIds(await response.json()), canonicalIds(products), 'Live API must serve the current database (JSON Server serializes IDs as strings)');
    await page.goto('http://127.0.0.1:8000/#products');
    await page.waitForSelector('#product-grid .product-card');
    await page.evaluate(() => document.fonts.ready);
    const ids = () => page.locator('#product-grid .product-card').evaluateAll(cards => cards.map(c => c.dataset.productId));
    assert.deepEqual(await ids(), expectedIds(products));
    assert.equal(await page.title(), 'Laptop Chính Hãng | T-TECH');
    assert.deepEqual(await page.evaluate(() => {
      const all = [...document.querySelectorAll('[id]')].map(e => e.id);
      return all.filter((id, i) => all.indexOf(id) !== i);
    }), [], 'No duplicate DOM IDs');

    await page.locator('[data-brand="ASUS"]').click();
    const asus = products.filter(p => brand(p) === 'asus');
    assert.deepEqual(await ids(), expectedIds(asus));
    assert.equal(await page.locator('[name="brand-choice"][value="ASUS"]').isChecked(), true);
    await page.locator('[name="price-choice"][value="25to35"]').check();
    assert.deepEqual(await ids(), expectedIds(asus.filter(p => sale(p) >= 25000000 && sale(p) < 35000000)));
    await page.locator('[data-clear-filter="brand"]').click();
    assert.deepEqual(await ids(), expectedIds(products.filter(p => sale(p) >= 25000000 && sale(p) < 35000000)));
    await page.locator('#reset-filters').click();
    for (const [mode, multiplier] of [['asc', 1], ['desc', -1]]) {
      await page.locator('#sort').selectOption(mode);
      assert.deepEqual(await ids(), expectedIds([...products].sort((a, b) => multiplier * (sale(a) - sale(b)))));
    }
    await page.locator('#sort').selectOption('featured');
    assert.deepEqual(await ids(), expectedIds(products));
    await page.locator('#header-search').fill('Katana');
    await page.locator('#header-search').press('Enter');
    assert.deepEqual(await ids(), expectedIds(products.filter(p => p.name.toLowerCase().includes('katana'))));
    await page.locator('#search').fill('no-such-laptop-123');
    assert.equal(await page.locator('#empty-state').isVisible(), true);
    await page.locator('#empty-reset').click();

    const first = String(products[0].id);
    await page.locator(`#product-grid [data-favorite="${first}"]`).click();
    await page.locator(`#product-grid [data-add="${first}"]`).click();
    assert.equal(await page.locator('#cart-count').innerText(), '1');
    await page.reload();
    await page.waitForSelector('#product-grid .product-card');
    assert.equal(await page.locator(`#product-grid [data-favorite="${first}"]`).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('#cart-count').innerText(), '1');
    await page.locator(`#product-grid [data-buy="${first}"]`).click();
    await page.locator('#cart-modal').waitFor();
    assert.equal(await page.locator('#cart-modal').isVisible(), true);
    assert.equal(await page.locator('#cart-count').innerText(), '2');
    await page.locator('[data-delta="1"]').click();
    assert.equal(await page.locator('#cart-count').innerText(), '3');
    await page.locator('[data-delta="-1"]').click();
    assert.equal(await page.locator('#cart-count').innerText(), '2');
    assert.equal(await page.locator('#cart-total').innerText(), new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(sale(products[0]) * 2));
    // Checkout integration is exercised against a real authenticated backend in checkout-ui.cjs.
    await page.route('**/api/orders/quote', route => route.fulfill({json:{items:[{productId:first,name:products[0].name,image:products[0].image,price:sale(products[0]),quantity:2,subtotal:sale(products[0])*2}],subtotal:sale(products[0])*2,shippingFee:0,discount:0,total:sale(products[0])*2,quoteHash:'fixture'}}));
    await page.locator('#checkout').click();
    await page.locator('#checkout-form').waitFor();
    assert.equal(await page.locator('#cart-count').innerText(),'2');
    await page.locator('#cart-open').click();
    await page.locator('[data-remove]').click();
    assert.equal(await page.locator('#cart-count').innerText(), '0');
    await page.keyboard.press('Escape');

    // Real register/login validation and persistence run in auth-ui.cjs.
    await page.goto('http://127.0.0.1:8000/#home');
    await page.locator('.slider-next').click();
    assert.match(await page.locator('.hero-slide.is-active').getAttribute('aria-label'), /MSI/);
    await page.locator('.slider-prev').click();
    await page.goto('http://127.0.0.1:8000/#products');
    await page.waitForSelector('#product-grid .product-card');

    for (const [width, columns] of [[1440, 4], [1280, 4], [1024, 3], [768, 3], [390, 2], [360, 2]]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.locator('#product-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), columns);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `No overflow at ${width}`);
    }
    await page.locator('#filter-open').click();
    assert.equal(await page.locator('#filter-modal').isVisible(), true);
    await page.locator('[name="brand-choice"][value="MSI"]').check();
    await page.locator('.drawer-footer button').click();
    await page.waitForFunction(() => document.querySelector('#sidebar-slot #filter-sidebar'));
    assert.deepEqual(await ids(), expectedIds(products.filter(p => brand(p) === 'msi')));
    assert.equal(await page.locator('#sidebar-slot #filter-sidebar').count(), 1);
    await page.locator('#filter-open').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForFunction(() => !document.querySelector('#filter-modal').open);
    await page.waitForFunction(() => document.querySelector('#sidebar-slot #filter-sidebar'));
    assert.equal(await page.locator('#sidebar-slot #filter-sidebar').isVisible(), true);
    await page.locator('#reset-filters').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#menu-toggle').click();
    assert.equal(await page.locator('#main-nav').isVisible(), true);
    await page.locator('#main-nav .nav-link[href="#contact"]').click();
    assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'), 'false');

    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(consoleErrors, [], 'No console errors during normal operation');
    // Simulate an unavailable API, then remove interception and retry the real server.
    await page.route('http://localhost:3000/products', route => route.abort());
    await page.goto('http://127.0.0.1:8000/#products');
    await page.reload();
    await page.locator('#catalog-error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#catalog-error').innerText(), /Không thể tải sản phẩm/);
    assert.doesNotMatch(await page.locator('#catalog-error').innerText(), /localhost|JSON Server|Failed to fetch/);
    await page.unroute('http://localhost:3000/products');
    let pendingRequest;
    await page.route('http://localhost:3000/products', route => { pendingRequest = route; });
    await page.locator('#retry-products').click();
    await page.waitForFunction(() => document.querySelector('#product-grid').getAttribute('aria-busy') === 'true');
    assert.equal(await page.locator('#catalog-loading').isVisible(), true);
    assert.equal(await page.locator('#cart-open').isDisabled(), true);
    while (!pendingRequest) await new Promise(resolve => setTimeout(resolve, 10));
    await pendingRequest.continue();
    await page.waitForSelector('#product-grid .product-card');
    await page.unroute('http://localhost:3000/products');
    assert.deepEqual(await ids(), expectedIds(products));
    await page.evaluate(() => { localStorage.removeItem('ttech-favorites-v1'); });
    await page.reload();
    await page.waitForSelector('#product-grid .product-card');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: 'docs/ui-reference/ttech-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.activeElement.blur(); scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: 'docs/ui-reference/ttech-desktop.png', fullPage: true });
    assert.equal(checksum(), before, 'Database unchanged');
    assert.deepEqual(runtimeErrors, []);
    console.log('PASS: live API, data, filters, search, sort, cart, favorites, authenticated purchase, slider, drawer, responsive, API error/retry, database checksum.');
    console.log('Console errors: 0 during normal operation; expected network error during simulated API outage.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
