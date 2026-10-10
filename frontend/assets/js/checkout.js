/* Checkout and order views reuse the store's cart, auth request helper and hash router. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const fieldNames = ['fullName','phone','email','province','district','ward','address','note'];
  const labels = {fullName:'Họ và tên',phone:'Số điện thoại',email:'Email',province:'Tỉnh/Thành phố',district:'Quận/Huyện',ward:'Phường/Xã',address:'Địa chỉ nhận hàng',note:'Ghi chú đơn hàng'};
  const paymentLabels = {cod:'Thanh toán khi nhận hàng (COD)',bank:'Chuyển khoản ngân hàng',qr:'Quét mã VietQR (MB Bank)'};
  const statusLabels = {pending:'Chờ xác nhận',confirmed:'Đã xác nhận',shipping:'Đang giao hàng',completed:'Hoàn thành',cancelled:'Đã hủy'};
  const pendingKey = 'ttech-checkout-pending-v1';
  let ui, route = '', generation = 0, quoteVersion = 0, account = null, quote = null, busy = false;
  let pending = {};
  let promotion = null, cartQuoteVersion = 0, promotionVersion = 0;
  const promotionKey = 'ttech-checkout-coupon-v1';
  try { promotion = JSON.parse(sessionStorage.getItem(promotionKey) || 'null'); } catch { /* Session-only fallback. */ }
  try { const saved = JSON.parse(sessionStorage.getItem(pendingKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) pending = saved; } catch { /* In-memory retry still uses the same key if browser storage is unavailable. */ }
  const escape = value => ui.escape(value ?? '');
  const money = value => ui.money(value);
  const request = (...args) => TTechAuth.request(...args);
  const view = () => $('#commerce-view');
  const owned = version => version === generation && account && TTechAuth.getUser()?.id === account.id;
  const isRoute = hash => /^(#checkout|#orders|#order\/[^/]+|#order-success\/[^/]+)$/.test(hash);

  function couponCode() {
    return promotion?.userId === TTechAuth.getUser()?.id && typeof promotion?.code === 'string' ? promotion.code : '';
  }
  function setCoupon(code) {
    // Ignore every quote started before this selection, including late failures.
    cartQuoteVersion++; quoteVersion++;
    promotion = code ? {userId:TTechAuth.getUser()?.id,code} : null;
    try { if (promotion) sessionStorage.setItem(promotionKey,JSON.stringify(promotion)); else sessionStorage.removeItem(promotionKey); }
    catch { /* The current tab can still apply the code without browser storage. */ }
  }
  async function refreshCartQuote() {
    if (!ui) return;
    const version = ++cartQuoteVersion, userId = TTechAuth.getUser()?.id, items = ui.getCart();
    const target = $('#cart-pricing');
    if (!userId || !items.length) { target.textContent = !items.length ? 'Chọn sản phẩm để xem tổng thanh toán.' : 'Đăng nhập để kiểm tra mã khuyến mãi và tổng thanh toán.'; return; }
    target.textContent = 'Đang tính tổng thanh toán…';
    try {
      const value = await request('/orders/quote',{method:'POST',body:{items,couponCode:couponCode()}});
      if (version !== cartQuoteVersion || TTechAuth.getUser()?.id !== userId) return;
      target.innerHTML = totalsMarkup(value);
    } catch (error) {
      if (version !== cartQuoteVersion || TTechAuth.getUser()?.id !== userId) return;
      if (error.fields?.couponCode) {
        setCoupon(''); await refreshCartQuote();
        if (TTechAuth.getUser()?.id === userId) ui.notify(error.message + ' Đã bỏ mã; vui lòng kiểm tra lại tổng tiền.');
      } else target.textContent = error.message;
    }
  }
  async function openCoupons(fromCart) {
    if (busy) return;
    const hash = location.hash;
    await TTechAuth.requireLogin(async user => {
      if (hash !== location.hash || busy) return;
      if (!ui.getCart().length) { ui.notify('Vui lòng chọn sản phẩm trước khi áp dụng mã.'); return; }
      if (fromCart) ui.openCart();
      const dialog = $('#coupon-modal'), version = ++promotionVersion;
      ui.openModal(dialog);
      $('#coupon-code').value = couponCode();
      $('#coupon-code').focus();
      $('#coupon-message').textContent = 'Đang kiểm tra ưu đãi…';
      $('#coupon-list').replaceChildren();
      $('#coupon-remove').hidden = !couponCode();
      try {
        const value = await request('/orders/quote',{method:'POST',body:{items:ui.getCart()}});
        if (version !== promotionVersion || !dialog.open || TTechAuth.getUser()?.id !== user.id) return;
        $('#coupon-message').textContent = value.coupons?.length ? 'Mỗi đơn áp dụng một mã. Ưu đãi được kiểm tra lại khi đặt hàng.' : 'Hiện chưa có mã khuyến mãi khả dụng.';
        $('#coupon-list').innerHTML = (value.coupons || []).map(coupon => `<article class="payment-description"><h3>${escape(coupon.code)}</h3><p>${coupon.type === 'percent' ? 'Giảm '+coupon.value+'%' : coupon.type === 'shipping' ? 'Ưu đãi phí vận chuyển' : 'Giảm '+money(coupon.value)}${coupon.maxDiscount !== undefined ? ' · tối đa '+money(coupon.maxDiscount) : ''}${coupon.minSubtotal ? ' · đơn từ '+money(coupon.minSubtotal) : ''}</p>${coupon.expiresAt ? `<p>Hạn dùng: ${escape(new Date(coupon.expiresAt).toLocaleString('vi-VN'))}</p>` : ''}<p>${escape(coupon.reason || 'Giảm thêm '+money(coupon.discount))}</p><button type="button" class="btn btn-secondary" data-coupon-select="${escape(coupon.code)}" ${coupon.eligible ? '' : 'disabled'}>Áp dụng mã</button></article>`).join('');
      } catch (error) { if (version === promotionVersion && dialog.open && TTechAuth.getUser()?.id === user.id) $('#coupon-message').textContent = error.message; }
    });
  }
  async function applyCoupon(code) {
    const version = ++promotionVersion, userId = TTechAuth.getUser()?.id, items = ui.getCart(), dialog = $('#coupon-modal');
    $('#coupon-apply').disabled = true;
    $('#coupon-remove').disabled = true;
    $('#coupon-message').textContent = 'Đang kiểm tra mã…';
    try {
      const value = await request('/orders/quote',{method:'POST',body:{items,couponCode:code}});
      if (version !== promotionVersion || !dialog.open || TTechAuth.getUser()?.id !== userId) return;
      if (JSON.stringify(items) !== JSON.stringify(ui.getCart())) throw new Error('Giỏ hàng đã thay đổi. Vui lòng áp dụng lại mã.');
      setCoupon(value.coupon?.code || '');
      ui.closeModal(dialog);
      if (route === '#checkout') await refreshQuote();
      await refreshCartQuote();
      ui.notify(value.coupon ? 'Đã áp dụng mã '+value.coupon.code+'.' : 'Đã bỏ mã khuyến mãi.');
    } catch (error) { if (version === promotionVersion && dialog.open && TTechAuth.getUser()?.id === userId) $('#coupon-message').textContent = error.message; }
    finally { if (version === promotionVersion) { $('#coupon-apply').disabled = false; $('#coupon-remove').disabled = false; } }
  }

  function savePending() {
    try { sessionStorage.setItem(pendingKey, JSON.stringify(pending)); }
    catch { ui.notify('Trình duyệt không cho lưu phiên. Hãy giữ trang này mở trong lúc đặt hàng.'); }
  }
  function checkoutError(message, action = 'quote') {
    const output = $('#checkout-message');
    if (!output) return;
    output.textContent = message + ' ';
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'text-action'; button.dataset.commerceAction = action;
    button.textContent = action === 'retry' ? 'Đăng nhập / Thử lại' : 'Cập nhật đơn hàng';
    output.append(button);
  }
  function notice(message, action = 'retry') {
    view().innerHTML = `<section class="commerce-state"><h1>${escape(message)}</h1><p>Giỏ hàng của bạn vẫn được giữ nguyên.</p><button type="button" class="btn btn-primary" data-commerce-action="${action}">Thử lại</button> <a href="#products" class="btn btn-secondary">Tiếp tục mua sắm</a></section>`;
  }
  function empty() {
    quote = null;
    view().innerHTML = '<section id="checkout-empty" class="commerce-state"><h1>Giỏ hàng của bạn đang trống.</h1><p>Chọn laptop phù hợp trước khi thanh toán.</p><a href="#products" class="btn btn-primary">Quay lại mua sắm</a></section>';
  }
  function imagePath(value) {
    try {
      const url = new URL(String(value || '').replace(/^\.\.\/images\//i, './assets/images/'), document.baseURI);
      if (value && ['http:','https:'].includes(url.protocol)) return url.href;
    } catch { /* Local placeholder for invalid/missing image references. */ }
    return './assets/images/laptop-placeholder.svg';
  }
  function itemsMarkup(items) {
    return `<ul class="checkout-items">${items.map(item => `<li><img src="${escape(imagePath(item.image))}" alt="${escape(item.name)}" width="76" height="64"><section><h3>${escape(item.name)}</h3>${item.variant ? `<p>${escape(item.variant)}</p>` : ''}<p>Mã: ${escape(item.productId)} · ${money(item.price)} × ${item.quantity}</p><strong>${money(item.subtotal)}</strong></section></li>`).join('')}</ul>`;
  }
  function totalsMarkup(value, checkout = false) {
    return `<dl class="checkout-totals"><div><dt>Số lượng sản phẩm</dt><dd>${value.items.reduce((sum,item)=>sum+item.quantity,0)}</dd></div><div><dt>Tổng tiền hàng</dt><dd>${money(value.originalSubtotal ?? value.subtotal)}</dd></div><div><dt>Giảm giá trực tiếp</dt><dd>−${money(value.productDiscount || 0)}</dd></div><div><dt>Phí vận chuyển</dt><dd>${value.shippingFee ? money(value.shippingFee) : 'Miễn phí'}</dd></div><div><dt>Mã khuyến mãi${value.coupon ? ' · '+escape(value.coupon.code) : ''}</dt><dd>−${money(value.discount)}</dd></div><div class="total"><dt>Tổng thanh toán</dt><dd${checkout ? ' id="checkout-total"' : ''}>${money(value.total)}</dd></div><div><dt>Bạn tiết kiệm</dt><dd>${money((value.productDiscount || 0)+value.discount)}</dd></div></dl>`;
  }
  function customerValues() { return Object.fromEntries(fieldNames.map(name => [name, $('#shipping-' + name)?.value.trim() || ''])); }
  function fieldError(name, value) {
    const limits = {fullName:80,phone:20,email:254,province:100,district:100,ward:100,address:300,note:1000};
    if (!['email','note'].includes(name) && !value.trim()) return 'Vui lòng nhập ' + labels[name].toLowerCase() + '.';
    if (name === 'fullName' && value.trim().length < 2) return 'Họ tên cần có ít nhất 2 ký tự.';
    if (name === 'phone' && !/^0[35789]\d{8}$/.test(value.replace(/[\s.-]/g,'').replace(/^\+84/,'0'))) return 'Số điện thoại Việt Nam không hợp lệ.';
    if (name === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Email không hợp lệ.';
    return value.length > limits[name] ? 'Thông tin quá dài.' : '';
  }
  function showFieldError(name, message) {
    const input = $('#shipping-' + name), output = $('#shipping-' + name + '-error');
    if (!input || !output) return;
    input.setAttribute('aria-invalid', String(Boolean(message))); output.textContent = message; output.hidden = !message;
  }
  function validate(reveal = false) {
    const values = customerValues();
    let first = '';
    fieldNames.forEach(name => { const error = fieldError(name, values[name]); if (reveal) showFieldError(name, error); if (error && !first) first = name; });
    if (first && reveal) $('#shipping-' + first).focus();
    return !first;
  }
  function payment() { return $('[name="paymentMethod"]:checked')?.value || ''; }
  function updateReview() {
    if (!$('#checkout-form')) return;
    const values = customerValues();
    $('#review-customer').textContent = [values.fullName,values.phone,values.email,[values.address,values.ward,values.district,values.province].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || 'Điền thông tin nhận hàng để kiểm tra trước khi đặt.';
    $('#review-payment').textContent = paymentLabels[payment()] || 'Chưa chọn phương thức thanh toán';
    $('#place-order').disabled = busy || !quote?.items.length || !validate() || !payment() || !$('#order-confirm').checked;
  }
  function paymentDescription() {
    const method=payment();
    $('#payment-description').innerHTML=method==='cod'?'<p>Thanh toán khi nhận hàng. Đơn hàng sẽ được cửa hàng xác nhận trước khi giao.</p>':method?'<p>Chuyển khoản đến MB Bank. QR, tài khoản nhận tiền và nội dung chính xác sẽ hiển thị sau khi đơn được lưu. Chỉ thanh toán theo thông tin của đơn hàng.</p>':'<p>Chọn phương thức thanh toán đang khả dụng.</p>';
    const sender=$('#sender-bank-field');if(sender)sender.hidden=!['bank','qr'].includes(method);
  }
  function fieldMarkup(name) {
    const optional = ['email','note'].includes(name), autocomplete = {fullName:'shipping name',phone:'shipping tel',email:'shipping email',province:'shipping address-level1',district:'shipping address-level2',ward:'shipping address-level3',address:'shipping street-address',note:'off'};
    const limits = {fullName:80,phone:20,email:254,province:100,district:100,ward:100,address:300,note:1000};
    const attributes = `id="shipping-${name}" name="${name}" class="field" autocomplete="${autocomplete[name]}" maxlength="${limits[name]}" aria-describedby="shipping-${name}-error" ${optional ? '' : 'required'}`;
    return `<div class="checkout-field${['address','note'].includes(name) ? ' full' : ''}"><label for="shipping-${name}">${labels[name]}${optional ? ' <span>(không bắt buộc)</span>' : ' <span aria-hidden="true">*</span>'}</label>${name === 'note' ? `<textarea ${attributes} rows="3"></textarea>` : `<input ${attributes} type="${name === 'phone' ? 'tel' : name === 'email' ? 'email' : 'text'}">`}<p id="shipping-${name}-error" class="auth-field-error" hidden></p></div>`;
  }
  function renderCheckout() {
    view().innerHTML = `<nav class="breadcrumb" aria-label="Đường dẫn"><a href="#home">Trang chủ</a><span>/</span><a href="#products">Laptop</a><span>/</span><span aria-current="page">Thanh toán</span></nav>
      <header class="commerce-heading"><p>T-TECH / CHECKOUT</p><h1 tabindex="-1">Hoàn tất đơn hàng</h1><span>Thông tin nhận hàng → Kiểm tra → Đặt hàng</span></header>
      <form id="checkout-form" class="checkout-layout" novalidate>
        <section class="checkout-panel shipping-panel" aria-labelledby="shipping-title"><h2 id="shipping-title">Thông tin nhận hàng</h2><p class="checkout-help">Các mục có dấu * là bắt buộc.</p><div class="checkout-fields">${fieldNames.map(fieldMarkup).join('')}</div>
          <fieldset class="payment-methods"><legend>Phương thức thanh toán</legend>${Object.entries(paymentLabels).filter(([value]) => (quote.paymentMethods || {cod:true})[value]).map(([value,label]) => `<label><input type="radio" name="paymentMethod" value="${value}" required><span>${label}</span></label>`).join('')}</fieldset><label id="sender-bank-field" class="checkout-field" hidden>Ngân hàng bạn dùng để chuyển tiền<select id="sender-bank" class="field">${Object.entries({MB:'MB Bank',VCB:'Vietcombank',BIDV:'BIDV',ICB:'VietinBank',TCB:'Techcombank',ACB:'ACB',VPB:'VPBank',TPB:'TPBank',OTHER:'Ngân hàng khác'}).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select><span>Đây là ứng dụng phía người chuyển, không thay đổi tài khoản MB nhận tiền.</span></label><section id="payment-description" class="payment-description" aria-label="Thông tin phương thức thanh toán"></section>
        </section>
        <aside class="checkout-panel order-summary" aria-labelledby="summary-title"><header><h2 id="summary-title">Đơn hàng của bạn</h2><button type="button" class="text-action" data-commerce-action="cart">Sửa giỏ hàng</button></header><button type="button" class="text-action" data-coupon-open>Nhập / chọn mã khuyến mãi</button><section id="checkout-summary"></section><p class="checkout-help">Giao hàng tận nơi. Phí vận chuyển 30.000₫; miễn phí từ 20.000.000₫. Đơn giá đã gồm ưu đãi sản phẩm.</p>
          <section class="order-review" aria-labelledby="review-title"><h2 id="review-title">Kiểm tra đơn hàng</h2><p id="review-customer"></p><p id="review-payment"></p><label class="order-confirm"><input id="order-confirm" type="checkbox"><span>Tôi xác nhận thông tin đơn hàng là chính xác.</span></label><button type="submit" id="place-order" class="btn btn-primary" disabled>ĐẶT HÀNG</button><p id="checkout-message" role="status" aria-live="polite"></p><p class="checkout-help">Đơn hàng được lưu trước khi hiển thị hướng dẫn thanh toán. Chỉ thông báo từ ngân hàng đã xác thực mới cập nhật thanh toán.</p></section>
        </aside>
      </form>`;
    $('#shipping-fullName').value = account.name || ''; $('#shipping-email').value = account.email || ''; $('#shipping-phone').value = account.phone || '';
    renderSummary();
  }
  function renderSummary() {
    const methods = quote.paymentMethods || {cod:true}, chosen = payment();
    $('.payment-methods').innerHTML = '<legend>Phương thức thanh toán</legend>' + Object.entries(paymentLabels).filter(([value])=>methods[value]).map(([value,label])=>`<label><input type="radio" name="paymentMethod" value="${value}" required${chosen===value?' checked':''}><span>${label}</span></label>`).join('');
    if (!Object.values(methods).some(Boolean)) $('.payment-methods').insertAdjacentHTML('beforeend','<p>Hiện chưa có phương thức thanh toán khả dụng. Vui lòng liên hệ cửa hàng.</p>');
    $('#checkout-summary').innerHTML = itemsMarkup(quote.items) + totalsMarkup(quote, true);
    paymentDescription(); updateReview();
  }
  async function refreshQuote() {
    if (route !== '#checkout' || busy || !account) return;
    const version = generation, refresh = ++quoteVersion, items = ui.getCart();
    if (!items.length) { empty(); return; }
    quote = null;
    if ($('#order-confirm')) { $('#order-confirm').checked = false; updateReview(); }
    try {
      const value = await request('/orders/quote', {method:'POST',body:{items,couponCode:couponCode()}});
      if (!owned(version) || refresh !== quoteVersion || route !== '#checkout') return;
      quote = value;
      if ($('#checkout-form')) renderSummary(); else renderCheckout();
    } catch (error) {
      if (!owned(version) || refresh !== quoteVersion) return;
      if (error.fields?.couponCode) {
        setCoupon(''); await refreshQuote();
        if (owned(version) && $('#checkout-message')) $('#checkout-message').textContent = error.message + ' Đã bỏ mã; vui lòng xác nhận lại tổng tiền.';
        return;
      }
      if ($('#checkout-message')) { checkoutError(error.message); updateReview(); }
      else notice(error.message);
    }
  }
  async function complete(order) {
    const version = generation;
    await ui.removePurchased(order);
    delete pending[String(order.userId)]; savePending();
    if (!owned(version)) return;
    setCoupon('');
    busy = false;
    ui.notify('Đặt hàng thành công!');
    location.hash = 'order-success/' + encodeURIComponent(order.id);
  }
  async function recoverPending(version) {
    const stored = pending[String(account.id)];
    if (!stored?.key) return false;
    try {
      const data = await request('/orders/request/' + encodeURIComponent(stored.key));
      if (!owned(version)) return true;
      await complete(data.order); return true;
    } catch (error) { if (error.status === 404) return false; throw error; }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || !validate(true) || !quote || !payment() || !$('#order-confirm').checked) return;
    const version = generation, userId = String(account.id);
    busy = true; $('#checkout-form').setAttribute('aria-busy','true');
    $('#place-order').textContent = 'Đang xử lý đơn hàng...'; $('#checkout-message').textContent = '';
    $('#checkout-form').querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = true; });
    const body = {customer:customerValues(),items:quote.items.map(({productId,quantity})=>({productId,quantity})),...(quote.coupon ? {couponCode:quote.coupon.code} : {}),paymentMethod:payment(),...(['bank','qr'].includes(payment())?{senderBank:$('#sender-bank').value}:{}),confirmed:true,quoteHash:quote.quoteHash};
    try {
      if (await recoverPending(version)) return;
      if (!owned(version)) return;
      const key = pending[userId]?.key || crypto.randomUUID();
      pending[userId] = {key}; savePending();
      const data = await request('/orders', {method:'POST',body:{...body,idempotencyKey:key}});
      if (owned(version)) await complete(data.order);
    } catch (error) {
      if (!owned(version)) return;
      $('#checkout-message').textContent = error.status === 0 ? 'Không thể xác nhận kết quả đặt hàng. Vui lòng thử lại; hệ thống sẽ kiểm tra để tránh tạo đơn trùng.' : error.message;
      for (const name of fieldNames) if (error.fields?.[name]) showFieldError(name,error.fields[name]);
      if (error.fields?.couponCode) {
        setCoupon(''); busy = false; await refreshQuote();
        if (owned(version) && $('#checkout-message')) $('#checkout-message').textContent = error.message + ' Đã bỏ mã; vui lòng xác nhận lại tổng tiền.';
      }
      if (error.status === 401) { quote = null; checkoutError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.','retry'); }
      if (error.status === 409) {
        // A committed response may have been lost; look it up before changing the quote.
        if (await recoverPending(version).catch(() => false)) return;
        if (!owned(version)) return;
        busy = false; await refreshQuote();
      }
    } finally {
      if (owned(version)) busy = false;
      if (owned(version) && $('#checkout-form')) {
        $('#checkout-form').setAttribute('aria-busy','false');
        $('#checkout-form').querySelectorAll('input,textarea,select,button').forEach(element => { element.disabled = false; });
        $('#place-order').textContent = 'ĐẶT HÀNG'; updateReview();
      }
    }
  }
  function orderMarkup(order, success) {
    const c = order.customer;
    return `<header class="commerce-heading${success ? ' success-heading' : ''}">${success ? ui.icon('check') : ''}<p>T-TECH / ĐƠN HÀNG</p><h1 id="${success ? 'order-success-title' : 'order-detail-title'}" tabindex="-1">${success ? 'Đặt hàng thành công!' : 'Chi tiết đơn hàng'}</h1><span>Mã đơn hàng: ${escape(order.id)}</span><p class="order-status">${escape(statusLabels[order.status] || order.status)}</p></header><section class="order-result-layout"><section class="checkout-panel"><h2>Thông tin nhận hàng</h2><dl class="order-customer">${[['Người nhận',c.fullName],['Số điện thoại',c.phone],['Email',c.email],['Địa chỉ',[c.address,c.ward,c.district,c.province].join(', ')],['Ghi chú',c.note],['Ngày đặt',new Date(order.createdAt).toLocaleString('vi-VN')],['Thanh toán',paymentLabels[order.paymentMethod]]].filter(([,value])=>value).map(([label,value])=>`<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl></section><section class="checkout-panel"><h2>Sản phẩm đã đặt</h2>${itemsMarkup(order.items)}${totalsMarkup(order)}</section></section><section id="order-payment" class="checkout-panel" aria-label="Thông tin thanh toán"></section><nav class="order-actions" aria-label="Thao tác đơn hàng">${success ? `<a id="view-order" class="btn btn-primary" href="#order/${encodeURIComponent(order.id)}">Xem đơn hàng</a>` : '<a id="all-orders" class="btn btn-primary" href="#orders">Lịch sử đơn hàng</a>'}<a class="btn btn-secondary" href="#products">Tiếp tục mua sắm</a></nav>`;
  }
  async function renderRoute(hash, productsReady = true) {
    if (route !== hash && $('#coupon-modal').open) { promotionVersion++; ui.closeModal($('#coupon-modal')); }
    if (route !== hash) TTechPayments.reset();
    if (!isRoute(hash)) { route = ''; account = null; generation++; view().replaceChildren(); return; }
    if (hash === '#checkout' && !productsReady) { view().innerHTML = '<section class="commerce-state"><h1>Thanh toán</h1><p>Đang chờ dữ liệu giỏ hàng.</p><button type="button" class="btn btn-secondary" data-commerce-action="products">Tải lại sản phẩm</button></section>'; return; }
    if (route === hash) return;
    route = hash; const version = ++generation;
    window.scrollTo({top:0,behavior:'instant'});
    busy = false; quote = null;
    view().innerHTML = '<section class="commerce-state"><h1>Đơn hàng của bạn</h1><p role="status">Đang tải...</p><button type="button" class="btn btn-secondary" data-commerce-action="retry">Đăng nhập / Thử lại</button></section>';
    document.title = (hash === '#checkout' ? 'Thanh toán' : 'Đơn hàng') + ' | T-TECH';
    await TTechAuth.requireLogin(async user => {
      if (version !== generation || location.hash !== hash) return;
      account = user;
      try {
        if (hash === '#checkout') { if (!await recoverPending(version)) await refreshQuote(); }
        else if (hash === '#orders') {
          const data = await request('/orders'); if (!owned(version)) return;
          view().innerHTML = `<header class="commerce-heading"><p>T-TECH / TÀI KHOẢN</p><h1>Lịch sử đơn hàng</h1><span>Các đơn hàng của bạn được lưu theo tài khoản.</span></header><section class="order-history" aria-label="Danh sách đơn hàng">${data.orders.length ? data.orders.map(order=>`<article class="checkout-panel order-history-card"><header><h2>${escape(order.id)}</h2><span class="order-status">${escape(statusLabels[order.status] || order.status)}</span></header><p>${escape(new Date(order.createdAt).toLocaleString('vi-VN'))}</p>${itemsMarkup(order.items)}<footer><strong>${money(order.total)}</strong><a class="btn btn-secondary" href="#order/${encodeURIComponent(order.id)}">Xem chi tiết</a></footer></article>`).join('') : '<p>Bạn chưa có đơn hàng nào. <a class="text-action" href="#products">Khám phá laptop</a></p>'}</section>`;
        } else {
          const id = decodeURIComponent(hash.slice(hash.indexOf('/')+1));
          const data = await request('/orders/' + encodeURIComponent(id)); if (!owned(version)) return;
          view().innerHTML = orderMarkup(data.order,hash.startsWith('#order-success/'));
          TTechPayments.mount(data.order);
        }
        view().querySelector('h1')?.focus({preventScroll:true});
      } catch (error) { if (owned(version)) notice(error.message); }
    });
  }
  function init(helpers) {
    ui = helpers; TTechPayments.init(helpers);
    document.addEventListener('click',event => {
      const opener = event.target.closest('[data-coupon-open]');
      if (opener) openCoupons(Boolean(opener.closest('#cart-modal')));
      const selection = event.target.closest('[data-coupon-select]');
      if (selection) { $('#coupon-code').value = selection.dataset.couponSelect; applyCoupon(selection.dataset.couponSelect); }
    });
    $('#coupon-form').addEventListener('submit',event => { event.preventDefault(); if (!$('#coupon-apply').disabled) applyCoupon($('#coupon-code').value.trim().toUpperCase()); });
    $('#coupon-remove').addEventListener('click',()=>applyCoupon(''));
    $('#coupon-modal').addEventListener('close',()=>{ promotionVersion++; $('#coupon-apply').disabled=false; $('#coupon-remove').disabled=false; });
    view().addEventListener('submit',event => { if (event.target.id === 'checkout-form') submit(event); });
    view().addEventListener('input',event => {
      if (event.target.name && fieldNames.includes(event.target.name)) {
        if (event.target.getAttribute('aria-invalid') === 'true') showFieldError(event.target.name,fieldError(event.target.name,event.target.value.trim()));
        if ($('#order-confirm')) $('#order-confirm').checked = false;
      }
      updateReview();
    });
    view().addEventListener('focusout',event => {
      if (fieldNames.includes(event.target.name) && !event.relatedTarget?.closest('button')) showFieldError(event.target.name,fieldError(event.target.name,event.target.value.trim()));
    });
    view().addEventListener('change',event => { if (event.target.name === 'paymentMethod') paymentDescription(); updateReview(); });
    view().addEventListener('click',event => {
      const action = event.target.closest('[data-commerce-action]')?.dataset.commerceAction;
      if (action === 'cart') ui.openCart();
      if (action === 'products') ui.reloadProducts();
      if (action === 'quote') refreshQuote();
      if (action === 'retry') { route = ''; renderRoute(location.hash); }
    });
    document.addEventListener('ttech:cart-change',() => { if (route === '#checkout' && !busy) refreshQuote(); });
    document.addEventListener('ttech:auth-change',event => {
      if (promotion && event.detail?.id !== promotion.userId) setCoupon('');
      promotionVersion++; cartQuoteVersion++;
      if ($('#coupon-modal').open) $('#coupon-modal').close();
      $('#cart-pricing').textContent = '';
      if (account && event.detail?.id !== account.id) {
        generation++; account = null; quote = null; busy = false; route = '';
        if (isRoute(location.hash)) notice('Vui lòng đăng nhập để xem đơn hàng của bạn.');
      }
    });
  }
  window.TTechCheckout = Object.freeze({init,renderRoute,isRoute,refreshCartQuote});
})();
