'use strict';
const { randomUUID, createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SHIPPING_FEE = 30000, FREE_SHIPPING_AT = 20000000;

// All checkout prices and totals originate here, never from the DOM/request totals.
module.exports = function orderRoutes({ db, currentUser, send, readBody, ApiError, payments, promotions }) {
  function normalizeItems(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new ApiError(400, 'Giỏ hàng của bạn đang trống hoặc không hợp lệ.');
    const seen = new Set();
    return rows.map(row => {
      if (!row || !['string', 'number'].includes(typeof row.productId) || !String(row.productId).trim() ||
          !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 99 || seen.has(String(row.productId))) {
        throw new ApiError(400, 'Sản phẩm hoặc số lượng không hợp lệ.');
      }
      const productId = String(row.productId); seen.add(productId);
      return { productId, quantity: row.quantity };
    }).sort((a, b) => a.productId.localeCompare(b.productId));
  }

  function quote(data, rows, user, couponCode) {
    const items = normalizeItems(rows).map(({ productId, quantity }) => {
      const product = data.products.find(p => String(p.id) === productId);
      if (!product) throw new ApiError(409, 'Một sản phẩm không còn tồn tại. Vui lòng cập nhật giỏ hàng.');
      if (product.stock !== undefined && (!Number.isInteger(product.stock) || product.stock < quantity)) throw new ApiError(409, 'Số lượng vượt quá tồn kho. Vui lòng cập nhật giỏ hàng.');
      const price = typeof product.sale_price === 'number' && product.sale_price >= 0 && product.sale_price < product.price ? product.sale_price : product.price;
      if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(price * quantity)) throw new ApiError(409, 'Giá sản phẩm chưa hợp lệ. Vui lòng liên hệ hỗ trợ.');
      if (!Number.isSafeInteger(product.price) || product.price < 0 || !Number.isSafeInteger(product.price * quantity)) throw new ApiError(409, 'Giá sản phẩm chưa hợp lệ.');
      return { productId, name: product.name, image: product.image || '', ...(typeof product.variant === 'string' ? { variant: product.variant } : {}), originalPrice:product.price, price, quantity, subtotal: price * quantity };
    });
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const originalSubtotal = items.reduce((sum,item) => sum + item.originalPrice * item.quantity,0);
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(originalSubtotal)) throw new ApiError(400, 'Tổng tiền vượt quá giới hạn cho phép.');
    const shippingFee = subtotal >= FREE_SHIPPING_AT ? 0 : SHIPPING_FEE;
    const {discount,coupon} = promotions.apply(data,user,items,subtotal,shippingFee,couponCode);
    const total = subtotal + shippingFee - discount;
    if (!Number.isSafeInteger(total) || total < 0) throw new ApiError(400, 'Tổng tiền vượt quá giới hạn cho phép.');
    const result = { items, subtotal, originalSubtotal, productDiscount:originalSubtotal-subtotal, shippingFee, discount, coupon, total };
    return { ...result, quoteHash: hash(result), freeShippingAt: FREE_SHIPPING_AT };
  }

  function customerInput(value) {
    const customer = {}, fields = {};
    const limits = { fullName: 80, phone: 20, email: 254, province: 100, district: 100, ward: 100, address: 300, note: 1000 };
    for (const [field, limit] of Object.entries(limits)) {
      const text = typeof value?.[field] === 'string' ? value[field].trim() : '';
      customer[field] = text;
      if (text.length > limit) fields[field] = 'Thông tin quá dài.';
      if (!['email', 'note'].includes(field) && !text) fields[field] = 'Vui lòng nhập thông tin này.';
    }
    if (customer.fullName.length < 2) fields.fullName = 'Họ tên cần có ít nhất 2 ký tự.';
    customer.phone = customer.phone.replace(/[\s.-]/g, '').replace(/^\+84/, '0');
    if (!/^0[35789]\d{8}$/.test(customer.phone)) fields.phone = 'Số điện thoại Việt Nam không hợp lệ.';
    customer.email = customer.email.toLowerCase();
    if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) fields.email = 'Email không hợp lệ.';
    if (Object.keys(fields).length) throw new ApiError(400, 'Vui lòng kiểm tra thông tin nhận hàng.', fields);
    return customer;
  }

  function publicOrder(order) {
    const { requestHash, idempotencyKey, ...value } = order;
    if (value.payment) value.payment = { ...value.payment, available: payments.available().bank };
    return value;
  }

  return async function handle(request, response, pathname) {
    if (!/^\/api\/orders(?:\/|$)/.test(pathname)) return false;
    const data = await db.read(), user = currentUser(data, request);
    if (request.method === 'GET') {
      const owned = data.orders.filter(order => String(order.userId) === String(user.id));
      if (pathname === '/api/orders') { send(response, 200, { orders: owned.slice().reverse().map(publicOrder) }); return true; }
      const recovery = pathname.startsWith('/api/orders/request/');
      const identifier = decodeURIComponent(pathname.slice(recovery ? 20 : 12));
      const order = owned.find(order => recovery ? order.idempotencyKey === identifier : order.id === identifier);
      if (!order) throw new ApiError(404, 'Không tìm thấy đơn hàng.');
      send(response, 200, { order: publicOrder(order) }); return true;
    }
    if (request.method !== 'POST') throw new ApiError(405, 'Thao tác không được hỗ trợ.');
    const body = await readBody(request);
    if (pathname === '/api/orders/quote') {
      const result = quote(data,body.items,user,body.couponCode);
      send(response,200,{...result,coupons:promotions.list(data,user,result.items,result.subtotal,result.shippingFee),paymentMethods:payments.available()}); return true;
    }
    if (pathname !== '/api/orders') throw new ApiError(404, 'Không tìm thấy chức năng yêu cầu.');
    if (body.confirmed !== true) throw new ApiError(400, 'Vui lòng xác nhận thông tin đơn hàng.');
    if (!['cod', 'bank', 'qr'].includes(body.paymentMethod)) throw new ApiError(400, 'Vui lòng chọn phương thức thanh toán.');
    if (typeof body.idempotencyKey !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(body.idempotencyKey)) throw new ApiError(400, 'Mã yêu cầu đặt hàng không hợp lệ.');
    const customer = customerInput(body.customer), items = normalizeItems(body.items);
    const couponCode = promotions.normalize(body.couponCode);
    const requestHash = hash({ customer, items, paymentMethod: body.paymentMethod, quoteHash: body.quoteHash, senderBank: body.senderBank, ...(couponCode ? {couponCode} : {}) });
    const result = await db.update(latest => {
      const current = currentUser(latest, request);
      const existing = latest.orders.find(order => String(order.userId) === String(current.id) && order.idempotencyKey === body.idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, 'Yêu cầu này đã tạo một đơn hàng. Vui lòng kiểm tra lịch sử.');
        return { order: publicOrder(existing), replayed: true };
      }
      const priced = quote(latest, items, current, couponCode);
      if (body.quoteHash !== priced.quoteHash) throw new ApiError(409, 'Giá hoặc thông tin sản phẩm đã thay đổi. Vui lòng cập nhật và xác nhận lại đơn hàng.');
      const { quoteHash, freeShippingAt, ...totals } = priced;
      const order = { id: 'ORD-' + randomUUID().toUpperCase(), userId: current.id, createdAt: new Date().toISOString(), customer, ...totals,
        paymentMethod: body.paymentMethod, paymentStatus: 'unpaid', status: 'pending', idempotencyKey: body.idempotencyKey, requestHash };
      payments.initialize(order, body);
      for (const item of items) {
        const product = latest.products.find(p => String(p.id) === item.productId);
        if (product.stock !== undefined) product.stock -= item.quantity;
      }
      latest.orders.push(order);
      return { order: publicOrder(order), replayed: false };
    });
    send(response, result.replayed ? 200 : 201, result);
    return true;
  };
};
