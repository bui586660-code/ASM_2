/* Authentication uses the existing dialogs. Passwords/tokens never enter browser storage. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const fields = ['name', 'email', 'password', 'confirm'];
  const api = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://' + location.hostname + ':3000/api' : location.origin + '/api';
  let ui, user = null, mode = 'login', busy = false, pendingAction = null;
  let formController, refreshPromise, revision = 0, loggingOut = false;
  const touched = new Set();
  const profileFields = ['name', 'phone', 'birthday', 'gender', 'address'];
  let profileVersion = 0, profileIntent = 0, profileBusy = false, profileController, profileSnapshot = null;
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
      // Keep HTTP status even when an error response has no usable JSON body.
      const invalidResponse = new AuthError('Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.', response.ok ? 0 : response.status);
      if ([204, 205].includes(response.status) || !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw invalidResponse;
      // Reading the stream can fail due to network/timeout; only parsing failures are invalid JSON.
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw invalidResponse; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw invalidResponse;
      if (!response.ok) {
        const messages = { 401: 'Email hoặc mật khẩu không chính xác.', 403: 'Bạn không có quyền truy cập chức năng này.',
          404: 'Dịch vụ tài khoản chưa sẵn sàng. Vui lòng thử lại.', 409: 'Email này đã được đăng ký.',
          429: 'Bạn thử quá nhiều lần. Vui lòng đợi một lúc rồi thử lại.' };
        const orderMessage = (route.startsWith('/orders') || route.startsWith('/admin/payments') || route === '/auth/me') && [400,401,404,409,503].includes(response.status) && typeof data.message === 'string' ? data.message : null;
        throw new AuthError(orderMessage || messages[response.status] || (response.status >= 500 ? 'Máy chủ đang gặp sự cố. Vui lòng thử lại.' : 'Không thể xử lý yêu cầu. Vui lòng thử lại.'), response.status,
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
    const { id, name, email, role, status } = value;
    const extras = Object.fromEntries(['phone','birthday','gender','address','createdAt'].filter(key => typeof value[key] === 'string').map(key => [key,value[key]]));
    return { id, name, email, role, status, ...extras, emailVerified: value.emailVerified === true };
  }

  function setMenu(open) {
    $('#account-menu').hidden = !open;
    $('#auth-open').setAttribute('aria-expanded', String(open));
  }

  function setUser(value) {
    const changed = JSON.stringify(user) !== JSON.stringify(value);
    if (!value || (user && value.id !== user.id)) resetProfile();
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
    if (name === 'password' && (!value.trim() || value.length < 8)) message = 'Mật khẩu phải có ít nhất 8 ký tự.';
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
    $('#auth-name').value = $('#auth-name').value.trim().replace(/\s+/g, ' ');
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

  function profileFeedback(message = '', error = false) {
    $('#account-feedback').textContent = message;
    $('#account-feedback').dataset.error = String(error);
  }
  function setProfileBusy(value) {
    profileBusy = value;
    $('#profile-form').setAttribute('aria-busy', String(value));
    $('#profile-form').querySelectorAll('input,select,textarea,button').forEach(input => { input.disabled = value; });
    $('#profile-save').textContent = value ? 'Đang lưu...' : 'Lưu thay đổi';
  }
  function profileFieldError(key, message = '') {
    $('#profile-input-' + key).setCustomValidity(message);
    $('#profile-input-' + key).setAttribute('aria-invalid', String(Boolean(message)));
    $('#profile-' + key + '-error').textContent = message;
    $('#profile-' + key + '-error').hidden = !message;
  }
  function resetProfile() {
    profileVersion++; profileController?.abort(); profileController = null; profileSnapshot = null;
    setProfileBusy(false); $('#profile-form').reset(); $('#profile-form').hidden = true;
    $('#profile-view').hidden = true; $('#profile-edit').hidden = true; $('#profile-retry').hidden = true;
    [...profileFields,'email','email-status','createdAt','role','status'].forEach(key => { $('#profile-' + key).textContent = ''; });
    profileFields.forEach(key => profileFieldError(key));
    profileFeedback(); $('#admin-summary').hidden = true;
  }
  const ownsProfile = (version, id) => version === profileVersion && user?.id === id && $('#account-modal').open;
  function renderProfile(account) {
    profileSnapshot = account;
    const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('vi-VN', {timeZone:'UTC'}) : 'Chưa cập nhật';
    const values = {name:account.name,email:account.email,phone:account.phone,birthday:date(account.birthday),
      gender:({male:'Nam',female:'Nữ',other:'Khác'})[account.gender],address:account.address,createdAt:date(account.createdAt),
      role:account.role === 'admin' ? 'Quản trị viên' : 'Khách hàng',status:'Đang hoạt động'};
    Object.entries(values).forEach(([key,value]) => { $('#profile-' + key).textContent = value || 'Chưa cập nhật'; });
    $('#profile-email-status').textContent = account.emailVerified ? 'Đã xác minh' : 'Chưa xác minh email';
    $('#profile-phone-row').hidden = false;
  }
  function editProfile(editing) {
    if (!profileSnapshot || profileBusy) return;
    profileFields.forEach(key => { $('#profile-input-' + key).value = profileSnapshot[key] || ''; profileFieldError(key); });
    $('#profile-input-birthday').max = new Date().toLocaleDateString('en-CA', {timeZone:'Asia/Ho_Chi_Minh'});
    $('#profile-form').hidden = !editing; $('#profile-view').hidden = editing; $('#profile-edit').hidden = editing;
    profileFeedback();
    if (editing) $('#profile-input-name').focus();
  }
  function validateProfileField(key) {
    const input = $('#profile-input-' + key), value = input.value.trim();
    let message = '';
    if (key === 'name' && (!value || value.length > 80)) message = 'Vui lòng nhập họ tên, tối đa 80 ký tự.';
    if (key === 'phone' && value && !/^(?:0|\+84)\d{9}$/.test(value)) message = 'Số điện thoại không hợp lệ. Nhập 10 số bắt đầu bằng 0 hoặc dùng +84.';
    if (key === 'birthday' && (input.validity.badInput || (value && (value < '1900-01-01' || value > input.max)))) message = 'Ngày sinh không hợp lệ.';
    if (key === 'gender' && !['','male','female','other'].includes(value)) message = 'Vui lòng chọn giới tính hợp lệ.';
    if (key === 'address' && value.length > 500) message = 'Địa chỉ tối đa 500 ký tự.';
    profileFieldError(key,message); return !message;
  }
  function expiredProfile() {
    setUser(null); pendingAction = () => profile(); show('login', true);
    feedback('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', true);
  }
  async function saveProfile(event) {
    event.preventDefault();
    if (profileBusy || !profileSnapshot) return;
    $('#profile-input-name').value = $('#profile-input-name').value.trim().replace(/\s+/g, ' ');
    const valid = profileFields.map(validateProfileField);
    if (valid.includes(false)) { $('#profile-input-' + profileFields[valid.indexOf(false)]).focus(); return; }
    const version = profileVersion, id = profileSnapshot.id;
    const controller = profileController = new AbortController();
    const body = Object.fromEntries(profileFields.map(key => [key,$('#profile-input-' + key).value.trim()]));
    revision++; setProfileBusy(true); profileFeedback();
    try {
      const account = parseUser(await request('/auth/me', {method:'PATCH',body,signal:controller.signal}));
      if (!ownsProfile(version,id)) return;
      if (account.id !== id) throw new AuthError('Máy chủ trả về dữ liệu tài khoản không hợp lệ. Vui lòng thử lại.');
      revision++; setUser(account); renderProfile(account); setProfileBusy(false); editProfile(false);
      profileFeedback('Cập nhật thông tin thành công.'); channel?.postMessage('changed');
    } catch (error) {
      if (!ownsProfile(version,id) || error.name === 'AbortError') return;
      if (error.status === 401) { expiredProfile(); return; }
      profileFeedback(error.message,true);
      profileFields.forEach(key => { if (typeof error.fields?.[key] === 'string') profileFieldError(key,error.fields[key]); });
    } finally {
      if (profileController === controller) { profileController = null; setProfileBusy(false); }
    }
  }
  function profile(admin = false) {
    const intent = ++profileIntent;
    resetProfile();
    return requireLogin(async current => {
      if (intent !== profileIntent) return;
      const version = profileVersion;
      setMenu(false); ui.openModal($('#account-modal')); profileFeedback('Đang tải thông tin...');
      const controller = profileController = new AbortController();
      try {
        const account = parseUser(await request('/auth/me', {signal:controller.signal}));
        if (!ownsProfile(version,current.id)) return;
        if (account.id !== current.id) throw new AuthError('Máy chủ trả về dữ liệu tài khoản không hợp lệ. Vui lòng thử lại.');
        setUser(account); renderProfile(account); editProfile(false);
        $('#admin-summary').hidden = !admin || account.role !== 'admin';
        if (admin && account.role === 'admin') {
          $('#admin-feedback').textContent = 'Đang tải...';
          try {
            const summary = await request('/admin/summary', {signal:controller.signal});
            if (!ownsProfile(version,current.id)) return;
            if (!Number.isInteger(summary.productCount) || !Number.isInteger(summary.userCount)) throw new AuthError('Không thể tải tổng quan quản trị.');
            $('#admin-feedback').textContent = summary.productCount + ' sản phẩm · ' + summary.userCount + ' tài khoản';
          } catch (error) { if (ownsProfile(version,current.id) && error.name !== 'AbortError') $('#admin-feedback').textContent = error.message; }
        }
      } catch (error) {
        if (!ownsProfile(version,current.id) || error.name === 'AbortError') return;
        if (error.status === 401) { expiredProfile(); return; }
        profileFeedback(error.message,true); $('#profile-retry').hidden = false;
      } finally { if (profileController === controller) profileController = null; }
    });
  }

  function init(helpers) {
    ui = helpers;
    $('#profile-form').addEventListener('submit',saveProfile);
    $('#profile-edit').addEventListener('click',() => editProfile(true));
    $('#profile-cancel').addEventListener('click',() => editProfile(false));
    $('#profile-retry').addEventListener('click',() => profile());
    $('#account-modal').addEventListener('close',() => { profileIntent++; resetProfile(); });
    profileFields.forEach(key => {
      $('#profile-input-' + key).addEventListener('blur',event => {
        if (!event.relatedTarget?.closest('button')) validateProfileField(key);
      });
      $('#profile-input-' + key).addEventListener('input',() => { if ($('#profile-input-' + key).getAttribute('aria-invalid') === 'true') validateProfileField(key); });
    });
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
