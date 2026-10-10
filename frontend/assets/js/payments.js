/* Order payment presentation only. The server is the sole authority for paid state. */
(() => {
  'use strict';
  let ui, timer, epoch=0, current=null, checking=false;
  const $=selector=>document.querySelector(selector);
  const escape=value=>ui.escape(value??'');
  const request=(...args)=>TTechAuth.request(...args);
  const statusNames={unpaid:'Chờ thanh toán',review:'Giao dịch cần kiểm tra',paid:'Đã thanh toán'};
  const reasons={matched:'Đã khớp',manual_verified:'Đã xác minh thủ công',outgoing:'Tiền ra',receiver_mismatch:'Sai tài khoản/ngân hàng',unknown_order:'Không tìm thấy đơn',ambiguous_reference:'Nhiều mã thanh toán',amount_mismatch:'Sai số tiền',ineligible_order:'Đơn đã thanh toán/hủy hoặc không hợp lệ',manual_review:'Cần kiểm tra',duplicate_bank_reference:'Trùng mã ngân hàng'};
  function reset(){clearTimeout(timer);epoch++;current=null;checking=false;}
  function paymentMarkup(order){
    const state=order.status==='cancelled'?'Đơn hàng đã hủy':statusNames[order.paymentStatus]||'Chờ kiểm tra';
    let content='';
    if(order.paymentMethod==='cod')content='<p>Thanh toán khi nhận hàng. Cửa hàng cần xác nhận đơn trước khi giao; trạng thái này không xác nhận đã thu tiền.</p>';
    else if(!order.payment)content='<p>Đơn hàng cũ chưa có hướng dẫn chuyển khoản. Vui lòng liên hệ cửa hàng trước khi thanh toán.</p>';
    else if(order.status==='cancelled')content='<p>Không chuyển thêm tiền cho đơn đã hủy. Liên hệ cửa hàng nếu đã chuyển khoản.</p>';
    else if(order.paymentStatus==='paid')content=`<p>Hệ thống đã xác nhận thanh toán lúc ${escape(new Date(order.paidAt).toLocaleString('vi-VN'))}.</p>`;
    else if(order.paymentStatus==='review')content='<p>Giao dịch đang cần đối chiếu. Không chuyển thêm tiền; vui lòng liên hệ cửa hàng và cung cấp mã đơn.</p>';
    else if(order.payment.available===false)content='<p>Chuyển khoản đang tạm ngưng. Vui lòng liên hệ cửa hàng, không chuyển tiền cho đến khi có hướng dẫn.</p>';
    else {
      const p=order.payment;
      content=`<div class="bank-payment-layout"><figure><img id="payment-qr" src="${escape(p.qrUrl)}" width="260" height="300" alt="QR MB Bank cho đơn ${escape(order.id)}" referrerpolicy="no-referrer"><figcaption>Quét bằng ứng dụng ngân hàng của bạn.</figcaption><p id="qr-error" hidden>Không tải được QR. Bạn có thể chuyển khoản bằng thông tin bên cạnh, hoặc thử tải lại.</p></figure><section><h3>MB Bank</h3><dl class="bank-details">${[
        ['Chủ tài khoản',p.accountName,null],['Số tài khoản',p.accountNumber,'accountNumber'],['Nội dung chuyển khoản',p.transferContent,'transferContent'],['Số tiền',ui.money(order.total),'amount'],['Mã sản phẩm',p.productIds.join(', '),null]
      ].map(([label,value,key])=>`<div><dt>${label}</dt><dd><span>${escape(value)}</span>${key?`<button type="button" class="text-action" data-payment-copy="${key}" aria-label="Sao chép ${label.toLowerCase()}">Sao chép</button>`:''}</dd></div>`).join('')}</dl><p>Giữ nguyên nội dung và số tiền. Sau khi chuyển khoản, hãy chờ xác nhận từ ngân hàng.</p></section></div>`;
    }
    return `<header class="payment-heading"><h2>Thanh toán đơn hàng</h2><strong id="payment-status" class="order-status" role="status">${state}</strong></header>${content}<button type="button" class="btn btn-secondary" data-payment-refresh>Kiểm tra trạng thái</button><p id="payment-feedback" role="status" aria-live="polite"></p>`;
  }
  function paint(){
    const host=$('#order-payment');if(!host||!current)return;
    host.innerHTML=paymentMarkup(current);
    $('#payment-qr')?.addEventListener('error',event=>{event.target.hidden=true;$('#qr-error').hidden=false;});
  }
  function schedule(){
    clearTimeout(timer);
    if(current?.payment&&['unpaid','review'].includes(current.paymentStatus)&&current.status!=='cancelled')timer=setTimeout(()=>refresh(false),10000);
  }
  async function refresh(manual=true){
    if(checking||!current)return;
    if(!manual&&document.hidden){schedule();return;}
    const version=epoch,id=current.id,userId=TTechAuth.getUser()?.id;
    checking=true;if($('#payment-feedback'))$('#payment-feedback').textContent='Đang kiểm tra giao dịch...';
    const button=$('[data-payment-refresh]');if(button)button.disabled=true;
    try{
      const data=await request('/orders/'+encodeURIComponent(id));
      if(version!==epoch||TTechAuth.getUser()?.id!==userId)return;
      const changed=data.order.paymentStatus!==current.paymentStatus||data.order.status!==current.status||data.order.payment?.available!==current.payment?.available;
      current=data.order;if(changed)paint();
      if($('#payment-feedback'))$('#payment-feedback').textContent=manual?'Đã cập nhật trạng thái từ cửa hàng.':'';
    }catch(error){if(version===epoch&&$('#payment-feedback'))$('#payment-feedback').textContent=error.message;}
    finally{if(version===epoch){checking=false;if($('[data-payment-refresh]'))$('[data-payment-refresh]').disabled=false;schedule();}}
  }
  function mount(order){reset();current=order;paint();schedule();}
  async function copy(key){
    if(!current?.payment)return;
    const version=epoch,value=key==='amount'?String(current.total):current.payment[key];
    if(!['accountNumber','transferContent','amount'].includes(key))return;
    try{await navigator.clipboard.writeText(value);if(version===epoch)$('#payment-feedback').textContent='Đã sao chép.';}
    catch{if(version===epoch)$('#payment-feedback').textContent='Không thể sao chép tự động. Hãy chọn và sao chép thông tin hiển thị.';}
  }
  function receiptMarkup(receipt,orders){
    const order=orders.find(o=>o.id===receipt.orderId);
    const canConfirm=receipt.status!=='matched'&&!receipt.payloadConflict&&receipt.direction==='in'&&receipt.reason!=='duplicate_bank_reference';
    return `<article class="payment-receipt"><h4>SePay #${escape(receipt.id)} · ${escape(reasons[receipt.reason]||receipt.reason)}</h4><dl><div><dt>Đơn hàng</dt><dd>${escape(order?.id||'Chưa khớp')}</dd></div><div><dt>Khách hàng</dt><dd>${escape(order?.customer?.fullName||'—')}</dd></div><div><dt>Sản phẩm</dt><dd>${escape(order?.items.map(i=>i.productId+' · '+i.name+' × '+i.quantity).join('; ')||'—')}</dd></div><div><dt>Cần thu / Đã nhận</dt><dd>${order?ui.money(order.total):'—'} / ${ui.money(receipt.amount)}</dd></div><div><dt>Nội dung</dt><dd>${escape(receipt.content)}</dd></div><div><dt>Thời điểm</dt><dd>${escape(receipt.transactionDate)}</dd></div><div><dt>Phương thức</dt><dd>${escape(order?.paymentMethod||'Chuyển khoản')}</dd></div><div><dt>Kiểm tra</dt><dd>${escape(receipt.status)} · gửi lại ${receipt.repeats||0} lần${receipt.payloadConflict?' · Payload khác nhau':''}</dd></div></dl>${canConfirm?`<form data-payment-confirm="${escape(receipt.id)}"><label>Mã đơn cần đối chiếu<input class="field" name="orderId" required value="${escape(receipt.orderId||'')}" maxlength="80"></label><label>Lý do xác nhận<textarea class="field" name="reason" required minlength="10" maxlength="1000"></textarea></label><label><input type="checkbox" name="verified" required> Tôi đã kiểm tra giao dịch trên sao kê ngân hàng.</label><button type="submit" class="btn btn-secondary">Xác nhận sau đối chiếu</button><p role="status"></p></form>`:''}</article>`;
  }
  let adminVersion=0,adminData=null;
  function renderAdmin(){
    if(!adminData)return;
    const filter=$('#payment-admin-filter').value;
    const receipts=adminData.payments.filter(p=>filter==='all'||(filter==='duplicate'?(p.repeats>0||p.payloadConflict||p.reason==='duplicate_bank_reference'):p.status===filter||p.reason===filter));
    $('#payment-admin-results').innerHTML=filter==='unpaid'?adminData.orders.filter(o=>o.paymentStatus==='unpaid').map(o=>`<article class="payment-receipt"><h4>${escape(o.id)}</h4><p>${escape(o.customer.fullName)} · ${ui.money(o.total)} · ${escape(o.paymentMethod)}</p><p>${escape(o.items.map(i=>i.name+' × '+i.quantity).join('; '))}</p><p>Chưa xác nhận nhận tiền</p></article>`).join(''):receipts.map(p=>receiptMarkup(p,adminData.orders)).join('');
    if(!$('#payment-admin-results').children.length)$('#payment-admin-results').textContent='Không có giao dịch trong bộ lọc này.';
  }
  async function loadAdmin(){
    const version=++adminVersion,userId=TTechAuth.getUser()?.id;
    $('#payment-admin-feedback').textContent='Đang tải đối soát...';
    try{const data=await request('/admin/payments');if(version!==adminVersion||TTechAuth.getUser()?.id!==userId)return;adminData=data;renderAdmin();$('#payment-admin-feedback').textContent='Đã tải dữ liệu đối soát.';}
    catch(error){if(version===adminVersion)$('#payment-admin-feedback').textContent=error.message;}
  }
  async function confirm(event){
    const form=event.target.closest('[data-payment-confirm]');if(!form)return;event.preventDefault();
    if(!form.reportValidity())return;
    const button=form.querySelector('button'),output=form.querySelector('[role="status"]');if(button.disabled)return;button.disabled=true;
    const fields=new FormData(form);
    try{await request('/admin/payments/'+encodeURIComponent(form.dataset.paymentConfirm)+'/confirm',{method:'POST',body:{orderId:fields.get('orderId'),reason:fields.get('reason'),verified:fields.get('verified')==='on'}});await loadAdmin();}
    catch(error){output.textContent=error.message;button.disabled=false;}
  }
  function init(helpers){
    ui=helpers;
    document.addEventListener('click',event=>{const copyButton=event.target.closest('[data-payment-copy]');if(copyButton)copy(copyButton.dataset.paymentCopy);if(event.target.closest('[data-payment-refresh]'))refresh();});
    $('#payment-admin-load').addEventListener('click',loadAdmin);
    $('#payment-admin-filter').addEventListener('change',renderAdmin);
    $('#payment-admin-results').addEventListener('submit',confirm);
    document.addEventListener('ttech:auth-change',()=>{reset();adminVersion++;adminData=null;$('#payment-admin-results').replaceChildren();$('#payment-admin-feedback').textContent='';});
  }
  window.TTechPayments=Object.freeze({init,mount,reset});
})();
