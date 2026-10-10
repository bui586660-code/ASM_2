'use strict';

// Promotion rules are operator-owned; browsers submit only a code.
module.exports = function promotions(configuration, ApiError) {
  if (!configuration || !Array.isArray(configuration.coupons)) throw Error('Invalid promotion configuration');
  const rules = structuredClone(configuration.coupons), seen = new Set();
  for (const rule of rules) {
    if (!rule || typeof rule.code !== 'string' || !/^[A-Z0-9_-]{1,40}$/.test(rule.code) || seen.has(rule.code) ||
        typeof rule.active !== 'boolean' || !['fixed','percent','shipping'].includes(rule.type)) throw Error('Invalid coupon rule');
    seen.add(rule.code);
    for (const key of ['value','minSubtotal','maxDiscount','maxUses','perUserLimit']) {
      if (rule[key] !== undefined && (!Number.isSafeInteger(rule[key]) || rule[key] < 0)) throw Error('Invalid coupon '+key);
    }
    if (rule.type !== 'shipping' && (!rule.value || (rule.type === 'percent' && rule.value > 100))) throw Error('Invalid coupon value');
    for (const key of ['startsAt','expiresAt']) if (rule[key] !== undefined && (typeof rule[key] !== 'string' || !Number.isFinite(Date.parse(rule[key])))) throw Error('Invalid coupon date');
    if (rule.startsAt && rule.expiresAt && Date.parse(rule.startsAt) >= Date.parse(rule.expiresAt)) throw Error('Invalid coupon period');
    if (rule.productIds !== undefined && (!Array.isArray(rule.productIds) || !rule.productIds.length || rule.productIds.some(id => typeof id !== 'string' || !id.trim()))) throw Error('Invalid coupon products');
  }
  function normalize(code) {
    if (code === undefined || code === '') return '';
    if (typeof code !== 'string' || !/^[A-Z0-9_-]{1,40}$/.test(code.trim().toUpperCase())) throw new ApiError(400, 'Mã khuyến mãi không hợp lệ.', {couponCode:'Vui lòng kiểm tra mã khuyến mãi.'});
    return code.trim().toUpperCase();
  }
  function active(rule) {
    const now = Date.now();
    return rule.active && (!rule.startsAt || now >= Date.parse(rule.startsAt)) && (!rule.expiresAt || now < Date.parse(rule.expiresAt));
  }
  function evaluate(rule, data, user, items, subtotal, shippingFee) {
    const used = data.orders.filter(order => order.coupon?.code === rule.code);
    const eligible = items.filter(item => !rule.productIds || rule.productIds.includes(item.productId)).reduce((sum,item) => sum + item.subtotal, 0);
    let reason = '';
    if (!active(rule)) reason = 'Mã khuyến mãi chưa có hiệu lực hoặc đã hết hạn.';
    else if (rule.maxUses !== undefined && used.length >= rule.maxUses) reason = 'Mã khuyến mãi đã hết lượt sử dụng.';
    else if (rule.perUserLimit !== undefined && used.filter(order => String(order.userId) === String(user.id)).length >= rule.perUserLimit) reason = 'Bạn đã dùng hết lượt của mã khuyến mãi này.';
    else if (subtotal < (rule.minSubtotal || 0)) reason = 'Đơn hàng chưa đạt giá trị tối thiểu của mã khuyến mãi.';
    else if (!eligible) reason = 'Mã khuyến mãi không áp dụng cho sản phẩm đã chọn.';
    const raw = rule.type === 'shipping' ? shippingFee : rule.type === 'fixed' ? rule.value : Number(BigInt(eligible) * BigInt(rule.value) / 100n);
    const discount = Math.min(raw, rule.maxDiscount ?? raw, rule.type === 'shipping' ? shippingFee : eligible);
    if (!reason && !discount) reason = 'Đơn hàng không có khoản giảm thêm từ mã này.';
    return {discount, reason};
  }
  function snapshot(rule) {
    return Object.fromEntries(['code','type','value','minSubtotal','maxDiscount','startsAt','expiresAt','productIds','maxUses','perUserLimit'].filter(key => rule[key] !== undefined).map(key => [key,rule[key]]));
  }
  return {
    normalize,
    apply(data, user, items, subtotal, shippingFee, input) {
      const code = normalize(input);
      if (!code) return {discount:0,coupon:null};
      const rule = rules.find(item => item.code === code);
      const result = rule && evaluate(rule,data,user,items,subtotal,shippingFee);
      if (!result || result.reason) throw new ApiError(400, result?.reason || 'Mã khuyến mãi không tồn tại.', {couponCode:result?.reason || 'Mã khuyến mãi không tồn tại.'});
      return {discount:result.discount,coupon:{...snapshot(rule),discount:result.discount}};
    },
    list(data,user,items,subtotal,shippingFee) {
      return rules.filter(active).map(rule => {
        const result = evaluate(rule,data,user,items,subtotal,shippingFee);
        return {...snapshot(rule),eligible:!result.reason,reason:result.reason,discount:result.reason ? 0 : result.discount};
      });
    }
  };
};
