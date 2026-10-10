/* Authentication uses the existing dialogs. Passwords/tokens never enter browser storage. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const fields = ['name', 'email', 'password', 'confirm'];
  const api = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://' + location.hostname + ':3000/api' : location.origin + '/api';
  let ui, user = null, mode = 'login', busy = false, pendingAction = null;
  let formController, refreshPromise, revision = 0, loggingOut = false;
  const touched = new Set();
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('ttech-auth') : null;

  class AuthError extends Error {
    constructor(message, status = 0, fields = {}) { super(message); this.status = status; this.fields = fields; }
  }

  async function request(route, { method = 'GET', body, signal } = {}) {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const response = await fetch(api + route, {
        method, credentials: 'include', cache: 'no-store', signal: controller.signal,
        ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      });
      let data;
      try { data = await response.json(); }
      catch { throw new AuthError('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.'); }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new AuthError('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.');
      if (!response.ok) {
        const messages = { 401: 'Email hoặc mật khẩu không chính xác.', 403: 'Bạn không có quyền truy cập chức năng này.',
          404: 'Dịch vụ tài khoản chưa sẵn sàng. Vui lòng thử lại.', 409: 'Email này đã được đăng ký.',
          429: 'Bạn thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.' };
        const orderMessage = (route.startsWith('/orders') || route.startsWith('/admin/payments')) && [400,401,404,409,503].includes(response.status) && typeof data.message === 'string' ? data.message : null;
        throw new AuthError(orderMessage || messages[response.status] || 'Không thể xử lý yêu cầu. Vui lòng thử lại.', response.status,
          response.status === 400 || response.status === 409 ? data.fields : {});
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (error instanceof AuthError) throw error;
      throw new AuthError(timedOut ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.' : 'Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  function parseUser(data, allowGuest = false) {
    if (allowGuest && data.user === null) return null;
    const value = data.user;
    if (!value || !['string', 'number'].includes(typeof value.id) || typeof value.name !== 'string' ||
      typeof value.email !== 'string' || !['user', 'admin'].includes(value.role) || value.status !== 'active') {
      throw new AuthError('Máy chủ trả về dữ liệu tài khoản không hợp lệ. Vui lòng thử lại.');
    }
    const { id, name, email, role, status, phone } = value;
    return { id, name, email, role, status, ...(typeof phone === 'string' ? { phone } : {}) };
  }

  function setMenu(open) {
    $('#account-menu').hidden = !open;
    $('#auth-open').setAttribute('aria-expanded', String(open));
  }

  function setUser(value) {
    const changed = JSON.stringify(user) !== JSON.stringify(value);
    user = value;
    $('#account-name').textContent = user ? user.name : 'Đăng nhập / Đăng ký';
    $('#auth-open').setAttribute('aria-label', user ? 'Tài khoản: ' + user.name : 'Đăng nhập / Đăng ký');
    $('#auth-open').setAttribute('aria-haspopup', user ? 'true' : 'dialog');
    $('#account-admin').hidden = user?.role !== 'admin';
    if (!user) {
      setMenu(false);
      if ($('#account-modal').open) ui.closeModal($('#account-modal'));
      ['name', 'email', 'phone', 'role', 'status'].forEach(field => { $('#profile-' + field).textContent = ''; });
      $('#admin-summary').hidden = true;
      $('#admin-feedback').textContent = '';
    }
    if (changed) document.dispatchEvent(new CustomEvent('ttech:auth-change', { detail: user }));
  }

  function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      let value, version;
      do {
        version = revision;
        value = parseUser(await request('/auth/session'), true);
        // Login/logout in another tab invalidates any response already in flight.
      } while (version !== revision);
      if (!busy) setUser(value);
      return value;
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  }

  function feedback(message = '', error = false) {
    $('#auth-feedback').textContent = message;
    $('#auth-feedback').classList.toggle('auth-error', error);
  }

  function showFieldError(name, message) {
    const input = $('#auth-' + name), output = $('#auth-' + name + '-error');
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', String(Boolean(message)));
    input.dataset.valid = String(!message && Boolean(input.value));
    output.textContent = message;
    output.hidden = !message;
  }

  function validate(name) {
    const input = $('#auth-' + name);
    if (input.disabled) return true;
    const value = input.value;
    let message = '';
    if (name === 'name' && !value.trim()) message = 'Vui lòng nhập họ tên.';
    if (name === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) message = 'Email không hợp lệ.';
    if (name === 'password' && value.length < 8) message = 'Mật khẩu phải có ít nhất 8 ký tự.';
    if (name === 'confirm' && (!value || value !== $('#auth-password').value)) message = 'Mật khẩu xác nhận không khớp.';
    const maximum = name === 'name' ? 80 : name === 'email' ? 254 : 128;
    if (value.trim().length > maximum) message = 'Thông tin vượt quá độ dài cho phép (' + maximum + ' ký tự).';
    showFieldError(name, message);
    return !message;
  }

  function resetVisibility() {
    for (const [inputId, buttonId, label] of [['auth-password', 'password-toggle', 'mật khẩu'], ['auth-confirm', 'confirm-toggle', 'mật khẩu xác nhận']]) {
      $('#' + inputId).type = 'password';
      $('#' + buttonId).textContent = 'Hiện';
      $('#' + buttonId).setAttribute('aria-label', 'Hiện ' + label);
      $('#' + buttonId).setAttribute('aria-pressed', 'false');
    }
  }

  function setBusy(value) {
    busy = value;
    $('#auth-form').setAttribute('aria-busy', String(value));
    $('#auth-submit').textContent = value ? (mode === 'register' ? 'Đang đăng ký...' : 'Đang đăng nhập...') : (mode === 'register' ? 'Đăng ký tài khoản' : 'Đăng nhập');
    $('#auth-submit').disabled = value;
    for (const field of fields) $('#auth-' + field).disabled = value || (mode === 'login' && ['name', 'confirm'].includes(field));
    document.querySelectorAll('[data-auth-mode],#password-toggle,#confirm-toggle').forEach(button => { button.disabled = value; });
  }

  function setMode(next) {
    mode = next;
    $('#auth-form').reset();
    touched.clear(); feedback(); resetVisibility();
    const register = mode === 'register';
    $('#auth-title').textContent = register ? 'Tạo tài khoản' : 'Đăng nhập';
    $('#name-field').hidden = !register; $('#confirm-field').hidden = !register;
    $('#auth-name').required = register; $('#auth-confirm').required = register;
    $('#auth-password').autocomplete = register ? 'new-password' : 'current-password';
    fields.forEach(name => { showFieldError(name, ''); $('#auth-' + name).dataset.valid = 'false'; });
    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      const active = button.dataset.authMode === mode;
      button.setAttribute('aria-pressed', String(active));
      ['bg-white', 'text-red-600', 'shadow-xs'].forEach(className => button.classList.toggle(className, active));
      button.classList.toggle('text-slate-500', !active);
    });
    setBusy(false);
  }

  function show(next = 'login', preserveAction = false) {
    if (!preserveAction) pendingAction = null;
    setMenu(false);
    document.querySelectorAll('dialog[open]').forEach(dialog => { if (dialog.id !== 'auth-modal') dialog.close(); });
    setMode(next);
    ui.openModal($('#auth-modal'));
    $(next === 'register' ? '#auth-name' : '#auth-email').focus();
  }

  async function requireLogin(action) {
    // refresh() deduplicates authorization; unrelated route callbacks must not block one another.
    try {
      const current = await refresh();
      if (current) { await action(current); return; }
      pendingAction = action;
      show('login', true);
      feedback('Vui lòng đăng nhập để tiếp tục thao tác của bạn.');
    } catch (error) {
      pendingAction = action;
      show('login', true);
      feedback(error.message, true);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    $('#auth-email').value = $('#auth-email').value.trim().toLowerCase();
    $('#auth-name').value = $('#auth-name').value.trim();
    const results = fields.map(name => { touched.add(name); return validate(name); });
    if (results.includes(false)) { $('#auth-' + fields[results.indexOf(false)]).focus(); return; }
    const email = $('#auth-email').value;
    const payload = { email, password: $('#auth-password').value };
    if (mode === 'register') Object.assign(payload, { name: $('#auth-name').value, confirm: $('#auth-confirm').value });
    const submittedMode = mode;
    formController = new AbortController();
    const controller = formController;
    revision++; feedback(); setBusy(true);
    try {
      const data = await request('/auth/' + submittedMode, { method: 'POST', body: payload, signal: controller.signal });
      const account = parseUser(data);
      if (submittedMode === 'register') {
        setMode('login'); $('#auth-email').value = email;
        feedback('Đăng ký thành công. Vui lòng đăng nhập để tiếp tục.');
        $('#auth-password').focus();
      } else {
        revision++; setUser(account); channel?.postMessage('changed');
        const action = pendingAction; pendingAction = null;
        $('#auth-modal').addEventListener('close', () => {
          ui.notify('Đăng nhập thành công.');
          if (action) Promise.resolve().then(() => action(account)).catch(error => ui.notify(error.message));
        }, { once: true });
        ui.closeModal($('#auth-modal'));
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      feedback(error.message, true);
      for (const name of fields) if (typeof error.fields?.[name] === 'string') showFieldError(name, error.fields[name]);
      // No password/email/body in diagnostic output.
      console.warn('Authentication request rejected:', error.status || 'network/response');
    } finally {
      if (formController === controller) { formController = null; setBusy(false); }
    }
  }

  async function logout() {
    if (loggingOut) return;
    loggingOut = true;
    $('#account-logout').disabled = true; $('#profile-logout').disabled = true;
    try {
      await request('/auth/logout', { method: 'POST', body: {} });
      revision++; pendingAction = null; setUser(null); channel?.postMessage('changed');
      ui.notify('Đăng xuất thành công.');
    } catch (error) { ui.notify(error.message); $('#account-feedback').textContent = error.message; }
    finally { loggingOut = false; $('#account-logout').disabled = false; $('#profile-logout').disabled = false; }
  }

  function profile(admin = false) {
    return requireLogin(async () => {
      const account = parseUser(await request('/auth/me'));
      setUser(account); setMenu(false);
      $('#profile-name').textContent = account.name;
      $('#profile-email').textContent = account.email;
      $('#profile-phone').textContent = account.phone || '';
      $('#profile-phone-row').hidden = !account.phone;
      $('#profile-role').textContent = account.role === 'admin' ? 'Quản trị viên' : 'Khách hàng';
      $('#profile-status').textContent = 'Đang hoạt động';
      $('#account-feedback').textContent = '';
      $('#admin-summary').hidden = !admin;
      $('#admin-feedback').textContent = '';
      ui.openModal($('#account-modal'));
      if (admin) {
        $('#admin-feedback').textContent = 'Đang tải...';
        try {
          const summary = await request('/admin/summary');
          if (!Number.isInteger(summary.productCount) || !Number.isInteger(summary.userCount)) throw new AuthError('Không thể tải tổng quan quản trị.');
          $('#admin-feedback').textContent = summary.productCount + ' sản phẩm · ' + summary.userCount + ' tài khoản';
        } catch (error) { $('#admin-feedback').textContent = error.message; }
      }
    });
  }

  function init(helpers) {
    ui = helpers;
    $('#auth-open').addEventListener('click', () => user ? setMenu($('#account-menu').hidden) : show());
    document.querySelectorAll('[data-open-auth]').forEach(button => button.addEventListener('click', () => user ? profile() : show()));
    document.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => { if (!busy) setMode(button.dataset.authMode); }));
    $('#auth-form').addEventListener('submit', submit);
    fields.forEach(name => {
      $('#auth-' + name).addEventListener('blur', event => {
        touched.add(name);
        // Do not reposition the centered dialog between button pointerdown and click.
        // Tab changes reset validation; submit validates every enabled field.
        if (!event.relatedTarget?.closest('button')) validate(name);
      });
      $('#auth-' + name).addEventListener('input', () => {
        feedback(); if (touched.has(name)) validate(name);
        if (name === 'password' && touched.has('confirm')) validate('confirm');
      });
    });
    for (const [input, button, label] of [['#auth-password', '#password-toggle', 'mật khẩu'], ['#auth-confirm', '#confirm-toggle', 'mật khẩu xác nhận']]) {
      $(button).addEventListener('click', () => {
        const visible = $(input).type === 'password'; $(input).type = visible ? 'text' : 'password';
        $(button).textContent = visible ? 'Ẩn' : 'Hiện';
        $(button).setAttribute('aria-label', (visible ? 'Ẩn ' : 'Hiện ') + label);
        $(button).setAttribute('aria-pressed', String(visible));
      });
    }
    $('#auth-modal').addEventListener('close', () => {
      formController?.abort(); formController = null; pendingAction = null;
      setMode('login');
    });
    $('#account-profile').addEventListener('click', () => profile());
    $('#account-admin').addEventListener('click', () => profile(true));
    $('#account-logout').addEventListener('click', logout);
    $('#profile-logout').addEventListener('click', logout);
    document.addEventListener('click', event => { if (!event.target.closest('.account-control')) setMenu(false); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !$('#account-menu').hidden) { setMenu(false); $('#auth-open').focus(); }
    });
    const synchronize = () => refresh().catch(error => console.warn('Session check unavailable:', error.status || 'network/response'));
    channel?.addEventListener('message', () => { revision++; synchronize(); });
    window.addEventListener('focus', synchronize);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) synchronize(); });
    setMode('login'); setUser(null); synchronize();
  }

  window.TTechAuth = Object.freeze({ init, requireLogin, request, getUser: () => user });
})();
