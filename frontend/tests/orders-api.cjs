const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {randomUUID, randomBytes} = require('node:crypto');
const {createServer} = require('../../Backend/server.cjs');
const origin='http://127.0.0.1:5501';
const customer={fullName:'Người nhận',phone:'0912345678',email:'test@example.com',province:'TP Hồ Chí Minh',district:'Quận 1',ward:'Bến Nghé',address:'123 Đường thử nghiệm',note:''};
async function fixture(t,promotions={coupons:[]}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ttech-orders-')); const dbPath=path.join(dir,'db.json');
 await fs.writeFile(dbPath,JSON.stringify({products:[{id:1,name:'Laptop A',price:10000000,sale_price:9000000,image:'./assets/images/laptop-placeholder.svg',stock:5},{id:2,name:'Laptop B',price:20000000,image:'./assets/images/laptop-placeholder.svg'}],users:[],authSessions:[]}));
 const server=await createServer({dbPath,promotions,origins:[origin],rateLimitMax:100});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));assert.equal(path.dirname(dir),os.tmpdir());await fs.rm(dir,{recursive:true})});
 async function request(route,method='GET',body,cookie){const r=await fetch('http://127.0.0.1:'+server.address().port+route,{method,headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}}
 async function login(email){const password=randomBytes(18).toString('hex');await request('/api/auth/register','POST',{name:'Tester',email,password,confirm:password});return (await request('/api/auth/login','POST',{email,password})).cookie}
 const cookie=await login('one@example.com');
 const post=(route,body)=>request(route,'POST',body,cookie);
 const items=[{productId:'1',quantity:2}];
 async function payload(){const q=await post('/api/orders/quote',{items});assert.equal(q.status,200);return {customer,items,paymentMethod:'cod',confirmed:true,quoteHash:q.data.quoteHash,idempotencyKey:randomUUID()}}
 return {request,post,login,cookie,items,payload,dbPath,read:async()=>JSON.parse(await fs.readFile(dbPath,'utf8'))};
}
test('coupon quote separates direct savings and capped coupon; order stores approved discount',async t=>{
 const f=await fixture(t,{coupons:[{code:'LAPTOP5',active:true,type:'percent',value:5,maxDiscount:500000,minSubtotal:10000000,perUserLimit:1}]});
 const q=await f.post('/api/orders/quote',{items:f.items,couponCode:' laptop5 ',discount:99999999});
 assert.equal(q.status,200);assert.equal(q.data.originalSubtotal,20000000);assert.equal(q.data.productDiscount,2000000);
 assert.equal(q.data.discount,500000);assert.equal(q.data.total,17530000);assert.equal(q.data.coupon.code,'LAPTOP5');
 const body={...await f.payload(),quoteHash:q.data.quoteHash,couponCode:'LAPTOP5'};
 const result=await f.post('/api/orders',body);assert.equal(result.status,201);assert.equal(result.data.order.discount,500000);
 assert.equal((await f.post('/api/orders',body)).status,200,'Replay must not consume twice');
 const reused=await f.post('/api/orders/quote',{items:f.items,couponCode:'LAPTOP5'});assert.equal(reused.status,400);
});
test('invalid, expired, disabled, restricted and minimum-spend coupons cannot reduce price',async t=>{
 const coupons=[{code:'OFF',active:false,type:'fixed',value:1000},{code:'OLD',active:true,type:'fixed',value:1000,expiresAt:'2020-01-01T00:00:00Z'},
 {code:'MIN',active:true,type:'fixed',value:1000,minSubtotal:50000000},{code:'ONLY2',active:true,type:'fixed',value:1000,productIds:['2']}];
 const f=await fixture(t,{coupons});
 for(const couponCode of ['UNKNOWN','OFF','OLD','MIN','ONLY2',{},'a'.repeat(100)])assert.equal((await f.post('/api/orders/quote',{items:f.items,couponCode})).status,400);
 const q=await f.post('/api/orders/quote',{items:f.items});assert.equal(q.data.discount,0);assert.equal(q.data.coupons.length,2);
});
test('coupon allocation is atomic and rejects changed or expired quotes',async t=>{
 const f=await fixture(t,{coupons:[{code:'ONE',active:true,type:'fixed',value:100000,maxUses:1}]});
 const q=await f.post('/api/orders/quote',{items:f.items,couponCode:'ONE'});
 const first={...await f.payload(),couponCode:'ONE',quoteHash:q.data.quoteHash},second={...first,idempotencyKey:randomUUID()};
 const results=await Promise.all([f.post('/api/orders',first),f.post('/api/orders',second)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,400]);assert.equal((await f.read()).orders.length,1);
 const wrong=await f.post('/api/orders',{...await f.payload(),couponCode:'NOPE'});assert.equal(wrong.status,400);
});
test('quote uses canonical sale prices, integer totals, shipping threshold and ignores client totals',async t=>{const f=await fixture(t);let r=await f.post('/api/orders/quote',{items:f.items,total:1});assert.equal(r.status,200);assert.equal(r.data.subtotal,18000000);assert.equal(r.data.shippingFee,30000);assert.equal(r.data.discount,0);assert.equal(r.data.total,18030000);r=await f.post('/api/orders/quote',{items:[...f.items,{productId:'2',quantity:1}]});assert.equal(r.data.total,38000000);assert.equal(r.data.shippingFee,0)});
test('order persists a snapshot, decrements known stock once and is idempotent under concurrent requests',async t=>{const f=await fixture(t),body=await f.payload();body.total=1;body.items[0].price=1;const responses=await Promise.all([f.post('/api/orders',body),f.post('/api/orders',body)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);assert.equal(responses[0].data.order.id,responses[1].data.order.id);const db=await f.read();assert.equal(db.orders.length,1);assert.equal(db.products[0].stock,3);assert.equal(db.orders[0].total,18030000);assert.equal(db.orders[0].status,'pending');assert.equal(db.orders[0].paymentStatus,'unpaid');assert.equal(db.orders[0].items[0].price,9000000);assert.equal((await f.post('/api/orders',{...body,paymentMethod:'bank'})).status,409)});
test('rejects malformed quantities, unknown IDs, stock and unconfirmed or invalid customer/payment',async t=>{const f=await fixture(t);for(const items of [[],[{productId:'1',quantity:0}],[{productId:'1',quantity:-1}],[{productId:'1',quantity:1.5}],[{productId:'1',quantity:6}],[{productId:'missing',quantity:1}],[...f.items,...f.items]])assert.ok((await f.post('/api/orders/quote',{items})).status>=400);const good=await f.payload();for(const extra of [{confirmed:false},{paymentMethod:''},{customer:{...customer,phone:'123'}},{customer:{...customer,fullName:' '}},{customer:{...customer,email:'bad'}},{customer:{...customer,ward:''}}])assert.equal((await f.post('/api/orders',{...good,...extra})).status,400);assert.equal((await f.read()).orders.length,0)});
test('price changes require a new quote and concurrent orders cannot oversell stock',async t=>{const f=await fixture(t);const body=await f.payload();let db=await f.read();db.products[0].sale_price=8000000;await fs.writeFile(f.dbPath,JSON.stringify(db));assert.equal((await f.post('/api/orders',body)).status,409);db=await f.read();db.products[0].stock=2;await fs.writeFile(f.dbPath,JSON.stringify(db));const a=await f.payload(),b=await f.payload();const rs=await Promise.all([f.post('/api/orders',a),f.post('/api/orders',b)]);assert.deepEqual(rs.map(r=>r.status).sort(),[201,409]);assert.equal((await f.read()).products[0].stock,0)});
test('orders/history/recovery are private to owner and survive server data reload',async t=>{const f=await fixture(t),body=await f.payload();const made=await f.post('/api/orders',body);assert.equal(made.status,201);const id=made.data.order.id;const second=await f.login('two@example.com');for(const route of ['/api/orders','/api/orders/'+id,'/api/orders/request/'+body.idempotencyKey])assert.equal((await f.request(route)).status,401);assert.equal((await f.request('/api/orders/'+id,'GET',undefined,second)).status,404);assert.equal((await f.request('/api/orders/request/'+body.idempotencyKey,'GET',undefined,second)).status,404);assert.deepEqual((await f.request('/api/orders','GET',undefined,second)).data.orders,[]);assert.equal((await f.request('/api/orders','GET',undefined,f.cookie)).data.orders.length,1);assert.equal((await f.request('/api/orders/request/'+body.idempotencyKey,'GET',undefined,f.cookie)).data.order.id,id);assert.ok(!JSON.stringify(made.data).includes('requestHash'))});
