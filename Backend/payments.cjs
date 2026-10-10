'use strict';
const {randomBytes,randomUUID,createHmac,createHash,timingSafeEqual}=require('node:crypto');
const senderBanks=['MB','VCB','BIDV','ICB','TCB','ACB','VPB','TPB','OTHER'];
function configuration(input={}) {
  const config={enabled:process.env.BANK_PAYMENTS_ENABLED==='true',codEnabled:process.env.COD_ENABLED!=='false',
    secret:process.env.SEPAY_WEBHOOK_SECRET||'',accountNumber:process.env.MB_ACCOUNT_NUMBER||'0911236639',
    accountName:process.env.MB_ACCOUNT_NAME||'BUI NGUYEN PHAT TAI',...input};
  if(typeof config.enabled!=='boolean'||typeof config.codEnabled!=='boolean')throw Error('Invalid payment enable flags');
  if(config.enabled && (typeof config.secret!=='string'||config.secret.length<32||!/^[0-9]{6,30}$/.test(config.accountNumber)||!config.accountName.trim()))throw Error('Bank payments require a webhook secret (32+ characters) and valid receiver configuration');
  return Object.freeze(config);
}
module.exports=function paymentRoutes({db,currentUser,requireAdmin,send,readBody,ApiError,config}) {
  if(config.enabled&&db.kind!=='sqlite')throw Error('Bank payments require a verified SQLite migration');
  const available=()=>({bank:config.enabled,qr:config.enabled,cod:config.codEnabled});
  function initialize(order,body) {
    if(!available()[body.paymentMethod])throw new ApiError(503,'Phương thức thanh toán này hiện chưa sẵn sàng. Vui lòng chọn phương thức khác.');
    if(body.senderBank!==undefined&&!senderBanks.includes(body.senderBank))throw new ApiError(400,'Ngân hàng chuyển tiền không hợp lệ.');
    if(body.paymentMethod==='cod')return;
    if(order.total<=0)throw new ApiError(400,'Số tiền thanh toán không hợp lệ.');
    const reference='TT'+randomBytes(12).toString('hex').toUpperCase();
    const productIds=order.items.map(item=>String(item.productId));
    // Conservative 60 ASCII characters. Complete product mapping remains in the snapshot.
    const suffix=productIds.every(id=>/^[A-Za-z0-9-]+$/.test(id))?productIds.join(' '):'';
    const transferContent=suffix&&reference.length+suffix.length+1<=60?reference+' '+suffix:reference;
    const payment={reference,transferContent,productIds,bank:'MBBank',accountNumber:config.accountNumber,accountName:config.accountName};
    const params=new URLSearchParams({acc:payment.accountNumber,bank:payment.bank,amount:String(order.total),des:transferContent,template:'compact',holder:payment.accountName});
    payment.qrUrl='https://vietqr.app/img?'+params;
    order.payment=payment;order.senderBank=body.senderBank||'OTHER';
  }
  async function signedPayload(request) {
    if(!config.enabled)throw new ApiError(503,'Thanh toán ngân hàng chưa được bật.');
    const timestamp=request.headers['x-sepay-timestamp'],signature=request.headers['x-sepay-signature'];
    if(!/^\d{10}$/.test(timestamp||'')||Math.abs(Date.now()/1000-Number(timestamp))>300||!/^sha256=[a-f0-9]{64}$/.test(signature||''))throw new ApiError(401,'Xác thực webhook không hợp lệ.');
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']||''))throw new ApiError(415,'Định dạng webhook không hợp lệ.');
    let size=0;const chunks=[];
    for await(const chunk of request){size+=chunk.length;if(size>16384)throw new ApiError(413,'Dữ liệu gửi quá lớn.');chunks.push(chunk);}
    const raw=Buffer.concat(chunks),expected=createHmac('sha256',config.secret).update(timestamp+'.').update(raw).digest();
    if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex')))throw new ApiError(401,'Xác thực webhook không hợp lệ.');
    let p;try{p=JSON.parse(raw.toString('utf8'));}catch{throw new ApiError(400,'Webhook không hợp lệ.');}
    if(!p||!Number.isSafeInteger(p.id)||p.id<=0||!Number.isSafeInteger(p.transferAmount)||p.transferAmount<=0||!['in','out'].includes(p.transferType)||
      !['gateway','accountNumber','content','transactionDate'].every(k=>typeof p[k]==='string'&&p[k].length<=2000)||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p.transactionDate)||
      (p.referenceCode!=null&&(typeof p.referenceCode!=='string'||p.referenceCode.length>200)))throw new ApiError(400,'Webhook không hợp lệ.');
    // Retain only reconciliation fields, not balance or unrelated personal data.
    const normalized={id:String(p.id),gateway:p.gateway,accountNumber:p.accountNumber,content:p.content,transactionDate:p.transactionDate,direction:p.transferType,amount:p.transferAmount,bankReference:p.referenceCode||''};
    return {...normalized,payloadHash:createHash('sha256').update(JSON.stringify(normalized)).digest('hex')};
  }
  function markPaid(data,order,receipt,actorId,reason) {
    const at=new Date().toISOString(),previous=order.paymentStatus;
    order.paymentStatus='paid';order.paidAt=at;order.providerTransactionId=receipt.id;
    receipt.orderId=order.id;receipt.status='matched';receipt.reason=actorId==='sepay'?'matched':'manual_verified';
    data.paymentAudit.push({id:randomUUID(),orderId:order.id,transactionId:receipt.id,actorId,at,reason,from:previous,to:'paid'});
  }
  function reconcile(data,incoming) {
    const existing=data.payments.find(p=>p.id===incoming.id);
    if(existing){existing.repeats=(existing.repeats||0)+1;existing.lastReceivedAt=new Date().toISOString();if(existing.payloadHash!==incoming.payloadHash)existing.payloadConflict=true;return;}
    const receipt={...incoming,receivedAt:new Date().toISOString(),status:'review',reason:'unknown_order',repeats:0,orderId:null};
    data.payments.push(receipt);
    const refs=[...new Set(incoming.content.toUpperCase().match(/\bTT[A-F0-9]{24}\b/g)||[])];
    const order=refs.length===1?data.orders.find(o=>o.payment?.reference===refs[0]):null;
    if(order)receipt.orderId=order.id;
    if(incoming.direction!=='in'){receipt.reason='outgoing';return;}
    if(incoming.gateway.toUpperCase()!=='MBBANK'||incoming.accountNumber!==config.accountNumber){receipt.reason='receiver_mismatch';return;}
    if(incoming.bankReference&&data.payments.some(p=>p!==receipt&&p.bankReference===incoming.bankReference&&p.accountNumber===incoming.accountNumber)){receipt.reason='duplicate_bank_reference';return;}
    if(!order){receipt.reason=refs.length>1?'ambiguous_reference':'unknown_order';return;}
    if(order.payment.accountNumber!==incoming.accountNumber||!['bank','qr'].includes(order.paymentMethod)||order.status==='cancelled'||order.paymentStatus==='paid'){receipt.reason='ineligible_order';return;}
    if(incoming.amount!==order.total){receipt.reason='amount_mismatch';}
    else if(order.paymentStatus!=='unpaid'){receipt.reason='manual_review';}
    else {markPaid(data,order,receipt,'sepay','Exact verified incoming transfer');return;}
    const before=order.paymentStatus;order.paymentStatus='review';
    data.paymentAudit.push({id:randomUUID(),orderId:order.id,transactionId:receipt.id,actorId:'sepay',at:new Date().toISOString(),reason:receipt.reason,from:before,to:'review'});
  }
  async function webhook(request,response) {
    if(request.method!=='POST')throw new ApiError(405,'Thao tác không được hỗ trợ.');
    const payload=await signedPayload(request);
    await db.update(data=>reconcile(data,payload));
    send(response,200,{success:true});
  }
  async function handle(request,response,pathname) {
    if(pathname==='/api/payments/config'&&request.method==='GET'){send(response,200,{methods:available()});return true;}
    if(!pathname.startsWith('/api/admin/payments'))return false;
    const data=await db.read();requireAdmin(data,request);
    if(request.method==='GET'&&pathname==='/api/admin/payments'){
      const filter=new URL(request.url,'http://local').searchParams.get('filter')||'all';
      const rows=(data.payments||[]).filter(p=>filter==='all'||(filter==='duplicate'?(p.repeats>0||p.payloadConflict||p.reason==='duplicate_bank_reference'):p.status===filter||p.reason===filter));
      send(response,200,{payments:rows.slice().reverse(),orders:data.orders.map(({requestHash,idempotencyKey,...order})=>order),audit:data.paymentAudit||[]});return true;
    }
    const match=pathname.match(/^\/api\/admin\/payments\/(\d+)\/confirm$/);
    if(match&&request.method==='POST'){
      const body=await readBody(request);
      if(body.verified!==true||typeof body.reason!=='string'||body.reason.trim().length<10||body.reason.length>1000)throw new ApiError(400,'Hãy xác nhận đã đối chiếu sao kê và nhập lý do ít nhất 10 ký tự.');
      await db.update(latest=>{
        const admin=requireAdmin(latest,request),receipt=latest.payments?.find(p=>p.id===match[1]),order=latest.orders.find(o=>o.id===body.orderId);
        if(!receipt||!order)throw new ApiError(404,'Không tìm thấy giao dịch hoặc đơn hàng.');
        if(receipt.status==='matched'||receipt.payloadConflict||receipt.direction!=='in'||receipt.gateway.toUpperCase()!=='MBBANK'||receipt.accountNumber!==config.accountNumber||receipt.reason==='duplicate_bank_reference'||
          !order.payment||order.payment.accountNumber!==receipt.accountNumber||order.status==='cancelled'||order.paymentStatus==='paid'||receipt.amount!==order.total||(receipt.orderId&&receipt.orderId!==order.id))throw new ApiError(409,'Giao dịch không đủ điều kiện xác nhận. Cần kiểm tra hoặc hoàn tiền theo quy trình riêng.');
        markPaid(latest,order,receipt,admin.id,body.reason.trim());
      });send(response,200,{success:true});return true;
    }
    throw new ApiError(404,'Không tìm thấy chức năng yêu cầu.');
  }
  return {available,initialize,webhook,handle};
};
module.exports.configuration=configuration;
