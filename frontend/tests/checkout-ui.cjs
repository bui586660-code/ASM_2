const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createServer } = require('../../Backend/server.cjs');

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttech-checkout-ui-'));
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
  const readStore = async () => JSON.parse(await fs.readFile(dbPath, 'utf8'));
  const backend = await createServer({ dbPath, promotions:{coupons:[{code:'TEST500',type:'fixed',value:500000,active:true,minSubtotal:20000000,perUserLimit:1},{code:'TEST100',type:'fixed',value:100000,active:true}]}, payments:{enabled:true, secret:randomBytes(32).toString('hex')}, origins: [origin], rateLimitMax: 100 });
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
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', e => runtimeErrors.push(e.message));

    const email = 'checkout@example.com';
    const registered = await fetch(api + '/api/auth/register', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Người nhận',email,password:secret,confirm:secret})});
    assert.equal(registered.status,201);
    await page.goto(origin + '/#products');
    await page.locator('#product-grid [data-add="1"]').click();
    await page.locator('#product-grid [data-add="2"]').click();
    await page.locator('#cart-open').click();
    await page.locator('#cart-select-all').uncheck();
    assert.equal(await page.locator('#checkout').isDisabled(),true,'Cannot check out without a selection');
    await page.locator('#cart-select-all').check();
    await page.locator('[data-cart-select="2"]').uncheck();
    await page.reload();
    await page.locator('#cart-open').click();
    assert.equal(await page.locator('[data-cart-select="2"]').isChecked(),false,'Selection persists');
    await page.locator('[data-qty="1"][data-delta="1"]').click();
    assert.equal(await page.locator('#cart-count').innerText(),'3');
    await page.locator('[data-qty="1"][data-delta="-1"]').click();
    assert.equal(await page.locator('#cart-count').innerText(),'2');
    await page.locator('#checkout').click();
    await page.locator('#auth-email').fill(email);
    await page.locator('#auth-password').fill(secret);
    await page.locator('#auth-submit').click();
    await page.locator('#checkout-form').waitFor();
    assert.equal(new URL(page.url()).hash,'#checkout');
    assert.equal(await page.locator('#cart-count').innerText(),'2','Opening checkout preserves cart');
    assert.equal(await page.locator('#checkout-summary .checkout-items li').count(),1,'Only selected products enter checkout');
    await page.locator('[data-coupon-open]').filter({visible:true}).click();
    for(const width of [320,390]) {
      await page.setViewportSize({width,height:844});
      assert.equal(await page.locator('#coupon-modal').evaluate(element=>element.scrollWidth<=element.clientWidth),true,'Coupon dialog has no horizontal overflow');
    }
    await page.screenshot({path:path.join(os.tmpdir(),'ttech-coupon-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('#coupon-code').fill('BAD');
    await page.locator('#coupon-apply').click();
    await page.locator('#coupon-message').filter({hasText:'không tồn tại'}).waitFor();
    assert.equal(consoleErrors.filter(message=>message.includes('400')).length,1,'Invalid coupon returns an expected validation response');
    consoleErrors.length=0;
    await page.locator('#coupon-code').fill('test500');
    await page.locator('#coupon-apply').click();
    await page.waitForFunction(()=>!document.querySelector('#coupon-modal').open);
    await page.locator('#checkout-summary').filter({hasText:'TEST500'}).waitFor();
    await page.reload();
    await page.locator('#checkout-summary').filter({hasText:'TEST500'}).waitFor();
    // An obsolete rejection must not erase a replacement coupon during its quote refresh.
    let rejectOld, releaseNew, oldSeen, newSeen, replacements=0, oldRequests=0;
    const oldReady=new Promise(resolve=>oldSeen=resolve), newReady=new Promise(resolve=>newSeen=resolve);
    const oldGate=new Promise(resolve=>rejectOld=resolve), newGate=new Promise(resolve=>releaseNew=resolve);
    await page.route('**/api/orders/quote',async route=>{
      const body=route.request().postDataJSON();
      if(body.couponCode==='TEST500'&&++oldRequests===2){oldSeen();await oldGate;await route.fulfill({status:400,json:{message:'Mã cũ đã hết hạn.',fields:{couponCode:'Mã cũ đã hết hạn.'}}});return;}
      const response=await route.fetch({url:api+'/api/orders/quote'});
      if(body.couponCode==='TEST100'&&++replacements===2){newSeen();await newGate;}
      await route.fulfill({response});
    });
    try {
      await page.locator('#cart-open').click();
      await page.locator('#cart-modal [data-coupon-open]').click();await oldReady;
      await page.locator('#coupon-code').fill('TEST100');await page.locator('#coupon-apply').click();
      await newReady;rejectOld();await page.waitForTimeout(150);
      assert.equal(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('ttech-checkout-coupon-v1'))?.code),'TEST100');
      releaseNew();await page.locator('#checkout-summary').filter({hasText:'TEST100'}).waitFor();
    } finally {rejectOld();releaseNew();await page.unrouteAll({behavior:'wait'});}
    consoleErrors.length=0; // The delayed 400 above is deliberately injected.
    await page.keyboard.press('Escape');
    await page.locator('[data-coupon-open]').filter({visible:true}).click();
    await page.locator('#coupon-remove').click();
    await page.waitForFunction(()=>!document.querySelector('#coupon-modal').open);
    await page.waitForFunction(()=>!document.querySelector('#checkout-summary').textContent.includes('TEST500'));
    await page.locator('[data-coupon-open]').filter({visible:true}).click();
    await page.locator('[data-coupon-select="TEST500"]').click();
    await page.locator('#checkout-summary').filter({hasText:'TEST500'}).waitFor();
    assert.equal(await page.locator('#place-order').isDisabled(),true);
    await page.locator('#shipping-fullName').fill('');
    await page.locator('#shipping-phone').fill('123');
    await page.locator('#shipping-address').focus();
    assert.equal(await page.locator('#shipping-phone-error').isVisible(),true);
    await page.locator('#checkout-form').evaluate(form => form.requestSubmit());
    assert.equal(await page.evaluate(()=>document.activeElement.id),'shipping-fullName');
    async function fillAddress(){
      for(const [field,value] of Object.entries({fullName:'Người nhận',phone:'0912345678',province:'TP Hồ Chí Minh',district:'Quận 1',ward:'Bến Nghé',address:'123 Đường thử nghiệm'})) await page.locator('#shipping-'+field).fill(value);
    }
    await fillAddress();
    await page.locator('#order-confirm').check();
    assert.equal(await page.locator('#place-order').isDisabled(),true,'Payment selection required');
    await page.locator('[name="paymentMethod"][value="bank"]').check();
    await page.locator('#payment-description').filter({hasText:'MB Bank'}).waitFor();
    await page.locator('[name="paymentMethod"][value="qr"]').check();
    assert.match(await page.locator('#payment-description').innerText(),/QR/);
    await page.locator('[name="paymentMethod"][value="cod"]').check();
    await page.locator('#order-confirm').uncheck();
    assert.equal(await page.locator('#place-order').isDisabled(),true);
    await page.locator('#order-confirm').check();
    assert.equal(await page.locator('#place-order').isEnabled(),true);
    const expected=products.find(p=>String(p.id)==='1').sale_price;
    assert.equal(await page.locator('#checkout-total').innerText(),new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND'}).format(expected-500000));
    await page.locator('#place-order').evaluate(button=>{button.click();button.click()});
    await page.locator('#order-success-title').waitFor();
    assert.equal(await page.locator('#cart-count').innerText(),'1','Unselected product stays in cart');
    let db=(await readStore());
    assert.equal(db.orders.length,1);
    assert.equal(db.orders[0].total,expected-500000);
    assert.equal(db.orders[0].coupon.code,'TEST500');
    assert.equal(db.orders[0].items.length,1);
    await page.locator('#cart-open').click();
    await page.locator('[data-remove="2"]').click();
    await page.keyboard.press('Escape');
    assert.equal(db.orders[0].status,'pending');
    await page.reload();
    await page.locator('#order-success-title').waitFor();
    await page.locator('#view-order').click();
    await page.locator('#order-detail-title').waitFor();
    await page.locator('#all-orders').click();
    await page.locator('.order-history-card').waitFor();
    assert.equal(await page.locator('.order-history-card').count(),1);
    await page.goto(origin+'/#checkout');
    await page.locator('#checkout-empty').waitFor();
    assert.equal(await page.locator('#checkout-form').count(),0);
    await page.goto(origin+'/#products');
    await page.locator('#product-grid [data-add="1"]').click();
    await page.locator('#product-grid [data-add="2"]').click();
    await page.locator('#cart-open').click();
    await page.locator('[data-remove="2"]').click();
    assert.equal(await page.locator('#cart-count').innerText(),'1');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('#product-grid [data-add="2"]').click();
    await page.locator('#cart-open').click();
    await page.locator('#checkout').click();
    await page.locator('#checkout-form').waitFor();
    await fillAddress();
    await page.locator('[name="paymentMethod"][value="cod"]').check();
    await page.locator('#order-confirm').check();
    for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No overflow at '+width)}
    await page.setViewportSize({width:1440,height:1000});
    await page.evaluate(() => { document.activeElement.blur(); scrollTo({top:0,behavior:'instant'}); });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({path:'docs/ui-reference/ttech-checkout-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => { document.activeElement.blur(); scrollTo({top:0,behavior:'instant'}); });
    await page.screenshot({path:'docs/ui-reference/ttech-checkout-mobile.png',fullPage:true});
    assert.deepEqual(consoleErrors, [], 'No console errors during normal checkout');
    // Simulate a lost response after the server committed. Retry must recover one order.
    let drop=true;
    await page.route('**/api/orders',async route=>{
      if(route.request().method()==='POST' && drop){drop=false;await route.fetch({url:api+'/api/orders'});
        await page.evaluate(() => { const key='cyber-core-db-cart-v1'; localStorage.setItem(key,JSON.stringify([{id:'1',qty:2},{id:'2',qty:1},{id:'3',qty:1}])); window.dispatchEvent(new StorageEvent('storage',{key})); });
        return route.abort()}
      return route.fallback();
    });
    await page.locator('#place-order').click();
    await page.locator('#checkout-message').filter({hasText:'thử lại'}).waitFor();
    assert.equal(await page.locator('#cart-count').innerText(),'4','Failed response must not clear cart');
    const retryState=await page.evaluate(()=>sessionStorage.getItem('ttech-checkout-pending-v1'));
    const duplicate=await context.newPage();
    await duplicate.addInitScript(value=>sessionStorage.setItem('ttech-checkout-pending-v1',value),retryState);
    await Promise.all([page.reload(),duplicate.goto(origin+'/#checkout')]);
    await page.locator('#order-success-title').waitFor();
    await duplicate.locator('#order-success-title').waitFor();
    await duplicate.close();
    db=(await readStore());
    assert.equal(db.orders.length,2,'Recovery must not create duplicate order');
    assert.equal(await page.locator('#cart-count').innerText(),'2','Keep quantities and products added while placing order');
    // Route B must not be dropped while the authorization callback for route A waits.
    let quoteCaptured, releaseQuote;
    const gotQuote=new Promise(r=>quoteCaptured=r), quoteReleased=new Promise(r=>releaseQuote=r);
    await page.route('**/api/orders/quote',async route=>{const response=await route.fetch({url:api+'/api/orders/quote'});quoteCaptured();await quoteReleased;await route.fulfill({response})});
    try {
      await page.goto(origin+'/#checkout'); await gotQuote;
      await page.goto(origin+'/#orders');
      await page.locator('.order-history-card').first().waitFor({timeout:3000});
    } finally { releaseQuote(); await page.unroute('**/api/orders/quote'); }
    // An obsolete submission must not unlock the form owned by a newer route.
    let releaseA, releaseB, gotA, gotB, count=0;
    const aSeen=new Promise(r=>gotA=r), bSeen=new Promise(r=>gotB=r);
    const aWait=new Promise(r=>releaseA=r), bWait=new Promise(r=>releaseB=r);
    await page.route('**/api/orders',async route=>{
      if(route.request().method()!=='POST') return route.fallback();
      if(++count===1){gotA();await aWait;return route.fulfill({status:503,json:{message:'Retry'}})}
      gotB();await bWait;return route.fallback();
    });
    try {
      for(let attempt=0;attempt<2;attempt++){
        if(attempt) await page.goto(origin+'/#orders');
        await page.goto(origin+'/#checkout');await page.locator('#checkout-form').waitFor();
        await fillAddress();await page.locator('[name="paymentMethod"][value="cod"]').check();await page.locator('#order-confirm').check();await page.locator('#place-order').click();
        await (attempt?bSeen:aSeen);
      }
      releaseA();await page.waitForTimeout(100);
      await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'cyber-core-db-cart-v1'})));
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#place-order').isDisabled(),true,'New submission stays locked after old request completes');
      assert.equal(await page.locator('#order-confirm').isChecked(),true,'Obsolete request must not trigger a quote refresh during new submission');
      releaseB();await page.locator('#order-success-title').waitFor();
    } finally { releaseA();releaseB();await page.unroute('**/api/orders'); }
    // A delayed order-history response must not reveal private details after logout.
    let captured, release;
    const gotHistory=new Promise(r=>captured=r), releaseHistory=new Promise(r=>release=r);
    await page.route('**/api/orders', async route=>{const response=await route.fetch({url:api+'/api/orders'});captured();await releaseHistory;await route.fulfill({response})});
    await page.goto(origin+'/#orders');
    await gotHistory;
    const other=await context.newPage();await other.goto(origin);
    await other.waitForFunction(()=>document.querySelector('#account-name').textContent.includes('Người nhận'));
    await other.locator('#auth-open').click();await other.locator('#account-logout').click();
    await page.getByRole('heading',{name:'Vui lòng đăng nhập để xem đơn hàng của bạn.'}).waitFor();
    release();
    await page.waitForTimeout(150);
    assert.equal(await page.locator('.order-history-card').count(),0);
    assert.equal(await page.locator('#commerce-view').innerText().then(t=>t.includes('123 Đường thử nghiệm')),false);
    assert.deepEqual(runtimeErrors,[]);
    assert.deepEqual((await readStore()).products,products);
    assert.deepEqual(await fs.readFile(path.resolve(__dirname,'../../Backend/db.json')),original);
    console.log('PASS: cart quantity/remove/persist, protected checkout, field/payment/confirmation validation, canonical totals, double-submit, success/detail/history/reload, empty cart, lost-response recovery, 320–1440px, unchanged real database.');
  } finally {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) await page.unrouteAll({behavior:'ignoreErrors'});
      await context.unrouteAll({behavior:'ignoreErrors'});
    }
    await browser.close();
    await Promise.all([new Promise(r=>backend.close(r)),new Promise(r=>staticServer.close(r))]);
    assert.equal(path.dirname(directory),os.tmpdir());await fs.rm(directory,{recursive:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1});
