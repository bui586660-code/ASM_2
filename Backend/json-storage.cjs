'use strict';

const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

const COLLECTIONS = ['users', 'authSessions', 'orders', 'payments', 'paymentAudit', 'metadata'];

class JsonStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.products)) {
    throw new Error('Database products collection is invalid');
  }
  for (const key of COLLECTIONS) {
    if (data[key] === undefined) data[key] = [];
    if (!Array.isArray(data[key])) throw new Error(`Database ${key} collection is invalid`);
  }
  return data;
}

function openJsonDatabase(dbPath) {
  let pending = Promise.resolve();

  async function read() {
    return validate(JSON.parse(await fs.readFile(dbPath, 'utf8')));
  }

  function update(mutator) {
    const result = pending.then(async () => {
      const lockPath = dbPath + '.lock';
      let lock;
      try {
        lock = await fs.open(lockPath, 'wx', 0o600);
      } catch (error) {
        if (error.code === 'EEXIST') throw new JsonStoreError(503, 'Dữ liệu đang được cập nhật. Vui lòng thử lại.');
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
        await fs.unlink(temporary).catch(error => {
          if (error.code !== 'ENOENT') console.error('Temporary database cleanup failed:', error.code);
        });
        await lock.close();
        await fs.unlink(lockPath);
      }
    });
    pending = result.catch(() => undefined);
    return result;
  }

  return { kind: 'json', read, update };
}

module.exports = { COLLECTIONS, JsonStoreError, openJsonDatabase };
