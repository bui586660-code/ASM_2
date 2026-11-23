'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { COLLECTIONS, openJsonDatabase } = require('./json-storage.cjs');

const MIGRATION_ID = 'sqlite-to-json-v1';
const keyFor = (collection, item) => String(collection === 'authSessions' ? item.tokenHash : item.id);

function mergeCollection(target, source, collection) {
  const merged = new Map(target.map(item => [keyFor(collection, item), item]));
  for (const item of source) merged.set(keyFor(collection, item), item);
  return [...merged.values()];
}

async function migrate(sqlitePath, jsonPath) {
  const { DatabaseSync } = require('node:sqlite');
  const source = new DatabaseSync(path.resolve(sqlitePath), { readOnly: true });
  const snapshot = {};
  try {
    const extra = source.prepare("SELECT value FROM metadata WHERE key = 'extra'").get()?.value;
    Object.assign(snapshot, extra ? JSON.parse(extra) : {});
    for (const collection of COLLECTIONS) {
      if (collection === 'metadata') continue;
      snapshot[collection] = source.prepare(`SELECT payload FROM ${collection} ORDER BY position`).all().map(row => JSON.parse(row.payload));
    }
  } finally {
    source.close();
  }

  const targetPath = path.resolve(jsonPath);
  const target = openJsonDatabase(targetPath);
  const backupPath = targetPath + '.pre-sqlite-to-json-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.bak';

  return target.update(async data => {
    if (data.metadata.some(item => item?.id === MIGRATION_ID)) {
      return { alreadyMigrated: true, backup: null, counts: Object.fromEntries(COLLECTIONS.map(key => [key, data[key].length])) };
    }

    await fs.writeFile(backupPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    for (const collection of COLLECTIONS) {
      const records = Array.isArray(snapshot[collection]) ? snapshot[collection] : [];
      data[collection] = mergeCollection(data[collection], records, collection);
    }
    data.metadata.push({
      id: MIGRATION_ID,
      source: path.resolve(sqlitePath),
      migratedAt: new Date().toISOString(),
      counts: Object.fromEntries(COLLECTIONS.map(key => [key, data[key].length]))
    });
    return { alreadyMigrated: false, backup: backupPath, counts: Object.fromEntries(COLLECTIONS.map(key => [key, data[key].length])) };
  });
}

module.exports = { MIGRATION_ID, migrate };

if (require.main === module) {
  const sqlitePath = process.argv[2] || path.join(__dirname, 'ttech.sqlite');
  const jsonPath = process.argv[3] || path.join(__dirname, 'db.json');
  migrate(sqlitePath, jsonPath)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error('SQLite to JSON migration failed:', error.message); process.exitCode = 1; });
}
