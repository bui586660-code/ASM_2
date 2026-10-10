const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createServer } = require('../../Backend/server.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttech-auth-ui-'));
  const dbPath = path.join(directory, 'db.json');
  const original = await fs.readFile(path.resolve(__dirname, '../../Backend/db.json'));
  const products = JSON.parse(original).products;
  await fs.writeFile(dbPath, JSON.stringify({ products, users: [], authSessions: [] }));
  const frontend = path.resolve(__dirname, '..');
  const staticServer = http.createServer(async (req, res) => {
    const file = path.resolve(frontend, '.' + (new URL(req.url, 'http://test').pathname === '/' ? '/index.html' : new URL(req.url, 'http://test').pathname));
    if (!file.startsWith(frontend + path.sep)) { res.writeHead(403); res.end(); return; }
    try {
      const content = await fs.readFile(file);
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
      res.end(content);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${staticServer.address().port}`;
  const backend = await createServer({ dbPath, origins: [origin], rateLimitMax: 100 });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${backend.address().port}`;
  const browser = await chromium.launch();
  const secret = randomBytes(20).toString('base64url');
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    // Forward real HTTP requests to an isolated backend, without touching the user's database.
    await context.route(/^http:\/\/(localhost|127\.0\.0\.1):3000\//, async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: api + url.pathname + url.search });
      await route.fulfill({ response });
    });
    const page = await context.newPage();
    const runtimeErrors = [];
    page.on('pageerror', e => runtimeErrors.push(e.message));
    await page.goto(origin + '/#product/11');
    await page.locator('#detail-title').waitFor();
    await page.locator('.detail-purchase [data-buy]').click();
    await page.locator('#auth-modal').waitFor();
    assert.equal(await page.locator('#cart-count').innerText(), '0', 'Buy is deferred until authenticated');
    await page.locator('#register-tab').click();
    await page.locator('#auth-name').fill('   ');
    await page.locator('#auth-email').fill('bad-email');
    await page.locator('#auth-password').fill('short');
    await page.locator('#auth-confirm').fill('other');
    await page.locator('#auth-submit').click();
    for (const field of ['name', 'email', 'password', 'confirm']) assert.equal(await page.locator(`#auth-${field}-error`).isVisible(), true);
    await page.locator('#auth-name').fill('  Người kiểm tra  ');
    await page.locator('#auth-email').fill('  Tester@Example.com ');
    await page.locator('#auth-password').fill(secret);
    await page.locator('#auth-confirm').fill(secret);
    await page.locator('#password-toggle').click();
    await page.locator('#confirm-toggle').click();
    assert.equal(await page.locator('#auth-password').getAttribute('type'), 'text');
    assert.equal(await page.locator('#auth-confirm').getAttribute('type'), 'text');
    await page.locator('#auth-submit').click();
    await page.waitForFunction(() => document.querySelector('#login-tab').getAttribute('aria-pressed') === 'true');
    assert.match(await page.locator('#auth-feedback').innerText(), /Đăng ký thành công/);
    assert.equal(await page.locator('#auth-email').inputValue(), 'tester@example.com');
    assert.equal(await page.locator('#auth-password').inputValue(), '');
    assert.equal(await page.locator('#auth-password').getAttribute('type'), 'password');
    await page.locator('#auth-password').fill(secret);
    await page.locator('#auth-submit').click();
    await page.locator('#cart-modal').waitFor();
    assert.equal(await page.locator('#cart-count').innerText(), '1', 'Original Buy Now continues exactly once');
    assert.match(await page.locator('#account-name').innerText(), /Người kiểm tra/);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#account-name').textContent.includes('Người kiểm tra'));
    await page.locator('#auth-open').click();
    await page.locator('#account-profile').click();
    await page.locator('#account-modal').waitFor();
    assert.equal(await page.locator('#profile-email').innerText(), 'tester@example.com');
    assert.equal(await page.locator('#account-admin').isVisible(), false);
    const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.ok(!stored.includes(secret));
    assert.ok(!stored.includes('tester@example.com'));
    const cookie = (await context.cookies()).find(c => c.name === 'ttech_session');
    assert.equal(cookie.httpOnly, true);
    assert.ok(!await page.evaluate(() => document.cookie.includes('ttech_session')));
    const otherTab = await context.newPage();
    await otherTab.goto(origin);
    await otherTab.waitForFunction(() => document.querySelector('#account-name').textContent.includes('Người kiểm tra'));
    // Hold an old session response while logout arrives through BroadcastChannel.
    let releaseStale, captureStale, intercepted = false;
    const staleCaptured = new Promise(resolve => { captureStale = resolve; });
    const staleReleased = new Promise(resolve => { releaseStale = resolve; });
    await otherTab.route('**/api/auth/session', async route => {
      if (intercepted) return route.fallback();
      intercepted = true;
      const response = await route.fetch({ url: api + '/api/auth/session' });
      captureStale();
      await staleReleased;
      await route.fulfill({ response });
    });
    await otherTab.evaluate(() => window.dispatchEvent(new Event('focus')));
    await staleCaptured;
    await page.locator('#profile-logout').click();
    await page.waitForFunction(() => !document.querySelector('#account-modal').open);
    releaseStale();
    await otherTab.waitForFunction(() => document.querySelector('#account-name').textContent.includes('Đăng nhập'), null, { timeout: 5000 });
    await otherTab.unroute('**/api/auth/session');
    await page.reload();
    await page.locator('#detail-title').waitFor();
    // Closing a pending login clears credentials and cancels the deferred purchase.
    await page.locator('.detail-purchase [data-buy]').click();
    await page.locator('#auth-modal').waitFor();
    await page.locator('#auth-email').fill('tester@example.com');
    await page.locator('#auth-password').fill(secret);
    let cancelRequest, releaseCanceled;
    const requestCaptured = new Promise(resolve => { cancelRequest = resolve; });
    const requestReleased = new Promise(resolve => { releaseCanceled = resolve; });
    await page.route('**/api/auth/login', async route => {
      cancelRequest();
      await requestReleased;
      await route.abort().catch(() => undefined);
    });
    await page.locator('#auth-submit').click();
    await requestCaptured;
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#auth-modal').open && document.querySelector('#auth-password').value === '');
    assert.equal(await page.locator('#auth-password').inputValue(), '');
    assert.equal(await page.locator('#cart-count').innerText(), '1');
    releaseCanceled();
    await page.unroute('**/api/auth/login', undefined, { behavior: 'wait' });
    await page.locator('#auth-open').click();
    await page.locator('#auth-email').fill('tester@example.com');
    await page.locator('#auth-password').fill('wrong-password-value');
    await page.locator('#auth-submit').click();
    await page.getByText('Email hoặc mật khẩu không chính xác.', { exact: true }).waitFor();
    await page.locator('#auth-email').fill('nobody@example.com');
    await page.locator('#auth-submit').click();
    await page.getByText('Email hoặc mật khẩu không chính xác.', { exact: true }).waitFor();
    await page.locator('#register-tab').click();
    await page.locator('#auth-name').fill('Duplicate');
    await page.locator('#auth-email').fill('TESTER@example.com');
    await page.locator('#auth-password').fill(secret);
    await page.locator('#auth-confirm').fill(secret);
    await page.locator('#auth-submit').click();
    await page.locator('#auth-email-error').filter({ hasText: 'Email này đã được đăng ký.' }).waitFor();
    assert.equal(JSON.parse(await fs.readFile(dbPath, 'utf8')).users.length, 1);

    // Error/loading states: the UI must recover and never claim a successful login.
    await page.locator('#login-tab').click();
    await page.locator('#auth-email').fill('tester@example.com');
    await page.locator('#auth-password').fill(secret);
    for (const failure of ['offline', 'invalid', 'not-found', 'server-error', 'timeout']) {
      await page.route('**/api/auth/login', async route => {
        if (failure === 'offline') return route.abort();
        if (failure === 'timeout') { await new Promise(resolve => setTimeout(resolve, 8500)); return route.abort().catch(() => undefined); }
        return route.fulfill({ status: failure === 'not-found' ? 404 : failure === 'server-error' ? 500 : 200,
          contentType: 'application/json', body: failure === 'invalid' ? '{broken' : '{}' });
      });
      await page.locator('#auth-submit').click();
      if (failure === 'timeout') assert.equal(await page.locator('#auth-submit').isDisabled(), true);
      await page.waitForFunction(() => !document.querySelector('#auth-submit').disabled && document.querySelector('#auth-feedback').textContent.length > 0);
      assert.doesNotMatch(await page.locator('#auth-feedback').innerText(), /TypeError|Failed to fetch|localhost|404|500/);
      assert.equal(await page.locator('#auth-modal').isVisible(), true);
      await page.unroute('**/api/auth/login');
    }
    // Admin privileges are loaded from the backend, never from local storage.
    const db = JSON.parse(await fs.readFile(dbPath, 'utf8')); db.users[0].role = 'admin'; await fs.writeFile(dbPath, JSON.stringify(db));
    await page.locator('#auth-submit').click();
    await page.waitForFunction(() => !document.querySelector('#auth-modal').open);
    await page.locator('#auth-open').click();
    await page.locator('#account-admin').click();
    await page.locator('#admin-feedback').filter({ hasText: '39' }).waitFor();
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.locator('#profile-logout').click();
    await page.locator('#auth-open').click();
    await page.locator('#register-tab').click();
    assert.equal(await page.locator('#auth-confirm').isVisible(), true);
    assert.equal(await page.evaluate(() => document.querySelector('#auth-modal').scrollWidth <= document.querySelector('#auth-modal').clientWidth), true);
    assert.deepEqual(runtimeErrors, []);
    assert.deepEqual(JSON.parse(await fs.readFile(dbPath, 'utf8')).products, products);
    assert.deepEqual(await fs.readFile(path.resolve(__dirname, '../../Backend/db.json')), original);
    console.log('PASS: real registration/login/logout/persist/profile/admin, protected Buy continuation, validation/duplicates/password toggles, multi-tab logout with stale response, canceled login, offline/404/500/invalid/timeout/loading, no secrets in browser storage, mobile and unchanged product data.');
  } finally {
    await browser.close();
    await Promise.all([new Promise(r => backend.close(r)), new Promise(r => staticServer.close(r))]);
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
