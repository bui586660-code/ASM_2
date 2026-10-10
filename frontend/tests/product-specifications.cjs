const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const products = JSON.parse(fs.readFileSync(path.join(__dirname, '../../Backend/db.json'), 'utf8')).products;
  const product = products.find(item => String(item.id) === '3');
  product.specifications = [
    { label: 'Loại RAM', value: 'SODIMM DDR5-4800' },
    { label: 'Cổng giao tiếp', value: 'USB-C\nHDMI 2.1' },
    { label: '<img src=x onerror=alert(1)>', value: '<script>alert(1)</script>' }
  ];
  product.images = [product.image, products[0].image, 'javascript:alert(1)', null, products[0].image];
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/products', route => route.fulfill({ json: products }));
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: null } }));
    await page.goto('http://127.0.0.1:8000/#product/3');
    await page.locator('#detail-specifications tbody tr').first().waitFor();
    assert.equal(await page.locator('#detail-specifications tbody tr').count(), 3);
    assert.equal(await page.locator('#detail-specifications tbody br').count(), 1);
    assert.equal(await page.locator('#detail-specifications tbody img, #detail-specifications tbody script').count(), 0);
    assert.equal(await page.locator('.detail-highlights dt').count(), 5);
    assert.equal(await page.locator('.gallery-thumbnail').count(), 3);
    await page.locator('[data-gallery-index="1"]').click();
    await page.waitForFunction(() => document.querySelector('[data-gallery-index="1"]').getAttribute('aria-pressed') === 'true');
    assert.match(await page.locator('.gallery-image.is-active').getAttribute('src'), /assets\/images\//);
    await page.locator('.gallery-stage').focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-gallery-index="2"]').getAttribute('aria-pressed') === 'true');
    assert.match(await page.locator('.gallery-image.is-active').getAttribute('src'), /^data:image\/svg/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto('http://127.0.0.1:8000/#product/1');
    await page.locator('#detail-specifications tbody tr').first().waitFor();
    assert.equal(await page.locator('#detail-specifications tbody tr').count(), 5);
    assert.equal(await page.locator('.gallery-thumbnail').count(), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: detailed specifications, escaping, gallery, fallback and mobile');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
