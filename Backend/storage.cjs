'use strict';
// Small single-host adapter. A transaction callback must not await external work.
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const collections=['products','users','authSessions','orders','payments','paymentAudit'];
const keyOf=(table,row)=>String(table==='authSessions'?row.tokenHash:row.id);

function openDatabase(filename,{initialize=false}={}) {
  if (!initialize && !fs.existsSync(filename)) throw Error('Run the verified migration before selecting SQLite');
  const sql=new DatabaseSync(filename,{timeout:5000});
  sql.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  if(initialize) {
    sql.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        email TEXT GENERATED ALWAYS AS (lower(trim(json_extract(payload,'$.email')))) STORED UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS authSessions(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        user_id TEXT GENERATED ALWAYS AS (CAST(json_extract(payload,'$.userId') AS TEXT)) STORED REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        user_id TEXT GENERATED ALWAYS AS (CAST(json_extract(payload,'$.userId') AS TEXT)) STORED NOT NULL REFERENCES users(id),
        request_key TEXT GENERATED ALWAYS AS (json_extract(payload,'$.idempotencyKey')) STORED,
        payment_reference TEXT GENERATED ALWAYS AS (json_extract(payload,'$.payment.reference')) STORED UNIQUE,
        paid_transaction TEXT GENERATED ALWAYS AS (json_extract(payload,'$.providerTransactionId')) STORED UNIQUE,
        UNIQUE(user_id,request_key));
      CREATE TABLE IF NOT EXISTS order_items(order_id TEXT NOT NULL REFERENCES orders(id),position INTEGER NOT NULL,
        payload TEXT NOT NULL CHECK(json_valid(payload)),PRIMARY KEY(order_id,position));
      CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)),
        order_id TEXT GENERATED ALWAYS AS (json_extract(payload,'$.orderId')) STORED REFERENCES orders(id),
        bank_reference TEXT GENERATED ALWAYS AS (nullif(json_extract(payload,'$.bankReference'),'')) STORED);
      CREATE TABLE IF NOT EXISTS paymentAudit(id TEXT PRIMARY KEY,position INTEGER NOT NULL,payload TEXT NOT NULL CHECK(json_valid(payload)));
      CREATE INDEX IF NOT EXISTS payments_bank_reference ON payments(bank_reference);`);
  }
  const meta=(key)=>sql.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
  if(!initialize && !meta('migration')) {sql.close();throw Error('Database migration has not been verified');}
  function snapshot() {
    const data=JSON.parse(meta('extra')||'{}');
    for(const table of collections) data[table]=sql.prepare(`SELECT payload FROM ${table} ORDER BY position`).all().map(row=>JSON.parse(row.payload));
    return data;
  }
  function persist(data) {
    for(const table of collections) {
      if(!Array.isArray(data[table]))throw Error('Invalid collection '+table);
      const seen=new Set(), previous=new Map(sql.prepare(`SELECT id,position,payload FROM ${table}`).all().map(row=>[row.id,row]));
      const insert=sql.prepare(`INSERT INTO ${table}(id,position,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,payload=excluded.payload`);
      data[table].forEach((row,index)=>{
        const id=keyOf(table,row);if(!id||id==='undefined'||seen.has(id))throw Error('Duplicate/missing key in '+table);seen.add(id);
        const value=JSON.stringify(row);
        if(previous.get(id)?.payload!==value||previous.get(id)?.position!==index)insert.run(id,index,value);
        if(table==='orders'&&previous.get(id)?.payload!==value){
          sql.prepare('DELETE FROM order_items WHERE order_id=?').run(id);
          const itemInsert=sql.prepare('INSERT INTO order_items(order_id,position,payload) VALUES(?,?,?)');
          if(!Array.isArray(row.items))throw Error('Invalid order items');
          row.items.forEach((item,i)=>itemInsert.run(id,i,JSON.stringify(item)));
        }
      });
      for(const id of previous.keys())if(!seen.has(id)) {
        if(table!=='authSessions')throw Error('Deletion prohibited for '+table);
        sql.prepare('DELETE FROM authSessions WHERE id=?').run(id);
      }
    }
    const extra=Object.fromEntries(Object.entries(data).filter(([key])=>!collections.includes(key)));
    sql.prepare("INSERT INTO metadata VALUES('extra',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(extra));
  }
  function transaction(operation,write=false) {
    sql.exec(write?'BEGIN IMMEDIATE':'BEGIN');
    try {const value=operation();sql.exec('COMMIT');return value;}
    catch(error){sql.exec('ROLLBACK');throw error;}
  }
  return {kind:'sqlite',close:()=>sql.close(),
    read:async()=>transaction(snapshot),
    update:async mutator=>transaction(()=>{
      const data=snapshot(),value=mutator(data);
      if(value&&typeof value.then==='function')throw Error('Async database callbacks are prohibited');
      persist(data);return value;
    },true),
    import(source,record){return transaction(()=>{
      if(meta('migration')) {
        const previous=JSON.parse(meta('migration'));
        if(previous.sourceHash!==record.sourceHash)throw Error('Source changed since migration; refuse to overwrite live data');
        return {...previous,alreadyMigrated:true};
      }
      if(collections.some(table=>sql.prepare(`SELECT count(*) AS n FROM ${table}`).get().n))throw Error('Refuse to import into a nonempty database');
      const normalized={...source};for(const key of collections)normalized[key]??=[];
      persist(normalized);
      if(!isDeepStrictEqual(snapshot(),normalized))throw Error('Migration data verification failed');
      const itemCount=sql.prepare('SELECT count(*) AS n FROM order_items').get().n;
      if(itemCount!==normalized.orders.reduce((n,o)=>n+o.items.length,0))throw Error('Item count mismatch');
      if(sql.prepare('PRAGMA foreign_key_check').all().length)throw Error('Foreign key check failed');
      sql.prepare("INSERT INTO metadata VALUES('migration',?)").run(JSON.stringify(record));return record;
    },true);}
  };
}
async function migrate(source,target) {
  if(path.resolve(source)===path.resolve(target))throw Error('Source and target must differ');
  const lock=fs.openSync(source+'.lock','wx',0o600);
  let db;
  try {
    const bytes=fs.readFileSync(source),data=JSON.parse(bytes.toString('utf8'));
    if(!Array.isArray(data.products))throw Error('Invalid source products');
    const sourceHash=createHash('sha256').update(bytes).digest('hex');
    const backup=source+'.pre-sqlite-'+sourceHash.slice(0,12)+'.bak';
    if(!fs.existsSync(backup))fs.writeFileSync(backup,bytes,{flag:'wx',mode:0o600});
    if(!fs.readFileSync(backup).equals(bytes))throw Error('Backup verification failed');
    db=openDatabase(target,{initialize:true});
    return db.import(data,{sourceHash,backup,createdAt:new Date().toISOString(),counts:Object.fromEntries(collections.map(k=>[k,(data[k]||[]).length]))});
  } finally {db?.close();fs.closeSync(lock);fs.unlinkSync(source+'.lock');}
}
module.exports={openDatabase,migrate};
if(require.main===module)migrate(path.resolve(process.argv[2]||path.join(__dirname,'db.json')),path.resolve(process.argv[3]||path.join(__dirname,'ttech.sqlite')))
  .then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error('Migration failed:',error.message);process.exitCode=1;});
