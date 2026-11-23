const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { createServer } = require('../../Backend/server.cjs');
const { openJsonDatabase } = require('../../Backend/json-storage.cjs');

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
  const webhookSecret=randomBytes(32).toString('hex');
  const backend = await createServer({ dbPath, payments:{enabled:true, secret:webhookSecret}, origins: [origin], rateLimitMax: 100 });
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


    await context.route('https://vietqr.app/**',route=>route.abort());
    const email='bank@example.com';
    await fetch(api+'/api/auth/register',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({name:'Bank Tester',email,password:secret,confirm:secret})});
    await page.goto(origin+'/#products');
    await page.locator('#product-grid [data-add="1"]').click();await page.locator('#cart-open').click();await page.locator('#checkout').click();
    await page.locator('#auth-email').fill(email);await page.locator('#auth-password').fill(secret);await page.locator('#auth-submit').click();
    await page.locator('#checkout-form').waitFor();
    for(const [field,value] of Object.entries({fullName:'Bank Tester',phone:'0912345678',province:'HCM',district:'Q1',ward:'P1',address:'123 Street'}))await page.locator('#shipping-'+field).fill(value);
    await page.locator('[name="paymentMethod"][value="bank"]').check();
    await page.locator('#sender-bank').selectOption('VCB');
    await page.locator('#order-confirm').check();await page.locator('#place-order').click();
    await page.locator('#order-payment').filter({hasText:'0911236639'}).waitFor();
    assert.match(await page.locator('#payment-status').innerText(),/Chờ thanh toán/);
    await page.locator('#qr-error').waitFor();
    const order=(await readStore()).orders[0];assert.equal(order.senderBank,'VCB');assert.equal(order.payment.accountNumber,'0911236639');
    await page.reload();await page.locator('#payment-status').filter({hasText:'Chờ thanh toán'}).waitFor();
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}})});
    await page.locator('[data-payment-copy="accountNumber"]').click();await page.locator('#payment-feedback').filter({hasText:'Không thể sao chép'}).waitFor();
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copied=value}}})});
    await page.locator('[data-payment-copy="accountNumber"]').click();assert.equal(await page.evaluate(()=>window.copied),'0911236639');
    for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
    await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.screenshot({path:'docs/ui-reference/ttech-bank-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});await page.screenshot({path:'docs/ui-reference/ttech-bank-desktop.png',fullPage:true});
    // The browser never calls a customer paid endpoint; only a signed backend receipt can change state.
    const payload={id:90001,gateway:'MBBank',accountNumber:'0911236639',transactionDate:'2026-10-09 12:00:00',content:order.payment.transferContent,transferType:'in',transferAmount:order.total,referenceCode:'UI-FIXTURE-1'};
    const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify(payload);
    const signature=require('node:crypto').createHmac('sha256',webhookSecret).update(timestamp+'.'+raw).digest('hex');
    const received=await fetch(api+'/api/webhooks/sepay',{method:'POST',headers:{'Content-Type':'application/json','X-SePay-Timestamp':timestamp,'X-SePay-Signature':'sha256='+signature},body:raw});assert.equal(received.status,200);
    await page.locator('[data-payment-refresh]').click();await page.locator('#payment-status').filter({hasText:'Đã thanh toán'}).waitFor();assert.equal(await page.locator('#payment-qr').count(),0);
    await openJsonDatabase(dbPath).update(data=>{data.users[0].role='admin'});
    await page.reload();await page.locator('#auth-open').click();await page.locator('#account-admin').click();await page.locator('#payment-admin-load').click();await page.locator('.payment-receipt').waitFor();
    assert.match(await page.locator('#payment-admin-results').innerText(),/90001/);
    await page.locator('#payment-admin-filter').selectOption('unpaid');assert.equal(await page.locator('.payment-receipt').count(),0);
    assert.deepEqual(runtimeErrors,[]);assert.deepEqual(await fs.readFile(path.resolve(__dirname,'../../Backend/db.json')),original);
    console.log('PASS: bank checkout, sender selection, canonical receiver, reload, copy feedback, QR outage, signed receipt/status, admin, mobile, no runtime errors.');
  } finally {await browser.close();await new Promise(r=>backend.close(r));await new Promise(r=>staticServer.close(r));await fs.rm(directory,{recursive:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
