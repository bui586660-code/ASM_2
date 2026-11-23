const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/auth.js'), 'utf8');
const invalidMessage = 'Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.';
const networkMessage = 'Không thể kết nối máy chủ. Vui lòng thử lại.';
const timeoutMessage = 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.';

// Run the existing browser helper without UI initialization or a live database.
function client(fetch) {
  let timeout, cleared = 0;
  const context = vm.createContext({
    document: { querySelector() { throw new Error('Request must not touch the UI'); } },
    location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1:5501' },
    window: {}, AbortController, DOMException, fetch,
    setTimeout(callback, delay) { assert.equal(delay, 8000); timeout = callback; return 1; },
    clearTimeout() { cleared++; }
  });
  vm.runInContext(source, context);
  return { request: context.window.TTechAuth.request, expire: () => timeout(), cleared: () => cleared };
}

test('request preserves URL, JSON body, credentials and reads a valid response once', async () => {
  let reads = 0;
  const api = client(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3000/api/auth/login');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { email: 'fixture@example.com', password: 'fixture-only' });
    const response = new Response('{"user":{"id":"fixture"}}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    const text = response.text.bind(response);
    response.text = () => { reads++; return text(); };
    const json = response.json.bind(response);
    response.json = () => { reads++; return json(); };
    return response;
  });
  const data = await api.request('/auth/login', { method: 'POST', body: { email: 'fixture@example.com', password: 'fixture-only' } });
  assert.equal(data.user.id, 'fixture');
  assert.equal(reads, 1);
  assert.equal(api.cleared(), 1);
});

test('valid business errors retain their HTTP status, message and field errors', async () => {
  const api = client(async () => new Response(JSON.stringify({ message: 'Mã không khả dụng.', fields: { couponCode: 'expired' } }), {
    status: 409, headers: { 'Content-Type': 'application/json' }
  }));
  await assert.rejects(api.request('/orders/quote'), error => {
    assert.equal(error.status, 409);
    assert.equal(error.message, 'Mã không khả dụng.');
    assert.equal(error.fields.couponCode, 'expired');
    return true;
  });
});

test('malformed and empty HTTP error bodies retain status for session/order recovery', async () => {
  for (const status of [401, 409, 500]) {
    for (const body of ['{broken', '', 'null', '[]']) {
      const api = client(async () => new Response(body, { status, headers: { 'Content-Type': 'application/json' } }));
      await assert.rejects(api.request('/orders'), error => error.status === status && error.message === invalidMessage);
    }
  }
});

test('non-JSON and bodyless responses are rejected without trying to parse JSON', async () => {
  for (const [status, contentType, body] of [[200, 'text/html', '<html>Offline</html>'], [503, 'text/html', 'Unavailable'], [204, 'application/json', null], [205, 'application/json', null]]) {
    let reads = 0;
    const api = client(async () => {
      const response = new Response(body, { status, headers: { 'Content-Type': contentType } });
      response.json = async () => { reads++; throw new SyntaxError('No JSON'); };
      response.text = async () => { reads++; return ''; };
      return response;
    });
    await assert.rejects(api.request('/auth/login'), error => error.message === invalidMessage && error.status === (status >= 400 ? status : 0));
    assert.equal(reads, 0, 'Must not read a non-JSON/bodyless response');
  }
});

test('malformed successful JSON never becomes a successful result', async () => {
  for (const body of ['', '{broken', 'null', '[]', 'false']) {
    const api = client(async () => new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    await assert.rejects(api.request('/auth/login'), error => error.status === 0 && error.message === invalidMessage);
  }
});

test('network failure while receiving a JSON body remains a network error', async () => {
  const api = client(async () => new Response(new ReadableStream({
    start(controller) { controller.error(new TypeError('Connection terminated')); }
  }), { headers: { 'Content-Type': 'application/json' } }));
  await assert.rejects(api.request('/orders'), error => error.status === 0 && error.message === networkMessage);
  assert.equal(api.cleared(), 1);
});

test('timeout while receiving the body is not mislabeled as malformed JSON', async () => {
  let receiving;
  const started = new Promise(resolve => { receiving = resolve; });
  const api = client(async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) {
      signal.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
      receiving();
    }
  }), { headers: { 'Content-Type': 'application/json' } }));
  const pending = api.request('/orders');
  await started;
  api.expire();
  await assert.rejects(pending, error => error.status === 0 && error.message === timeoutMessage);
  assert.equal(api.cleared(), 1);
});

test('explicit cancellation remains AbortError and removes the linked listener', async () => {
  const controller = new AbortController();
  let added = 0, removed = 0;
  const add = controller.signal.addEventListener.bind(controller.signal);
  const remove = controller.signal.removeEventListener.bind(controller.signal);
  controller.signal.addEventListener = (...args) => { added++; return add(...args); };
  controller.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const api = client(async (_url, { signal }) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });
  controller.abort();
  await assert.rejects(api.request('/auth/login', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.equal(api.cleared(), 1);
});
