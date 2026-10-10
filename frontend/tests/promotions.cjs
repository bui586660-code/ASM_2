'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const createPromotions = require('../../Backend/promotions.cjs');
class ApiError extends Error { constructor(status,message,fields) { super(message); this.status=status; this.fields=fields; } }
const user={id:'u'}, data={orders:[]}, items=[{productId:'1',subtotal:100000},{productId:'2',subtotal:50000}];
test('percentage rounding, eligible products, fixed cap and shipping discounts stay within payable amounts',()=>{
  const service=createPromotions({coupons:[
    {code:'PERCENT',active:true,type:'percent',value:7,productIds:['2']},
    {code:'FIXED',active:true,type:'fixed',value:999999,productIds:['1']},
    {code:'SHIP',active:true,type:'shipping'}
  ]},ApiError);
  assert.equal(service.apply(data,user,items,150000,30000,'PERCENT').discount,3500);
  assert.equal(service.apply(data,user,items,150000,30000,'FIXED').discount,100000);
  assert.equal(service.apply(data,user,items,150000,30000,'SHIP').discount,30000);
  assert.throws(()=>service.apply(data,user,items,150000,0,'SHIP'),/không có khoản giảm/);
  assert.equal(service.apply(data,user,[{productId:'2',subtotal:101}],101,30000,'PERCENT').discount,7);
});
test('expired/future rules and per-account consumption are rechecked each time',()=>{
  const service=createPromotions({coupons:[
    {code:'FUTURE',active:true,type:'fixed',value:1000,startsAt:'2100-01-01T00:00:00Z'},
    {code:'ONCE',active:true,type:'fixed',value:1000,perUserLimit:1}
  ]},ApiError);
  assert.throws(()=>service.apply(data,user,items,150000,30000,'FUTURE'),/hiệu lực/);
  const used={orders:[{userId:'u',coupon:{code:'ONCE'}}]};
  assert.throws(()=>service.apply(used,user,items,150000,30000,'ONCE'),/hết lượt/);
  assert.equal(service.apply(used,{id:'other'},items,150000,30000,'ONCE').discount,1000);
});
test('invalid operator config fails closed; no default live coupon is enabled',()=>{
  for(const rule of [
    {code:'BAD',active:true,type:'percent',value:101},
    {code:'BAD',active:true,type:'fixed',value:-1},
    {code:'BAD',active:true,type:'fixed',value:1000,maxUses:1.1},
    {code:'BAD',active:true,type:'fixed',value:1000,expiresAt:'bad'},
    {code:'BAD',active:true,type:'fixed',value:1000,productIds:[]}
  ]) assert.throws(()=>createPromotions({coupons:[rule]},ApiError));
  assert.deepEqual(require('../../Backend/promotions.json'),{coupons:[]});
});
