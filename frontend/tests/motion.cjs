// Run after starting the frontend (:8000) and existing product API (:3000).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8000/#products');
    await page.waitForSelector('#product-grid .product-card');
    await page.evaluate(() => document.fonts.ready);
    const card = page.locator('#product-grid .product-card').first();
    const neighbor = page.locator('#product-grid .product-card').nth(1);
    await card.scrollIntoViewIfNeeded();
    const style = (locator, property, pseudo = null) => locator.evaluate((e, [key, part]) => getComputedStyle(e, part)[key], [property, pseudo]);
    const tokens = await page.locator('html').evaluate(e => {
      const css = getComputedStyle(e);
      return ['fast','normal','smooth','emphasis'].map(name => css.getPropertyValue('--motion-' + name).trim());
    });
    assert.deepEqual(tokens, ['120ms','180ms','220ms','280ms']);
    const base = await card.boundingBox();
    const adjacent = await neighbor.boundingBox();
    const intrinsicSize = await card.evaluate(e => [e.offsetWidth, e.offsetHeight]);
    await card.locator('.product-image').hover();
    await page.waitForTimeout(320);
    const raised = await card.boundingBox();
    assert.ok(Math.abs(base.y - raised.y - 3) < 0.1, 'Card raises exactly 3px');
    assert.deepEqual(await neighbor.boundingBox(), adjacent, 'Hover must not shift neighboring cards');
    assert.deepEqual(await card.evaluate(e => [e.offsetWidth,e.offsetHeight]), intrinsicSize);
    assert.equal(await style(card, 'borderColor'), 'rgb(227, 30, 36)');
    assert.equal(await style(card, 'transitionDuration'), '0.22s, 0.22s, 0.22s');
    assert.equal(await style(card.locator('img'), 'transform'), 'matrix(1.04, 0, 0, 1.04, 0, 0)');
    assert.equal(await style(card.locator('.product-media'), 'overflow'), 'hidden');
    assert.equal(await style(card.locator('img'), 'objectFit'), 'contain');
    assert.ok(parseFloat(await style(card.locator('img'), 'paddingLeft')) >= 6, 'Safe inset leaves room for a contained image to zoom');
    await page.mouse.move(0, 0);
    await page.waitForTimeout(320);
    assert.deepEqual(await card.boundingBox(), base, 'Card returns smoothly to its original position');

    const buy = card.locator('[data-buy]');
    await buy.hover();
    await page.waitForTimeout(250);
    assert.equal(await style(buy, 'opacity', '::before'), '1');
    assert.equal(await style(buy, 'transform'), 'matrix(1, 0, 0, 1, 0, -2)');
    const add = card.locator('[data-add]');
    await add.hover();
    await page.waitForTimeout(250);
    assert.equal(await style(add, 'backgroundColor'), 'rgb(254, 242, 242)');
    await add.click();
    assert.equal(await page.locator('#cart-count').innerText(), '1');
    assert.equal(await page.locator('.badge-pop,.added').count(), 0, 'No bounce classes or forced-reflow animation restart');
    await page.waitForTimeout(250);
    assert.equal(await style(page.locator('#toast'), 'opacity'), '1');

    const favorite = card.locator('[data-favorite]');
    await favorite.click();
    await page.waitForTimeout(220);
    assert.equal(await style(favorite.locator('svg'), 'fill'), 'rgb(227, 30, 36)');
    await page.locator('#header-search').focus();
    await page.waitForTimeout(220);
    assert.equal(await style(page.locator('.header-search'), 'borderColor'), 'rgb(227, 30, 36)');
    assert.match(await style(page.locator('.header-search'), 'boxShadow'), /0\.08/);

    const nav = page.locator('.nav-link[href="#home"]');
    const navLayout = () => nav.evaluate(e => [e.offsetLeft, e.offsetTop, e.offsetWidth, e.offsetHeight]);
    const navBox = await navLayout();
    await nav.hover();
    await page.waitForTimeout(220);
    assert.equal(await style(nav, 'transform', '::after'), 'matrix(1, 0, 0, 1, 0, 0)');
    assert.deepEqual(await navLayout(), navBox, 'Animated underline does not change link layout');
    const spec = card.locator('.spec-list>div').first();
    await spec.hover();
    await page.waitForTimeout(180);
    assert.equal(await style(spec, 'backgroundColor'), 'rgb(243, 244, 246)');
    assert.equal(await style(spec, 'transform'), 'none');

    await page.locator('#auth-open').click();
    await page.waitForTimeout(240);
    await page.locator('[data-close="auth-modal"]').click();
    assert.equal(await page.locator('#auth-modal').evaluate(e => e.open), true, 'Dialog remains modal during exit');
    await page.waitForFunction(() => !document.querySelector('#auth-modal').open);
    await page.waitForFunction(() => !document.body.classList.contains('modal-open'));
    assert.equal(await page.locator('body').evaluate(e => e.classList.contains('modal-open')), false);

    await page.locator('#cart-open').click();
    await page.locator('.qty-button[data-delta="1"]').hover();
    await page.waitForTimeout(220);
    assert.equal(await style(page.locator('.qty-button[data-delta="1"]'), 'backgroundColor'), 'rgb(254, 242, 242)');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#cart-modal').open);

    const group = page.locator('.filter-group').first();
    const nativeAnimation = await page.evaluate(() => CSS.supports('interpolate-size','allow-keywords') && CSS.supports('selector(details::details-content)'));
    if (nativeAnimation) {
      const startHeight = parseFloat(await style(group, 'blockSize', '::details-content'));
      await group.locator('summary').click();
      await page.waitForTimeout(70);
      const intermediate = parseFloat(await style(group, 'blockSize', '::details-content'));
      assert.ok(intermediate > 0 && intermediate < startHeight, 'Accordion smoothly interpolates instead of jumping');
      await page.waitForTimeout(240);
      assert.equal(parseFloat(await style(group, 'blockSize', '::details-content')), 0);
      await group.locator('summary').click();
      await page.waitForTimeout(250);
      assert.ok(parseFloat(await style(group, 'blockSize', '::details-content')) > 0);
    }

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await card.locator('img').hover();
    assert.equal(await style(card,'transform'), 'none');
    assert.equal(await style(card.locator('img'),'transform'), 'none');
    assert.equal(await style(card,'transitionDuration'), '0s');
    await buy.hover();
    assert.equal(await style(buy,'transform'), 'none');
    assert.equal(await style(buy,'opacity','::before'), '1', 'Reduced motion retains visual feedback');
    await page.locator('#auth-open').click();
    await page.locator('[data-close="auth-modal"]').click();
    assert.equal(await page.locator('#auth-modal').evaluate(e => e.open), false);

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile:true, hasTouch:true });
    await mobile.goto('http://127.0.0.1:8000/#products');
    await mobile.waitForSelector('#product-grid .product-card');
    await mobile.locator('#product-grid .product-brand').first().tap();
    assert.equal(await style(mobile.locator('#product-grid .product-card').first(),'transform'), 'matrix(1, 0, 0, 1, 0, 0)');
    assert.equal(await style(mobile.locator('#product-grid .product-image').first(),'transform'), 'none');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mobile.locator('#filter-open').tap();
    await mobile.locator('.drawer-footer button').tap();
    await mobile.waitForFunction(() => !document.querySelector('#filter-modal').open);
    assert.deepEqual(errors, []);
    console.log('PASS: tokens, card lift/return, stable neighboring layout, contained image zoom, CTA/favorite/search feedback, modal exit, native accordion, reduced motion, touch without sticky hover.');
    console.log('Native accordion interpolation supported:', nativeAnimation);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
