'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } = require('node:crypto');
const { promisify } = require('node:util');
const deriveKey = promisify(scrypt);
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const COOKIE = 'ttech_session';
const DEFAULT_ORIGINS = ['http://127.0.0.1:5501', 'http://localhost:5501', 'http://127.0.0.1:8000', 'http://localhost:8000'];
const digest = token => createHash('sha256').update(token).digest('hex');
const normalizeEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

class ApiError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

function database(dbPath) {
  let pending = Promise.resolve();
  async function read() {
    const data = JSON.parse(await fs.readFile(dbPath, 'utf8'));
    if (!Array.isArray(data.products)) throw new Error('Database products collection is invalid');
    for (const key of ['users', 'authSessions', 'orders']) {
      if (data[key] === undefined) data[key] = [];
      if (!Array.isArray(data[key])) throw new Error(`Database ${key} collection is invalid`);
    }
    return data;
  }
  function update(mutator) {
    const result = pending.then(async () => {
      // Share an exclusive write lock with CLI/other processes, not just this queue.
      const lockPath = dbPath + '.lock';
      let lock;
      try { lock = await fs.open(lockPath, 'wx', 0o600); }
      catch (error) {
        if (error.code === 'EEXIST') throw new ApiError(503, 'Dữ liệu đang được cập nhật. Vui lòng thử lại.');
        throw error;
      }
      const temporary = dbPath + '.' + randomUUID() + '.tmp';
      try {
        const data = await read();
        const value = await mutator(data);
        await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, dbPath);
        return value;
      } finally {
        await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') console.error('Temporary database cleanup failed:', error.code); });
        await lock.close();
        await fs.unlink(lockPath);
      }
    });
    // The caller receives failures; a failed write must not poison later transactions.
    pending = result.catch(() => undefined);
    return result;
  }
  return { read, update };
}

function publicUser(user) {
  const { id, name, email, phone, role, status, createdAt } = user;
  return { id, name, email, ...(phone ? { phone } : {}), role, status, createdAt };
}

async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64, SCRYPT);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (typeof encoded !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)) return false;
  const [, salt, hash] = encoded.split('$');
  const key = await deriveKey(password, salt, 64, SCRYPT);
  return timingSafeEqual(key, Buffer.from(hash, 'hex'));
}

function validateCredentials(body, register) {
  const email = normalizeEmail(body.email), fields = {};
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'Email không hợp lệ.';
  if (password.length < 8 || password.length > 128) fields.password = 'Mật khẩu phải có từ 8 đến 128 ký tự.';
  if (register && (!name || name.length > 80)) fields.name = 'Vui lòng nhập họ tên, tối đa 80 ký tự.';
  if (register && body.confirm !== password) fields.confirm = 'Mật khẩu xác nhận không khớp.';
  if (['role', 'status', 'id', 'passwordHash'].some(key => Object.hasOwn(body, key))) throw new ApiError(400, 'Dữ liệu tài khoản không hợp lệ.');
  if (Object.keys(fields).length) throw new ApiError(400, 'Vui lòng kiểm tra thông tin đã nhập.', fields);
  return { name, email, password };
}

async function readBody(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new ApiError(415, 'Định dạng yêu cầu không hợp lệ.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'Dữ liệu gửi quá lớn.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Object required');
    return data;
  } catch { throw new ApiError(400, 'Dữ liệu gửi không hợp lệ.'); }
}

function sessionToken(request) {
  const value = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='));
  const token = value?.slice(COOKIE.length + 1) || '';
  return /^[a-f0-9]{64}$/.test(token) ? token : '';
}

function currentUser(data, request) {
  const token = sessionToken(request);
  const session = token && data.authSessions.find(item => item.tokenHash === digest(token) && Date.parse(item.expiresAt) > Date.now());
  const user = session && data.users.find(item => String(item.id) === String(session.userId));
  if (!user || user.status !== 'active') throw new ApiError(401, 'Vui lòng đăng nhập để tiếp tục.');
  return user;
}

function requireAdmin(data, request) {
  const user = currentUser(data, request);
  if (user.role !== 'admin') throw new ApiError(403, 'Bạn không có quyền truy cập chức năng này.');
  return user;
}

function createLimiter(maximum) {
  const attempts = new Map();
  return (request, response) => {
    const now = Date.now(), key = request.socket.remoteAddress;
    for (const [ip, entry] of attempts) if (entry.until <= now) attempts.delete(ip);
    const entry = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= maximum || attempts.size > 2000) {
      response.setHeader('Retry-After', String(Math.ceil((entry.until - now) / 1000)));
      throw new ApiError(429, 'Bạn thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.');
    }
    entry.count++;
    attempts.set(key, entry);
  };
}

async function createServer(options = {}) {
  const dbPath = path.resolve(options.dbPath || process.env.TTECH_DB_PATH || path.join(__dirname, 'db.json'));
  const sqlitePath = options.sqlitePath || process.env.TTECH_SQLITE_PATH || (!options.dbPath && !process.env.TTECH_DB_PATH ? path.join(__dirname, 'ttech.sqlite') : null);
  const paymentConfig = require('./payments.cjs').configuration(options.payments);
  if (paymentConfig.enabled && !sqlitePath) throw new Error('Bank payments require a verified SQLite migration');
  const db = sqlitePath ? require('./storage.cjs').openDatabase(path.resolve(sqlitePath)) : database(dbPath);
  const origins = new Set(options.origins || process.env.FRONTEND_ORIGINS?.split(',').map(value => value.trim()) || DEFAULT_ORIGINS);
  const sessionTtlMs = options.sessionTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const limit = createLimiter(options.rateLimitMax ?? 20);
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const initial = db.kind === 'sqlite' ? await db.read() : JSON.parse(await fs.readFile(dbPath, 'utf8'));
  await db.read();
  if (!initial.users || !initial.authSessions || !initial.orders) await db.update(() => undefined);

  function cookie(response, token = '') {
    response.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${token ? Math.max(1, Math.floor(sessionTtlMs / 1000)) : 0}${secure ? '; Secure' : ''}`);
  }
  function send(response, status, data) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(data));
  }
  function cors(request, response) {
    const origin = request.headers.origin;
    if (origin && !origins.has(origin)) throw new ApiError(403, 'Nguồn truy cập không được phép.');
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Vary', 'Origin');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !origin) throw new ApiError(403, 'Nguồn truy cập không được phép.');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }

  async function register(body, response) {
    const input = validateCredentials(body, true);
    const passwordHash = await hashPassword(input.password);
    const user = await db.update(data => {
      if (data.users.some(user => normalizeEmail(user.email) === input.email)) throw new ApiError(409, 'Email này đã được đăng ký.', { email: 'Email này đã được đăng ký.' });
      const user = { id: randomUUID(), name: input.name, email: input.email, passwordHash, role: 'user', status: 'active', createdAt: new Date().toISOString() };
      data.users.push(user);
      return publicUser(user);
    });
    send(response, 201, { user, message: 'Đăng ký thành công. Bạn có thể đăng nhập ngay.' });
  }

  async function login(body, request, response) {
    const input = validateCredentials(body, false);
    const data = await db.read();
    const found = data.users.find(user => normalizeEmail(user.email) === input.email);
    const valid = await verifyPassword(input.password, found?.passwordHash || dummyHash);
    if (!valid || !found || found.status !== 'active') throw new ApiError(401, 'Email hoặc mật khẩu không chính xác.');
    const token = randomBytes(32).toString('hex'), oldToken = sessionToken(request);
    const user = await db.update(data => {
      const user = data.users.find(user => user.id === found.id);
      if (!user || user.status !== 'active' || user.passwordHash !== found.passwordHash) throw new ApiError(401, 'Email hoặc mật khẩu không chính xác.');
      data.authSessions = data.authSessions.filter(s => Date.parse(s.expiresAt) > Date.now() && (!oldToken || s.tokenHash !== digest(oldToken)));
      // Bound saved sessions per account without exposing tokens in API responses.
      const own = data.authSessions.filter(s => s.userId === user.id);
      if (own.length >= 10) data.authSessions = data.authSessions.filter(s => !own.slice(0, own.length - 9).includes(s));
      data.authSessions.push({ tokenHash: digest(token), userId: user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + sessionTtlMs).toISOString() });
      return publicUser(user);
    });
    cookie(response, token);
    send(response, 200, { user });
  }

  const payments = require('./payments.cjs')({ db, currentUser, requireAdmin, send, readBody, ApiError, config: paymentConfig });
  const promotionConfig = options.promotions ?? JSON.parse(await fs.readFile(path.join(__dirname, 'promotions.json'), 'utf8'));
  const promotions = require('./promotions.cjs')(promotionConfig, ApiError);
  const handleOrders = require('./orders.cjs')({ db, currentUser, send, readBody, ApiError, payments, promotions });

  async function route(request, response) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (await payments.handle(request, response, pathname)) return;
    if (await handleOrders(request, response, pathname)) return;
    if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { service: 'ttech-auth', ok: true });
    if (request.method === 'GET' && /^\/products(?:\/[^/]+)?$/.test(pathname)) {
      const { products } = await db.read();
      const product = pathname === '/products' ? products : products.find(p => String(p.id) === decodeURIComponent(pathname.slice(10)));
      if (!product) throw new ApiError(404, 'Không tìm thấy sản phẩm.');
      return send(response, 200, product);
    }
    if (request.method === 'GET' && pathname === '/api/auth/me') {
      return send(response, 200, { user: publicUser(currentUser(await db.read(), request)) });
    }
    if (request.method === 'GET' && pathname === '/api/auth/session') {
      const data = await db.read();
      try { return send(response, 200, { user: publicUser(currentUser(data, request)) }); }
      catch (error) {
        if (error.status !== 401) throw error;
        return send(response, 200, { user: null });
      }
    }
    if (request.method === 'GET' && pathname === '/api/admin/summary') {
      const data = await db.read(); requireAdmin(data, request);
      return send(response, 200, { productCount: data.products.length, userCount: data.users.length });
    }
    if (request.method === 'POST' && ['/api/auth/register', '/api/auth/login', '/api/auth/logout'].includes(pathname)) {
      if (pathname !== '/api/auth/logout') limit(request, response);
      const body = await readBody(request);
      if (pathname.endsWith('/register')) return register(body, response);
      if (pathname.endsWith('/login')) return login(body, request, response);
      const token = sessionToken(request);
      if (token) await db.update(data => { data.authSessions = data.authSessions.filter(s => s.tokenHash !== digest(token) && Date.parse(s.expiresAt) > Date.now()); });
      cookie(response);
      return send(response, 200, { message: 'Đăng xuất thành công.' });
    }
    if (pathname.startsWith('/products') && !['GET', 'HEAD'].includes(request.method)) {
      requireAdmin(await db.read(), request);
      throw new ApiError(405, 'Chức năng cập nhật sản phẩm chưa được mở.');
    }
    throw new ApiError(404, 'Không tìm thấy chức năng yêu cầu.');
  }

  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api/webhooks/sepay') await payments.webhook(request, response);
      else { cors(request, response); await route(request, response); }
    }
    catch (error) {
      if (!(error instanceof ApiError)) console.error('API request failed:', error.code || error.name);
      if (!response.headersSent && !response.destroyed) send(response, error.status || 500, {
        message: error instanceof ApiError ? error.message : 'Máy chủ đang gặp sự cố. Vui lòng thử lại.',
        ...(error.fields ? { fields: error.fields } : {})
      });
    }
  });
  server.on('close', () => db.close?.());
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (require.main === module) {
  (async () => {
    const envFile = path.join(__dirname, '.env');
    if (require('node:fs').existsSync(envFile)) process.loadEnvFile(envFile);
    if (process.argv[2] === '--promote') {
      const email = normalizeEmail(process.argv[3]);
      if (!email) throw new Error('Usage: node server.cjs --promote registered-email');
      const db = process.env.TTECH_DB_PATH && !process.env.TTECH_SQLITE_PATH ? database(path.resolve(process.env.TTECH_DB_PATH)) : require('./storage.cjs').openDatabase(path.resolve(process.env.TTECH_SQLITE_PATH || path.join(__dirname, 'ttech.sqlite')));
      await db.update(data => {
        const user = data.users.find(user => normalizeEmail(user.email) === email && user.status === 'active');
        if (!user) throw new Error('Register an active account before promoting it');
        user.role = 'admin';
      });
      db.close?.();
      console.log('Admin role assigned to the existing account.');
      return;
    }
    const server = await createServer();
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Port 3000 is occupied. Stop JSON Server before starting T-TECH backend.' : error.message); process.exitCode = 1; });
    server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('T-TECH backend ready on port ' + server.address().port));
  })().catch(error => { console.error('Cannot start T-TECH:', error.message); process.exitCode = 1; });
}

module.exports = { createServer };
