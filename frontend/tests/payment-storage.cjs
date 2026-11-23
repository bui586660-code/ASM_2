'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { openJsonDatabase } = require('../../Backend/json-storage.cjs');

test('JSON storage serializes writes, preserves collections and retains data after reopening', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttech-json-storage-'));
  const dbPath = path.join(directory, 'db.json');
  const original = { products: [{ id: '1', name: 'Laptop', price: 100 }], customCollection: [{ untouched: true }] };
  await fs.writeFile(dbPath, JSON.stringify(original));
  t.after(async () => fs.rm(directory, { recursive: true }));

  const store = openJsonDatabase(dbPath);
  await Promise.all([
    store.update(data => { data.users.push({ id: 'u', email: 'u@example.com' }); }),
    store.update(data => { data.orders.push({ id: 'o', userId: 'u', items: [] }); })
  ]);

  const saved = await store.read();
  assert.deepEqual(saved.products, original.products);
  assert.deepEqual(saved.customCollection, original.customCollection);
  assert.equal(saved.users.length, 1);
  assert.equal(saved.orders.length, 1);
  assert.deepEqual(saved.payments, []);
  assert.deepEqual(saved.paymentAudit, []);
  assert.deepEqual(saved.metadata, []);

  const reopened = openJsonDatabase(dbPath);
  assert.deepEqual(await reopened.read(), saved);
});

test('JSON storage refuses a conflicting writer without modifying the database', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ttech-json-lock-'));
  const dbPath = path.join(directory, 'db.json');
  await fs.writeFile(dbPath, JSON.stringify({ products: [], users: [] }));
  t.after(async () => fs.rm(directory, { recursive: true }));

  const before = await fs.readFile(dbPath, 'utf8');
  await fs.writeFile(dbPath + '.lock', 'another process', { flag: 'wx' });
  await assert.rejects(openJsonDatabase(dbPath).update(data => data.users.push({ id: 'u' })), { status: 503 });
  assert.equal(await fs.readFile(dbPath, 'utf8'), before);
});
