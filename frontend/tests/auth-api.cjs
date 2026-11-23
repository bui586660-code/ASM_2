const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const backend = path.resolve(__dirname, '../../Backend/server.cjs');
const origin = 'http://127.0.0.1:5501';
const products = [{ id: 1, name: 'Laptop fixture', price: 20000000, cpu: 'Fixture CPU' }];
const password = () => randomBytes(18).toString('base64url');

async function fixture(t, options = {}) {
  await assert.doesNotReject(fs.access(backend), 'A real authentication server must exist');
  const { createServer } = require(backend);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttech-auth-'));
  const dbPath = path.join(directory, 'db.json');
  await fs.writeFile(dbPath, JSON.stringify({ products, customCollection: [{ untouched: true }] }));
  let server;
  async function start() {
    server = await createServer({ dbPath, origins: [origin], rateLimitMax: 100, ...options });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  }
  await start();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(directory), os.tmpdir());
    await fs.rm(directory, { recursive: true });
  });
  async function request(route, method = 'GET', data, cookie, customHeaders = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method, headers: { Origin: origin, ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...customHeaders },
      body: data === undefined ? undefined : JSON.stringify(data)
    });
    return { status: response.status, data: response.status === 204 ? null : await response.json(), headers: response.headers,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return { request, dbPath, read: async () => JSON.parse(await fs.readFile(dbPath, 'utf8')),
    restart: async () => { await new Promise(resolve => server.close(resolve)); await start(); } };
}

test('registration normalizes email, hashes passwords, and preserves existing collections', async t => {
  const f = await fixture(t), secret = password();
  const response = await f.request('/api/auth/register', 'POST', { name: '  Người kiểm tra  ', email: ' Test@EXAMPLE.COM ', password: secret, confirm: secret });
  assert.equal(response.status, 201);
  assert.equal(response.data.user.email, 'test@example.com');
  assert.equal(response.data.user.name, 'Người kiểm tra');
  assert.equal(response.data.user.role, 'user');
  assert.equal(response.data.user.status, 'active');
  const db = await f.read();
  assert.deepEqual(db.products, products);
  assert.deepEqual(db.customCollection, [{ untouched: true }]);
  assert.match(db.users[0].passwordHash, /^scrypt\$/);
  assert.ok(!JSON.stringify(db).includes(secret));
  assert.ok(!JSON.stringify(response.data).includes('password'));
});

test('registration rejects invalid fields and client-controlled privileges', async t => {
  const f = await fixture(t), secret = password();
  const valid = { name: 'Test', email: 'test@example.com', password: secret, confirm: secret };
  for (const bad of [{ name: '   ' }, { email: 'not-email' }, { password: 'short', confirm: 'short' }, { password: '        ', confirm: '        ' }, { confirm: 'different' }, { role: 'admin' }, { status: 'active' }, { isAdmin: true }, { emailVerified: true }]) {
    const response = await f.request('/api/auth/register', 'POST', { ...valid, ...bad });
    assert.equal(response.status, 400);
  }
  assert.equal((await f.read()).users.length, 0);
});

test('profile updates only the session owner, persists and never exposes credentials', async t => {
  const f = await fixture(t), secret = password();
  for (const email of ['owner@example.com', 'other@example.com']) await f.request('/api/auth/register', 'POST', {name:'Profile User',email,password:secret,confirm:secret});
  const login = await f.request('/api/auth/login', 'POST', {email:'owner@example.com',password:secret});
  const before = await f.read();
  const changes = {name:'  Updated   Name  ',phone:'0912345678',birthday:'2000-02-29',gender:'other',address:'  123 Test Street  '};
  const saved = await f.request('/api/auth/me', 'PATCH', changes, login.cookie);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.user.name, 'Updated Name');
  assert.equal(saved.data.user.address, '123 Test Street');
  assert.equal(saved.data.user.birthday, changes.birthday);
  assert.equal(saved.data.user.emailVerified, false);
  assert.ok(!JSON.stringify(saved.data).includes('password'));
  assert.deepEqual((await f.read()).users[1], before.users[1]);
  assert.deepEqual((await f.read()).products, before.products);
  await f.restart();
  const me = await f.request('/api/auth/me', 'GET', undefined, login.cookie);
  assert.deepEqual(me.data.user, saved.data.user);
  const cleared = await f.request('/api/auth/me', 'PATCH', {phone:'',birthday:'',gender:'',address:''}, login.cookie);
  assert.equal(cleared.status, 200);
  assert.equal(cleared.data.user.name, 'Updated Name');
  assert.equal(cleared.data.user.phone || '', '');
  await f.request('/api/auth/logout','POST',{},login.cookie);
  assert.equal((await f.request('/api/auth/me','PATCH',{name:'Guest'},login.cookie)).status,401);
});

test('profile rejects invalid values, identity changes and privilege escalation atomically', async t => {
  const f=await fixture(t),secret=password();
  await f.request('/api/auth/register','POST',{name:'Owner',email:'owner@example.com',password:secret,confirm:secret});
  const login=await f.request('/api/auth/login','POST',{email:'owner@example.com',password:secret});
  const before=await f.read();
  assert.equal((await f.request('/api/auth/me','GET')).status,401);
  assert.equal((await f.request('/api/auth/me','PATCH',{name:'Guest'})).status,401);
  for(const changes of [{},{name:' '},{name:12},{name:'x'.repeat(81)},{phone:'abc'},{phone:{}},{birthday:'2001-02-29'},{birthday:'2999-01-01'},{gender:'admin'},{address:[]},{address:'x'.repeat(501)},
    {role:'admin'},{isAdmin:true},{id:'other'},{userId:'other'},{email:'other@example.com'},{status:'active'},{emailVerified:true},{passwordHash:'fake'},{password:'replacement'}]){
    const response=await f.request('/api/auth/me','PATCH',changes,login.cookie);
    assert.equal(response.status,400,JSON.stringify(changes));
  }
  assert.deepEqual(await f.read(),before,'Rejected updates must not mutate any data');
  const preflight=await f.request('/api/auth/me','OPTIONS',undefined,undefined,{'Access-Control-Request-Method':'PATCH'});
  assert.equal(preflight.status,204);
  assert.match(preflight.headers.get('access-control-allow-methods'),/PATCH/);
  assert.equal((await f.request('/api/auth/me','PATCH',{name:'Untrusted'},login.cookie,{Origin:'https://untrusted.example'})).status,403);
  await fs.writeFile(f.dbPath+'.lock','fixture');
  assert.equal((await f.request('/api/auth/me','PATCH',{name:'Not saved'},login.cookie)).status,503);
  await fs.unlink(f.dbPath+'.lock');
  assert.deepEqual(await f.read(),before);
});

test('profile fields persist with the JSON store and survive restart', async t => {
  const f=await fixture(t),secret=password();
  await f.request('/api/auth/register','POST',{name:'JSON User',email:'json@example.com',password:secret,confirm:secret});
  const login=await f.request('/api/auth/login','POST',{email:'json@example.com',password:secret});
  const changed=await f.request('/api/auth/me','PATCH',{name:'SQLite Updated',address:'Address fixture',birthday:'1999-10-19'},login.cookie);
  assert.equal(changed.status,200);
  await f.restart();
  const result=await f.request('/api/auth/me','GET',undefined,login.cookie);
  assert.equal(result.status,200);
  assert.deepEqual(result.data.user,changed.data.user);
  assert.deepEqual((await f.request('/products')).data,products);
});

test('case-insensitive duplicate email is rejected, including concurrent registrations', async t => {
  const f = await fixture(t), secret = password();
  const payload = { name: 'Test', email: 'test@example.com', password: secret, confirm: secret };
  const results = await Promise.all([f.request('/api/auth/register', 'POST', payload), f.request('/api/auth/register', 'POST', { ...payload, email: 'TEST@EXAMPLE.COM' })]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  assert.equal((await f.read()).users.length, 1);
});

test('login issues HttpOnly session, persists over restart, logout revokes it', async t => {
  const f = await fixture(t), secret = password();
  await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
  const logged = await f.request('/api/auth/login', 'POST', { email: 'TEST@example.com', password: secret });
  assert.equal(logged.status, 200);
  assert.match(logged.headers.get('set-cookie'), /HttpOnly/);
  assert.match(logged.headers.get('set-cookie'), /SameSite=Strict/);
  assert.match(logged.headers.get('set-cookie'), /Max-Age=/);
  assert.equal(logged.headers.get('access-control-allow-origin'), origin);
  assert.equal(logged.headers.get('access-control-allow-credentials'), 'true');
  assert.ok(!JSON.stringify(await f.read()).includes(logged.cookie.split('=')[1]));
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, logged.cookie)).data.user.email, 'test@example.com');
  await f.restart();
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, logged.cookie)).status, 200);
  assert.equal((await f.request('/api/auth/logout', 'POST', {}, logged.cookie)).status, 200);
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, logged.cookie)).status, 401);
});

test('wrong password, unknown email and disabled account have the same login error', async t => {
  const f = await fixture(t), secret = password();
  await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
  const wrong = await f.request('/api/auth/login', 'POST', { email: 'test@example.com', password: password() });
  const unknown = await f.request('/api/auth/login', 'POST', { email: 'absent@example.com', password: secret });
  const db = await f.read(); db.users[0].status = 'disabled'; await fs.writeFile(f.dbPath, JSON.stringify(db));
  const disabled = await f.request('/api/auth/login', 'POST', { email: 'test@example.com', password: secret });
  for (const response of [wrong, unknown, disabled]) {
    assert.equal(response.status, 401);
    assert.equal(response.data.message, 'Email hoặc mật khẩu không chính xác.');
  }
});

test('server enforces role and current account status; private collections cannot be read', async t => {
  const f = await fixture(t), secret = password();
  for (const route of ['/users', '/authSessions', '/db.json', '/Backend/db.json']) assert.equal((await f.request(route)).status, 404);
  assert.equal((await f.request('/api/auth/me')).status, 401);
  assert.equal((await f.request('/api/admin/summary')).status, 401);
  await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
  const { cookie } = await f.request('/api/auth/login', 'POST', { email: 'test@example.com', password: secret });
  assert.equal((await f.request('/api/admin/summary', 'GET', undefined, cookie)).status, 403);
  let db = await f.read(); db.users[0].role = 'admin'; await fs.writeFile(f.dbPath, JSON.stringify(db));
  const admin = await f.request('/api/admin/summary', 'GET', undefined, cookie);
  assert.equal(admin.status, 200);
  assert.equal(admin.data.productCount, 1);
  db = await f.read(); db.users[0].status = 'disabled'; await fs.writeFile(f.dbPath, JSON.stringify(db));
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, cookie)).status, 401);
});

test('sessions expire and old login cookie is rotated', async t => {
  const f = await fixture(t, { sessionTtlMs: 100 }), secret = password();
  await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
  const first = await f.request('/api/auth/login', 'POST', { email: 'test@example.com', password: secret });
  const second = await f.request('/api/auth/login', 'POST', { email: 'test@example.com', password: secret }, first.cookie);
  assert.notEqual(first.cookie, second.cookie);
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, first.cookie)).status, 401);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal((await f.request('/api/auth/me', 'GET', undefined, second.cookie)).status, 401);
});

test('auth rejects untrusted origins and throttles repeated attempts', async t => {
  const f = await fixture(t, { rateLimitMax: 2 });
  assert.equal((await f.request('/api/auth/login', 'POST', {}, undefined, { Origin: 'https://untrusted.example' })).status, 403);
  for (let i = 0; i < 2; i++) await f.request('/api/auth/login', 'POST', {});
  const limited = await f.request('/api/auth/login', 'POST', {});
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('products remain public and product writes require admin', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/products')).data, products);
  assert.deepEqual((await f.request('/products/1')).data, products[0]);
  assert.equal((await f.request('/products', 'POST', { name: 'Unauthorized' })).status, 401);
});


test('database write lock prevents another process from overwriting users or sessions', async t => {
  const f = await fixture(t), secret = password();
  const before = await fs.readFile(f.dbPath, 'utf8');
  const lockPath = f.dbPath + '.lock';
  await fs.writeFile(lockPath, 'other writer', { flag: 'wx' });
  try {
    const rejected = await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
    assert.equal(rejected.status, 503);
    assert.equal(await fs.readFile(f.dbPath, 'utf8'), before);
  } finally { await fs.unlink(lockPath); }
  const accepted = await f.request('/api/auth/register', 'POST', { name: 'Test', email: 'test@example.com', password: secret, confirm: secret });
  assert.equal(accepted.status, 201);
  await assert.rejects(fs.access(lockPath), { code: 'ENOENT' });
});

test('guest session, payload format and server errors return safe responses', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.request('/api/auth/session')).data, { user: null });
  assert.equal((await f.request('/api/auth/register', 'POST', [], undefined)).status, 400);
  assert.equal((await f.request('/api/auth/register', 'POST', {}, undefined, { 'Content-Type': 'text/plain' })).status, 415);
  const before = await fs.readFile(f.dbPath, 'utf8');
  try {
    await fs.writeFile(f.dbPath, '{invalid');
    const response = await f.request('/api/auth/session');
    assert.equal(response.status, 500);
    assert.doesNotMatch(JSON.stringify(response.data), /SyntaxError|JSON.parse|db.json|ENOENT/);
  } finally { await fs.writeFile(f.dbPath, before); }
});
