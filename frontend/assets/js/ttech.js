
  (() => {
    'use strict';
    // Chạy Backend/server.cjs để phục vụ products và authentication từ cùng db.json.
    const PRODUCTS_API = ['localhost','127.0.0.1'].includes(location.hostname) ? 'http://localhost:3000/products' : location.origin + '/products';
    let PRODUCTS = [];
    let catalogReady = false;
    let catalogLoading = false;
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => [...document.querySelectorAll(selector)];
    const money = (amount) => new Intl.NumberFormat('vi-VN', { style:'currency', currency:'VND' }).format(amount);
    const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const icon = (name, classes = '') => '<svg class="icon ' + classes + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
    const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').toLowerCase();
    const fallbackImage = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#f1f5f9"/><rect x="155" y="65" width="330" height="220" rx="12" fill="#e2e8f0" stroke="#94a3b8" stroke-width="6"/><path d="m155 285-35 35h400l-35-35" fill="#cbd5e1" stroke="#94a3b8" stroke-width="6"/><text x="320" y="365" text-anchor="middle" font-family="Arial" font-size="18" fill="#64748b">Ảnh minh họa laptop</text></svg>');
    const state = { brand:'', query:'', price:'all', sort:'featured', collection:'' };
    // Tách giỏ dữ liệu thật khỏi ID trùng trong bộ sản phẩm demo trước đây.
    const storageKey = 'cyber-core-db-cart-v1';
    const byId = new Map();
    let cart = new Map();
    let excludedCart = new Set();
    let appliedOrders = new Set();
    let storageAvailable = true;
    let toastTimer, cartToastTimer, wishlistToastTimer;
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function normalizeProducts(data) {
      const rows = Array.isArray(data) ? data : data?.products;
      if (!Array.isArray(rows)) throw new Error('Dữ liệu phải chứa danh sách products.');
      const seen = new Set();
      const brands = ['ASUS','MSI','Dell','HP','Apple','Acer','Lenovo'];
      return rows.map((item) => {
        if (!item || !['string','number'].includes(typeof item.id) || !String(item.id).trim() ||
            typeof item.name !== 'string' || !item.name.trim() ||
            typeof item.price !== 'number' || !Number.isFinite(item.price) || item.price < 0) {
          throw new Error('Sản phẩm cần có id, name và price hợp lệ.');
        }
        const id = String(item.id);
        if (seen.has(id)) throw new Error('ID sản phẩm bị trùng: ' + id);
        seen.add(id);
        const hasSale = typeof item.sale_price === 'number' && Number.isFinite(item.sale_price)
          && item.sale_price >= 0 && item.sale_price < item.price;
        const brandName = typeof item.brand === 'string' ? item.brand.trim() : item.name.trim().split(/\s+/)[0];
        const brand = brands.find((value) => normalize(value) === normalize(brandName)) || brandName;
        let image = fallbackImage;
        try {
          if (typeof item.image === 'string' && item.image.trim()) {
            // Ánh xạ đường dẫn ảnh trong database sang thư mục assets; giữ nguyên db.json.
            const imagePath = item.image.replace(/^\.\.\/images\//i, './assets/images/');
            const url = new URL(imagePath, document.baseURI);
            if (['http:','https:'].includes(url.protocol) || (location.protocol === 'file:' && url.protocol === 'file:')) image = url.href;
          }
        } catch { /* Dùng ảnh dự phòng nếu URL không hợp lệ. */ }
        const spec = (key, label) => {
          const value = item[key] ?? item.specs?.[key];
          return typeof value === 'string' && value.trim() ? value.trim() : label + ': Chưa cập nhật';
        };
        const images = [...new Set([image, ...(Array.isArray(item.images) ? item.images : []).flatMap(value => {
          if (typeof value !== 'string' || !value.trim()) return [];
          try {
            const url = new URL(value.replace(/^\.\.\/images\//i, './assets/images/'), document.baseURI);
            return ['http:','https:'].includes(url.protocol) || (location.protocol === 'file:' && url.protocol === 'file:') ? [url.href] : [];
          } catch { return []; }
        })])];
        const specifications = (Array.isArray(item.specifications) ? item.specifications : [])
          .filter(row => row && typeof row.label === 'string' && row.label.trim() && typeof row.value === 'string' && row.value.trim())
          .map(row => [row.label.trim(), row.value.trim()]);
        return { id, images, specifications, stock:Number.isInteger(item.stock) && item.stock >= 0 ? item.stock : null, name:item.name.trim(), brand, isDemo:item.demo === true, price:item.price, sale:hasSale ? item.sale_price : item.price,
          hasSale, image, rating: typeof item.rating === 'number' && item.rating > 0 && item.rating <= 5 ? item.rating : null, collection:/RTX|GTX/i.test(spec('gpu','GPU')) ? 'gaming' : 'office', cpu:spec('cpu','CPU'), gpu:spec('gpu','GPU'), ram:spec('ram','RAM'),
          ssd:spec('ssd','SSD'), screen:spec('screen','Màn hình') };
      });
    }

    async function fetchProductData() {
      // 1. Tự động dùng dữ liệu tĩnh nhúng sẵn (không cần bật terminal hay server backend)
      if (Array.isArray(window.TTECH_PRODUCTS) && window.TTECH_PRODUCTS.length > 0) {
        return window.TTECH_PRODUCTS;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(PRODUCTS_API, { cache:'no-store', signal:controller.signal });
        if (!response.ok) throw new Error('Không tải được dữ liệu (HTTP ' + response.status + ').');
        if ([204,205].includes(response.status) || !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error('Dữ liệu phải chứa danh sách products.');
        return await response.json();
      } catch (error) {
        try {
          const staticRes = await fetch('./data/products.json');
          if (staticRes.ok) return await staticRes.json();
        } catch {}
        throw error;
      } finally { clearTimeout(timer); }
    }

    async function loadProducts() {
      if (catalogLoading) return;
      catalogLoading = true;
      catalogReady = false;
      $('#catalog-loading').hidden = false;
      $('#home-loading').hidden = false;
      $('#home-error').hidden = true;
      $('#featured-products').setAttribute('aria-busy','true');
      $('#catalog-error').hidden = true;
      $('#empty-state').hidden = true;
      $('#product-count').textContent = 'Đang tải…';
      $('#product-grid').setAttribute('aria-busy','true');
      $('#cart-open').disabled = true;
      renderRoute();
      try {
        const products = normalizeProducts(await fetchProductData());
        PRODUCTS = products;
        byId.clear();
        products.forEach((product) => byId.set(product.id,product));
        catalogReady = true;
        cart.clear(); loadCart(); renderCart(); renderProducts(); renderHomeProducts(); updateWishlistBadge();
        $('#cart-open').disabled = false;
      } catch (error) {
        console.warn('Product request rejected:', error.name);
        $('#product-count').textContent = 'Chưa tải được sản phẩm';
        $('#catalog-error-message').textContent = 'Vui lòng thử lại.';
        $('#catalog-error').hidden = false;
        $('#home-error').hidden = false;
      } finally {
        catalogLoading = false;
        $('#catalog-loading').hidden = true;
        $('#home-loading').hidden = true;
        $('#featured-products').setAttribute('aria-busy','false');
        $('#product-grid').setAttribute('aria-busy','false');
        renderRoute();
      }
    }
    $('#retry-products').addEventListener('click',loadProducts);

    function notify(message) {
      const toast = $('#toast');
      toast.textContent = message;
      toast.classList.add('visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('visible'), 3000);
      if ($('#wishlist-modal').open) {
        $('#wishlist-feedback').textContent = message;
        $('#wishlist-feedback').hidden = false;
        clearTimeout(wishlistToastTimer);
        wishlistToastTimer = setTimeout(() => { $('#wishlist-feedback').hidden = true; },3000);
      }
      if ($('#cart-modal').open) {
        $('#dialog-toast').textContent = message;
        $('#dialog-toast').hidden = false;
        clearTimeout(cartToastTimer);
        cartToastTimer = setTimeout(() => { $('#dialog-toast').hidden = true; }, 3000);
      }
    }

    // Ảnh có fallback nội tuyến: không phụ thuộc file ảnh khác.
    document.addEventListener('error', (event) => {
      if (event.target instanceof HTMLImageElement && event.target.dataset.fallback !== 'true') {
        event.target.dataset.fallback = 'true';
        event.target.src = fallbackImage;
      }
    }, true);

    // Presentation helpers reuse the existing catalog, price rules and cart event delegation.
    const favoriteKey = 'ttech-favorites-v1';
    let favorites = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem(favoriteKey) || '[]');
      if (Array.isArray(saved)) favorites = new Set(saved.filter((id) => typeof id === 'string'));
    } catch { /* Favorites still work for this page when storage is unavailable. */ }

    function renderProductCard(p, variant) {
      const compact = variant === 'compact';
      const discount = p.hasSale ? Math.round((p.price-p.sale)/p.price*100) : 0;
      const specs = [['CPU',p.cpu],['GPU',p.gpu],['RAM',p.ram],['SSD',p.ssd],['Màn hình',p.screen]];
      return '<article class="product-card' + (compact ? ' product-card-compact' : '') + '" data-product-id="' + escape(p.id) + '">' +
        '<figure class="product-media">' + (p.hasSale ? '<span class="discount-tag">−' + discount + '%</span>' : '') +
        '<button type="button" class="favorite-button" data-favorite="' + escape(p.id) + '" aria-pressed="' + favorites.has(p.id) + '" aria-label="Yêu thích ' + escape(p.name) + '">' + icon('heart') + '</button>' +
        '<a class="product-image-link" href="#product/' + encodeURIComponent(p.id) + '" aria-label="Xem chi tiết ' + escape(p.name) + '"><img class="product-image" src="' + escape(p.image) + '" alt="' + escape(p.name) + '" loading="lazy" width="640" height="400"></a><a class="quick-view" href="#product/' + encodeURIComponent(p.id) + '" aria-label="Xem nhanh ' + escape(p.name) + '">Xem chi tiết ↗</a></figure>' +
        '<p class="product-brand">' + escape(p.brand) + (p.isDemo ? ' · Mẫu' : '') + '</p>' +
        '<h3 class="product-title" title="' + escape(p.name) + '">' + '<a href="#product/' + encodeURIComponent(p.id) + '">' + escape(p.name) + '</a></h3>' +
        (compact ? '' : '<dl class="spec-list">' + specs.map(([label,value]) => '<div title="' + escape(label + ': ' + value) + '"><dt class="sr-only">' + label + '</dt><dd>' + escape(value.replace(/^(NVIDIA GeForce |Intel |AMD )/,'')) + '</dd></div>').join('') + '</dl>') +
        '<p class="product-rating">' + (p.rating ? '<span aria-hidden="true">★</span> ' + p.rating.toFixed(1) + ' / 5' : 'Chưa có đánh giá') + '</p>' +
        '<div class="product-pricing"><p class="current-price">' + money(p.sale) + '</p><div class="price-details">' +
        (p.hasSale ? '<del>' + money(p.price) + '</del><span class="savings">Tiết kiệm ' + money(p.price-p.sale) + '</span>' : '') + '</div></div>' +
        (compact ? '' : '<p class="stock-status">' + icon('shield') + 'Liên hệ kiểm tra tồn kho</p>') +
        '<footer class="product-actions"><button type="button" class="btn btn-secondary" data-add="' + escape(p.id) + '" aria-label="Thêm ' + escape(p.name) + ' vào giỏ" title="Thêm vào giỏ">' + icon('cart') + '</button>' +
        (compact ? '' : '<button type="button" class="btn btn-primary" data-buy="' + escape(p.id) + '" aria-label="Mua ngay ' + escape(p.name) + '">Mua ngay</button>') + '</footer></article>';
    }

    function renderHomeProducts() {
      if (!catalogReady || $('#home-view').hidden) return;
      const shelves = [
        ['#featured-products', ['11','18','1','23','26','35']],
        ['#discovery-products', ['3','12','14','20','24','27','36','39','7']],
        ['#deal-products', PRODUCTS.filter(p => p.hasSale).slice(0,5).map(p => p.id)]
      ];
      shelves.forEach(([selector, ids]) => {
        const products = ids.map(id => byId.get(id)).filter(Boolean);
        $(selector).innerHTML = products.length
          ? products.map(p => renderProductCard(p,'compact')).join('')
          : '<p class="home-status">Chưa có sản phẩm trong bộ sưu tập này.</p>';
      });
    }
    $('#retry-home').addEventListener('click',loadProducts);
    document.addEventListener('click',event => {
      const link = event.target.closest('[data-home-brand]');
      if (!link) return;
      event.preventDefault();
      resetFilters();
      state.brand = link.dataset.homeBrand;
      renderProducts();
      location.hash = 'products';
      renderRoute();
      $('#products').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'});
    });
    $('#newsletter-form').addEventListener('submit',event => {
      event.preventDefault();
      $('#newsletter-note').textContent = 'Cảm ơn bạn quan tâm. Tính năng nhận bản tin chưa được mở; email của bạn chưa được gửi hoặc lưu.';
    });

    function updateWishlistBadge() {
      $('#wishlist-count').textContent = [...favorites].filter(id => byId.has(id)).length;
    }
    function renderWishlist() {
      const saved = PRODUCTS.filter(p => favorites.has(p.id));
      $('#wishlist-items').innerHTML = saved.map(renderProductCard).join('');
      $('#wishlist-empty').hidden = saved.length > 0;
    }
    $('#wishlist-modal').addEventListener('close',() => { $('#wishlist-items').replaceChildren(); $('#wishlist-feedback').hidden = true; });
    $('#wishlist-open').addEventListener('click',() => { renderWishlist(); openModal($('#wishlist-modal')); });
    $('#wishlist-items').addEventListener('click',event => {
      if (event.target.closest('a')) closeModal($('#wishlist-modal'));
      if (event.target.closest('[data-buy]')) $('#wishlist-modal').close();
    });
    document.addEventListener('click',event => {
      const target = event.target.closest('[data-collection], [data-show-all]');
      if (!target) return;
      resetFilters();
      state.collection = target.dataset.collection || '';
      renderProducts();
      location.hash = 'products';
      renderRoute();
      $('#products').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'});
    });
    const updateHeader = () => $('.site-header').classList.toggle('is-scrolled',window.scrollY > 24);
    window.addEventListener('scroll',updateHeader,{passive:true});
    updateHeader();
    // One catalog menu, placed inside the mobile navigation instead of a second hamburger.
    const mobileNavigation = matchMedia('(max-width:767px)');
    function placeCatalogMenu() {
      const menu = $('.mega-menu');
      if (mobileNavigation.matches) $('#main-nav').prepend(menu);
      else $('.header-main').insertBefore(menu,$('#header-search-form'));
    }
    mobileNavigation.addEventListener('change',placeCatalogMenu);
    placeCatalogMenu();

    function syncFilterControls() {
      $('#header-search').value = state.query;
      $$('[name="brand-choice"]').forEach((input) => { input.checked = input.value === state.brand; });
      $$('[name="price-choice"]').forEach((input) => { input.checked = input.value === state.price; });
      const chips = [];
      if (state.collection) chips.push(['collection',({gaming:'Laptop Gaming',office:'Laptop văn phòng',deals:'Đang giảm giá'})[state.collection]]);
      if (state.brand) chips.push(['brand','Hãng: ' + state.brand]);
      if (state.price !== 'all') chips.push(['price',$('#price-filter option:checked').textContent]);
      if (state.query) chips.push(['query','Tìm: ' + state.query]);
      $('#active-filters').innerHTML = chips.length ? chips.map(([key,label]) =>
        '<button type="button" class="filter-chip" data-clear-filter="' + key + '" aria-label="Bỏ bộ lọc ' + escape(label) + '">' + escape(label) + '<span aria-hidden="true">×</span></button>').join('') : '<span class="no-filters">Tất cả sản phẩm</span>';
    }

    function renderProducts() {
      if (!catalogReady) return;
      let products = PRODUCTS.filter((product) =>
        (!state.collection || (state.collection === 'deals' ? product.hasSale : product.collection === state.collection)) &&
        (!state.brand || product.brand === state.brand) &&
        normalize(product.name + ' ' + product.brand).includes(normalize(state.query)) &&
        (state.price === 'all' || (state.price === 'under25' && product.sale < 25000000) ||
         (state.price === '25to35' && product.sale >= 25000000 && product.sale < 35000000) ||
         (state.price === '35plus' && product.sale >= 35000000))
      );
      if (state.sort === 'asc') products.sort((a,b) => a.sale - b.sale);
      if (state.sort === 'desc') products.sort((a,b) => b.sale - a.sale);
      $('#product-count').textContent = '(' + products.length + ' sản phẩm)';
      $('#empty-state').hidden = products.length !== 0;
      if (!$('#catalog-view').hidden) $('#product-grid').innerHTML = products.map(renderProductCard).join('');
      $('#results-summary').textContent = 'Hiển thị ' + products.length + ' trong tổng số ' + PRODUCTS.length + ' laptop';
      syncFilterControls();
      $$('[data-brand]').forEach((button) => button.setAttribute('aria-pressed',String(button.dataset.brand === state.brand)));
    }

    function resetFilters() {
      Object.assign(state,{brand:'',query:'',price:'all',sort:'featured',collection:''});
      $('#search').value = ''; $('#price-filter').value = 'all'; $('#sort').value = 'featured';
      renderProducts();
    }
    $('#brand-filters').addEventListener('click',(event) => {
      const button = event.target.closest('[data-brand]');
      if (button) { state.brand = button.dataset.brand; renderProducts(); }
    });
    $('#search-form').addEventListener('submit',(event) => { event.preventDefault(); state.query = $('#search').value.trim(); renderProducts(); });
    $('#search').addEventListener('input',() => { state.query = $('#search').value.trim(); renderProducts(); });
    $('#price-filter').addEventListener('change',(event) => { state.price = event.target.value; renderProducts(); });
    $('#sort').addEventListener('change',(event) => { state.sort = event.target.value; renderProducts(); });
    $('#reset-filters').addEventListener('click',resetFilters);
    $('#empty-reset').addEventListener('click',resetFilters);

    // UI adapters feed the existing filter state; no extra product filtering rules.
    $('#header-search-form').addEventListener('submit',(event) => {
      event.preventDefault();
      const query = $('#header-search').value;
      location.hash = 'catalog-results'; renderRoute();
      $('#search').value = query;
      $('#search-form').requestSubmit();
      $('#catalog-results').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'});
    });
    $('#filter-sidebar').addEventListener('change',(event) => {
      if (event.target.name === 'brand-choice') {
        state.brand = event.target.value;
        renderProducts();
      }
      if (event.target.name === 'price-choice') {
        $('#price-filter').value = event.target.value;
        $('#price-filter').dispatchEvent(new Event('change'));
      }
    });
    $$('[data-reset-filters]').forEach((button) => button.addEventListener('click',resetFilters));
    $('#active-filters').addEventListener('click',(event) => {
      const button = event.target.closest('[data-clear-filter]');
      if (!button) return;
      const key = button.dataset.clearFilter;
      state[key] = key === 'price' ? 'all' : '';
      $('#search').value = state.query;
      $('#price-filter').value = state.price;
      renderProducts();
      $('#reset-filters').focus();
    });
    document.addEventListener('click',(event) => {
      const button = event.target.closest('[data-favorite]');
      if (!button) return;
      const id = button.dataset.favorite;
      if (!byId.has(id)) return;
      if (favorites.has(id)) favorites.delete(id); else favorites.add(id);
      $$('[data-favorite]').filter((item) => item.dataset.favorite === id).forEach((item) => item.setAttribute('aria-pressed',String(favorites.has(id))));
      try { localStorage.setItem(favoriteKey,JSON.stringify([...favorites])); } catch { /* Keep in memory. */ }
      updateWishlistBadge();
      if ($('#wishlist-modal').open) { renderWishlist(); $('#wishlist-modal [data-close]').focus(); }
      notify(favorites.has(id) ? 'Đã thêm vào yêu thích.' : 'Đã bỏ khỏi yêu thích.');
    });
    $('#menu-toggle').addEventListener('click',() => {
      const expanded = $('#menu-toggle').getAttribute('aria-expanded') !== 'true';
      $('#menu-toggle').setAttribute('aria-expanded',String(expanded));
      $('#main-nav').classList.toggle('is-open',expanded);
    });
    $('#main-nav').addEventListener('click',(event) => {
      if (event.target.closest('a')) {
        $('#main-nav').classList.remove('is-open');
        $('#menu-toggle').setAttribute('aria-expanded','false');
      }
    });
    $('#main-nav').addEventListener('keydown',(event) => {
      if (event.key === 'Escape') {
        $('#main-nav').classList.remove('is-open');
        $('#menu-toggle').setAttribute('aria-expanded','false');
        $('#menu-toggle').focus();
      }
    });
    $('#filter-open').addEventListener('click',() => {
      // Move the same controls into the native dialog; do not duplicate IDs or state.
      $('#drawer-filter-slot').append($('#filter-sidebar'));
      openModal($('#filter-modal'));
    });
    $('#filter-modal').addEventListener('close',() => { $('#sidebar-slot').append($('#filter-sidebar')); });
    window.matchMedia('(min-width:1024px)').addEventListener('change',(event) => {
      if (event.matches && $('#filter-modal').open) $('#filter-modal').close();
    });
    syncFilterControls();

    function openModal(dialog) {
      if (dialog.open) return;
      dialog.classList.remove('closing');
      dialog.showModal();
      document.body.classList.add('modal-open');
    }
    function closeModal(dialog) {
      if (!dialog.open || dialog.classList.contains('closing')) return;
      if (reducedMotion()) { dialog.close(); return; }
      dialog.classList.add('closing');
      // CSS owns the motion timing; keep the dialog modal until its exit finishes.
      const duration = parseFloat(getComputedStyle(dialog).animationDuration) * 1000 || 0;
      const finish = () => {
        clearTimeout(timer);
        dialog.removeEventListener('animationend', onExit);
        dialog.removeEventListener('animationcancel', onExit);
        dialog.close();
        dialog.classList.remove('closing');
      };
      const onExit = (event) => {
        if (event.target === dialog && event.animationName === 'modal-out') finish();
      };
      const timer = setTimeout(finish, duration + 50);
      dialog.addEventListener('animationend', onExit);
      dialog.addEventListener('animationcancel', onExit);
    }
    $$('dialog').forEach((dialog) => {
      dialog.addEventListener('cancel',(event) => { event.preventDefault(); closeModal(dialog); });
      dialog.addEventListener('close',() => {
        if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
      });
      dialog.addEventListener('click',(event) => {
        const box = dialog.getBoundingClientRect();
        if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) closeModal(dialog);
      });
    });
    $$('[data-close]').forEach((button) => button.addEventListener('click',() => closeModal(document.getElementById(button.dataset.close))));

    // Chỉ lưu id/số lượng; không lưu email, mật khẩu hoặc thông tin thanh toán.
    function loadCart() {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
        const entries = Array.isArray(saved) ? saved : saved?.items;
        if (!Array.isArray(entries)) return;
        appliedOrders = new Set(Array.isArray(saved.appliedOrders) ? saved.appliedOrders.filter(id => typeof id === 'string') : []);
        excludedCart = new Set();
        for (const entry of entries) {
          if (!entry || !byId.has(String(entry.id)) || !Number.isInteger(entry.qty) || entry.qty < 1 || entry.qty > 99) continue;
          cart.set(String(entry.id),entry.qty);
          if (entry.selected === false) excludedCart.add(String(entry.id));
        }
      } catch { storageAvailable = false; }
    }
    const cartLimit = id => Math.min(99,byId.get(id)?.stock ?? 99);
    function saveCart() {
      try {
        const latest = JSON.parse(localStorage.getItem(storageKey) || '[]');
        for (const id of Array.isArray(latest?.appliedOrders) ? latest.appliedOrders : []) if (typeof id === 'string') appliedOrders.add(id);
        localStorage.setItem(storageKey,JSON.stringify({items:[...cart].map(([id,qty]) => ({id,qty,...(excludedCart.has(id) ? {selected:false} : {})})),appliedOrders:[...appliedOrders]}));
        return true;
      } catch {
        if (storageAvailable) notify('Giỏ hàng chỉ được giữ trong phiên này vì trình duyệt không cho phép lưu.');
        storageAvailable=false; return false;
      }
    }
    function cartChanged() { document.dispatchEvent(new CustomEvent('ttech:cart-change')); }
    function updateCartBadge() {
      const count = [...cart.values()].reduce((total,qty) => total+qty,0);
      $('#cart-count').textContent = count;
      $('#cart-open').setAttribute('aria-label','Giỏ hàng, ' + count + ' sản phẩm');
    }
    function renderCart() {
      $('#cart-empty').hidden = cart.size > 0;
      $('#cart-summary').hidden = cart.size === 0;
      let total = 0;
      $('#cart-items').innerHTML = [...cart].map(([id,qty]) => {
        const p = byId.get(id); if (!excludedCart.has(id)) total += p.sale*qty;
        return '<article class="cart-row" data-cart-id="' + escape(id) + '"><img src="' + escape(p.image) + '" alt="Ảnh minh họa ' + escape(p.name) + '" width="64" height="64" class="w-16 h-16 rounded-lg object-cover bg-slate-50"><div class="min-w-0"><h3 class="font-semibold text-xs sm:text-sm">' + escape(p.name) + '</h3><p class="text-red-600 font-bold text-sm mt-1">' + money(p.sale) + '</p><button type="button" data-remove="' + escape(id) + '" class="text-xs text-slate-500 hover:text-red-600 underline mt-1" aria-label="Xóa ' + escape(p.name) + '">Xóa</button></div><div class="flex items-center gap-2"><button type="button" class="qty-button" data-qty="' + escape(id) + '" data-delta="-1" aria-label="Giảm số lượng ' + escape(p.name) + '" ' + (qty === 1 ? 'disabled' : '') + '>−</button><span class="text-sm min-w-6 text-center" aria-label="Số lượng">' + qty + '</span><button type="button" class="qty-button" data-qty="' + escape(id) + '" data-delta="1" aria-label="Tăng số lượng ' + escape(p.name) + '" ' + (qty >= cartLimit(id) ? 'disabled' : '') + '>+</button></div></article>';
      }).join('');
      $$('#cart-items h3').forEach(heading => {
        const id = heading.closest('[data-cart-id]').dataset.cartId;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.dataset.cartSelect = id; checkbox.checked = !excludedCart.has(id);
        checkbox.setAttribute('aria-label','Chọn mua ' + byId.get(id).name);
        heading.prepend(checkbox, document.createTextNode(' '));
      });
      const selectedCount = [...cart].filter(([id]) => !excludedCart.has(id)).reduce((sum,[,qty]) => sum+qty,0);
      $('#cart-select-all').checked = cart.size > 0 && [...cart.keys()].every(id => !excludedCart.has(id));
      $('#cart-select-all').indeterminate = selectedCount > 0 && !$('#cart-select-all').checked;
      $('#cart-selection').hidden = !cart.size;
      $('#cart-selected-count').textContent = selectedCount;
      $('#checkout').disabled = !selectedCount;
      $('#cart-total').textContent = money(total);
      updateCartBadge();
      TTechCheckout.refreshCartQuote();
    }
    function addToCart(id, button, buyNow, amount = 1) {
      if (!byId.has(id)) return;
      const qty = cart.get(id) || 0;
      if (!Number.isInteger(amount) || amount < 1 || amount > 99) return;
      if (qty + amount > cartLimit(id)) { notify(cartLimit(id) < 99 ? 'Số lượng vượt quá tồn kho hiện tại.' : 'Tối đa 99 sản phẩm cho mỗi mẫu laptop.'); return; }
      cart.set(id,qty+amount);
      if (buyNow) excludedCart = new Set([...cart.keys()].filter(key => key !== id)); else excludedCart.delete(id);
      saveCart(); updateCartBadge(); cartChanged();
      if (buyNow) { renderCart(); $('#checkout-feedback').textContent=''; openModal($('#cart-modal')); }
      notify('Đã thêm ' + byId.get(id).name + ' vào giỏ hàng.');
    }
    document.addEventListener('click',(event) => {
      const button = event.target.closest('[data-add],[data-buy]');
      if (button) {
        const amount = button.closest('.detail-purchase') ? Number($('#detail-quantity').value) : 1;
        if (button.closest('.detail-purchase') && !$('#detail-quantity').reportValidity()) return;
        const id = button.dataset.add || button.dataset.buy;
        if (button.dataset.buy) TTechAuth.requireLogin(() => addToCart(id,button,true,amount));
        else addToCart(id,button,false,amount);
      }
    });
    $('#cart-open').addEventListener('click',() => { renderCart(); $('#checkout-feedback').textContent=''; $('#dialog-toast').hidden=true; openModal($('#cart-modal')); });
    $('#cart-items').addEventListener('change',event => {
      const input = event.target.closest('[data-cart-select]');
      if (!input) return;
      if (input.checked) excludedCart.delete(input.dataset.cartSelect); else excludedCart.add(input.dataset.cartSelect);
      saveCart(); renderCart(); cartChanged();
      $$('#cart-items [data-cart-select]').find(item => item.dataset.cartSelect === input.dataset.cartSelect)?.focus();
    });
    $('#cart-select-all').addEventListener('change',event => {
      excludedCart = event.target.checked ? new Set() : new Set(cart.keys());
      saveCart(); renderCart(); cartChanged();
    });
    $('#cart-items').addEventListener('click',(event) => {
      const button = event.target.closest('[data-qty],[data-remove]');
      if (!button) return;
      const id = button.dataset.qty || button.dataset.remove;
      if (!cart.has(id)) return;
      const isRemove = button.hasAttribute('data-remove');
      if (isRemove) { cart.delete(id); excludedCart.delete(id); }
      else {
        const next = cart.get(id)+Number(button.dataset.delta);
        if (next > cartLimit(id) && Number(button.dataset.delta) > 0) { notify('Số lượng vượt quá tồn kho hiện tại.'); return; }
        cart.set(id,Math.max(1,Math.min(99,next)));
      }
      saveCart(); renderCart(); cartChanged(); $('#checkout-feedback').textContent='';
      const nextFocus = isRemove ? $('#cart-items button') : $('#cart-items button[data-qty="' + CSS.escape(id) + '"][data-delta="' + button.dataset.delta + '"]:not(:disabled)');
      (nextFocus || $('#cart-items button[data-remove="' + CSS.escape(id) + '"]') || $('#cart-modal [data-close]')).focus();
      notify(isRemove ? 'Đã xóa sản phẩm khỏi giỏ hàng.' : 'Đã cập nhật số lượng.');
    });
    $('#checkout').addEventListener('click',() => {
      if (![...cart.keys()].some(id => !excludedCart.has(id))) { notify('Vui lòng chọn sản phẩm để thanh toán.'); return; }
      TTechAuth.requireLogin(() => {
        closeModal($('#cart-modal'));
        location.hash = 'checkout';
      });
    });
    window.addEventListener('storage',(event) => {
      if (catalogReady && (event.key === storageKey || event.key === null)) { cart.clear(); loadCart(); renderCart(); cartChanged(); }
    });

    TTechAuth.init({ openModal, closeModal, notify });
    TTechCheckout.init({ money, escape, icon, notify, openModal, closeModal, reloadProducts:loadProducts,
      getCart: () => [...cart].filter(([id]) => !excludedCart.has(id)).map(([productId,quantity]) => ({productId,quantity})),
      openCart: () => { renderCart(); openModal($('#cart-modal')); },
      removePurchased: async order => {
        const reconcile = () => {
          // Cart and its applied-order receipts are one atomic localStorage value.
          // A shared lock prevents duplicated tabs from applying the same receipt twice.
          if (storageAvailable) { cart.clear(); loadCart(); }
          if (appliedOrders.has(order.id)) { renderCart(); return; }
          const before = new Map(cart);
          for (const item of order.items) {
            const id = String(item.productId), remaining = (cart.get(id) || 0) - item.quantity;
            if (remaining > 0) cart.set(id,remaining); else cart.delete(id);
          }
          appliedOrders.add(order.id);
          if (storageAvailable && !saveCart()) {
            cart = before; appliedOrders.delete(order.id); storageAvailable = true;
            throw new Error('Đơn đã được lưu nhưng chưa cập nhật được giỏ hàng. Vui lòng thử lại.');
          }
          renderCart(); cartChanged();
        };
        if (navigator.locks) return navigator.locks.request('ttech-cart-reconcile',reconcile);
        if (!storageAvailable) return reconcile();
        throw new Error('Đơn đã được lưu. Hãy dùng trình duyệt mới để đồng bộ giỏ hàng hoặc xem Lịch sử đơn hàng.');
      }
    });
    $('#account-orders').addEventListener('click',() => { location.hash = 'orders'; });

    const hero = $('.hero');
    let slideIndex = 0, slideTimer, manuallyPaused = false, heroHovered = false, heroVisible = true;
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    function scheduleSlide() {
      clearTimeout(slideTimer);
      const paused = manuallyPaused || reducedMotion();
      $('.slider-pause').setAttribute('aria-pressed',String(paused));
      $('.slider-pause').setAttribute('aria-label',paused ? 'Bật tự chuyển banner' : 'Tạm dừng tự chuyển banner');
      $('.slider-pause').textContent = paused ? '▷' : 'Ⅱ';
      if (paused || heroHovered || !heroVisible || document.hidden || hero.contains(document.activeElement) || location.hash.startsWith('#product/')) return;
      slideTimer = setTimeout(() => showSlide(slideIndex + 1,false),6500);
    }
    function showSlide(next, announce = true) {
      const slides = $$('.hero-slide'), dots = $$('.slider-dot');
      if (slides[slideIndex].contains(document.activeElement)) hero.focus({preventScroll:true});
      slideIndex = (next+slides.length)%slides.length;
      slides.forEach((slide,index) => {
        const active = index === slideIndex;
        slide.classList.toggle('is-active',active);
        slide.inert = !active;
        slide.setAttribute('aria-hidden',String(!active));
        dots[index].setAttribute('aria-pressed',String(active));
      });
      $('.hero-index').innerHTML = String(slideIndex+1).padStart(2,'0') + ' <span>/ ' + String(slides.length).padStart(2,'0') + '</span>';
      if (announce) $('#slider-status').textContent = slides[slideIndex].getAttribute('aria-label');
      scheduleSlide();
    }
    $('.slider-prev').addEventListener('click',() => showSlide(slideIndex-1));
    $('.slider-next').addEventListener('click',() => showSlide(slideIndex+1));
    $$('.slider-dot').forEach((dot,index) => dot.addEventListener('click',() => showSlide(index)));
    $('.slider-pause').addEventListener('click',() => {
      if (reducedMotion()) { notify('Tự chuyển banner đang tắt theo cài đặt giảm chuyển động. Bạn có thể dùng các nút điều hướng.'); return; }
      manuallyPaused = !manuallyPaused; scheduleSlide();
    });
    hero.addEventListener('pointerenter',event => { if (event.pointerType === 'mouse') { heroHovered = true; scheduleSlide(); } });
    hero.addEventListener('pointerleave',() => { heroHovered = false; scheduleSlide(); });
    hero.addEventListener('focusin',scheduleSlide);
    hero.addEventListener('focusout',() => queueMicrotask(scheduleSlide));
    hero.addEventListener('keydown',event => {
      if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); showSlide(slideIndex+(event.key==='ArrowRight'?1:-1)); }
    });
    let swipeStart;
    hero.addEventListener('pointerdown',event => {
      if (event.pointerType !== 'mouse' && !event.target.closest('a,button')) swipeStart = {x:event.clientX,y:event.clientY};
    });
    hero.addEventListener('pointerup',event => {
      if (!swipeStart) return;
      const dx = event.clientX-swipeStart.x, dy = event.clientY-swipeStart.y;
      if (Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)*1.3) showSlide(slideIndex+(dx<0?1:-1));
      swipeStart = null;
    });
    hero.addEventListener('pointercancel',() => { swipeStart = null; });
    new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; scheduleSlide(); },{threshold:.25}).observe(hero);
    document.addEventListener('visibilitychange',scheduleSlide);
    motionPreference.addEventListener('change',scheduleSlide);
    window.addEventListener('hashchange',scheduleSlide);
    $('[data-hero-brand]').addEventListener('click',() => { resetFilters(); state.brand='MSI'; renderProducts(); location.hash='products'; renderRoute(); $('#products').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'}); });
    scheduleSlide();
    $$('.nav-link').forEach((link) => link.addEventListener('click',() => {
      $$('.nav-link').forEach((item) => item.removeAttribute('aria-current')); link.setAttribute('aria-current','location');
    }));
    // Product detail is a hash view so direct links also work on a static server.
    // The catalog, cart, account dialogs and product-card template are shared.
    let galleryItems = [], galleryIndex = 0, galleryRequest = 0;
    let currentDetailId = null;

    function specificationImage(p) {
      const rows = [['CPU',p.cpu],['GPU',p.gpu],['RAM',p.ram],['SSD',p.ssd],['Màn hình',p.screen]];
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">' +
        '<rect width="800" height="600" rx="16" fill="#F5F7FA"/><rect x="40" y="40" width="720" height="520" rx="16" fill="#FFFFFF"/>' +
        '<text x="76" y="104" fill="#E31E24" font-size="28" font-family="Arial" font-weight="bold">T-TECH · ' + escape(p.brand) + '</text>' +
        '<text x="76" y="147" fill="#111827" font-size="22" font-family="Arial">Thông số sản phẩm</text>' +
        rows.map(([label,value],i) => '<text x="76" y="' + (208+i*62) + '" fill="#6B7280" font-size="16" font-family="Arial">' + label + '</text><text x="220" y="' + (208+i*62) + '" fill="#111827" font-size="19" font-family="Arial">' + escape(value.length > 40 ? value.slice(0,37)+'…' : value) + '</text>').join('') + '</svg>';
      return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    }

    function renderDetail(p) {
      galleryItems = [
        ...p.images.map((src,index) => ({src,label:index === 0 ? 'Ảnh sản phẩm' : 'Ảnh sản phẩm ' + (index + 1)})),
        { src:specificationImage(p), label:'Bảng cấu hình' }
      ];
      galleryIndex = 0;
      const specs = [['CPU',p.cpu],['Card đồ họa',p.gpu],['RAM',p.ram],['SSD',p.ssd],['Màn hình',p.screen]];
      const detailSpecs = p.specifications.length ? p.specifications : specs;
      const others = PRODUCTS.filter(item => item.id !== p.id);
      const related = [...others.filter(item => item.brand === p.brand), ...others.filter(item => item.brand !== p.brand)].slice(0,4);
      $('#product-detail').innerHTML = `
        <nav class="breadcrumb" aria-label="Đường dẫn sản phẩm"><a href="#home">Trang chủ</a><span>/</span><a href="#products">Laptop</a><span>/</span><span aria-current="page">${escape(p.name)}</span></nav>
        <div class="detail-heading"><a href="#products" class="text-action">← Trở về danh sách</a><h1 id="detail-title" tabindex="-1">${escape(p.name)}</h1><p>${escape(p.brand)} · Mã sản phẩm: ${escape(p.id)}${p.isDemo ? ' · Sản phẩm mẫu' : ''}</p></div>
        <div class="detail-layout">
          <section class="product-gallery" aria-label="Hình ảnh sản phẩm">
            <div class="gallery-stage" tabindex="0" aria-label="Gallery, dùng phím mũi tên để chuyển ảnh" aria-busy="false">
              <img class="gallery-image is-active" src="${escape(p.image)}" alt="${escape(p.name)} — Ảnh sản phẩm" width="800" height="600">
              <img class="gallery-image" alt="" width="800" height="600" aria-hidden="true">
              <button type="button" class="gallery-arrow gallery-prev" data-gallery-step="-1" aria-label="Ảnh trước">‹</button>
              <button type="button" class="gallery-arrow gallery-next" data-gallery-step="1" aria-label="Ảnh tiếp theo">›</button>
            </div>
            <p id="gallery-status" class="gallery-caption" role="status">1 / ${galleryItems.length} · Ảnh sản phẩm</p>
            <div class="gallery-thumbnails" role="group" aria-label="Chọn ảnh sản phẩm">
              ${galleryItems.map((item,i) => `<button type="button" class="gallery-thumbnail" data-gallery-index="${i}" aria-pressed="${i===0}" aria-label="Xem ${item.label}"><img src="${escape(item.src)}" alt="" width="100" height="75"><span>${item.label}</span></button>`).join('')}
            </div>
            <p class="gallery-note">Gallery gồm ảnh hiện có và bảng cấu hình từ dữ liệu sản phẩm.</p>
          </section>
          <section class="detail-purchase" aria-label="Thông tin mua sản phẩm">
            <div class="detail-price"><strong>${money(p.sale)}</strong>${p.hasSale ? `<del>${money(p.price)}</del><span class="detail-sale">Tiết kiệm ${money(p.price-p.sale)}</span>` : ''}</div>
            <p class="detail-stock">${icon('shield')} Liên hệ kiểm tra tồn kho</p>
            <dl class="detail-highlights">${specs.map(([label,value]) => `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
            <div class="detail-quantity"><label for="detail-quantity">Số lượng</label><div><button type="button" class="qty-button" data-detail-qty="-1" aria-label="Giảm số lượng mua" disabled>−</button><input id="detail-quantity" type="number" value="1" min="1" max="${Math.max(1,Math.min(99,p.stock ?? 99))}" step="1" required inputmode="numeric"><button type="button" class="qty-button" data-detail-qty="1" aria-label="Tăng số lượng mua">+</button></div></div>
            <div class="detail-actions"><button type="button" class="btn btn-secondary" data-add="${escape(p.id)}">${icon('cart')}Thêm vào giỏ</button><button type="button" class="btn btn-primary" data-buy="${escape(p.id)}">Mua ngay</button></div>
            <button type="button" class="detail-favorite btn btn-secondary" data-favorite="${escape(p.id)}" aria-pressed="${favorites.has(p.id)}">${icon('heart')}Yêu thích sản phẩm</button>
            <p class="detail-note">Kiểm tra thông tin nhận hàng và tổng tiền tại bước thanh toán. Chuyển khoản/QR đang mô phỏng, chưa thu tiền trực tuyến.</p>
            <button type="button" data-specifications class="text-action">Xem thông số chi tiết ↓</button>
          </section>
        </div>
        <section id="detail-specifications" class="detail-specifications"><h2>Thông số kỹ thuật</h2><table><caption class="sr-only">Cấu hình ${escape(p.name)}</caption><tbody>${detailSpecs.map(([label,value]) => `<tr><th scope="row">${escape(label)}</th><td>${escape(value).replace(/\r?\n/g,'<br>')}</td></tr>`).join('')}</tbody></table><p>Thông số còn thiếu được giữ nguyên trạng thái “Chưa cập nhật”.</p></section>
        <section class="related-products" aria-labelledby="related-title"><div class="detail-section-heading"><h2 id="related-title">Có thể bạn quan tâm</h2><a href="#products" class="text-action">Xem tất cả laptop →</a></div><div class="product-grid">${related.map(renderProductCard).join('')}</div></section>`;
    }

    function renderRoute() {
      const isCommerce = TTechCheckout.isRoute(location.hash);
      $('#commerce-view').hidden = !isCommerce;
      TTechCheckout.renderRoute(location.hash,catalogReady);
      const isDetail = location.hash.startsWith('#product/');
      galleryRequest++;
      const isCatalog = ['#products','#catalog-results'].includes(location.hash);
      $('#home-view').hidden = isDetail || isCatalog || isCommerce;
      $('#catalog-view').hidden = !isCatalog;
      $$('.nav-link').forEach(link => {
        if (link.hash === location.hash && !link.dataset.collection) link.setAttribute('aria-current','page');
        else link.removeAttribute('aria-current');
      });
      $('#product-detail').hidden = !isDetail;
      // Mount only the active view; state stays in the existing shared stores.
      if (!isCatalog) $('#product-grid').replaceChildren();
      else renderProducts();
      if (isDetail || isCatalog || isCommerce) {
        ['#featured-products','#discovery-products','#deal-products'].forEach(selector => $(selector).replaceChildren());
      } else if (!$('#featured-products').children.length) renderHomeProducts();
      if (!isDetail) {
        currentDetailId = null;
        $('#product-detail').replaceChildren();
        if (!isCommerce) document.title = isCatalog ? 'Laptop Chính Hãng | T-TECH' : 'T-TECH — Công nghệ cho mọi đam mê';
        return;
      }
      try { currentDetailId = decodeURIComponent(location.hash.slice(9)); } catch { currentDetailId = ''; }
      if (!catalogReady) {
        $('#product-detail').innerHTML = catalogLoading
          ? '<p class="catalog-message" role="status">Đang tải sản phẩm…</p>'
          : '<div class="catalog-message" role="alert"><h1>Không thể tải sản phẩm</h1><p>Vui lòng thử lại.</p><button type="button" class="btn btn-primary" data-detail-retry>Thử lại</button></div>';
      } else {
        const product = byId.get(currentDetailId);
        if (!product) {
          document.title = 'Không tìm thấy sản phẩm | T-TECH';
          $('#product-detail').innerHTML = '<div class="catalog-message" role="alert"><h1>Không tìm thấy sản phẩm</h1><p>Sản phẩm không tồn tại hoặc đã được cập nhật.</p><a class="btn btn-primary" href="#products">Xem danh sách laptop</a></div>';
        } else {
          renderDetail(product);
          document.title = product.name + ' | T-TECH';
          $('#detail-title').focus({preventScroll:true});
        }
      }
      window.scrollTo({top:0,behavior:'instant'});
    }

    async function selectGallery(index) {
      const next = (index + galleryItems.length) % galleryItems.length;
      const request = ++galleryRequest;
      const item = galleryItems[next];
      const stage = $('.gallery-stage');
      if (!stage || !item) return;
      stage.setAttribute('aria-busy','true');
      // Keep the current image visible until the next one has loaded; CSS fades it.
      const source = await new Promise(resolve => {
        const image = new Image();
        const timeout = setTimeout(() => done(fallbackImage),6000);
        const done = src => { clearTimeout(timeout); image.onload=image.onerror=null; resolve(src); };
        image.onload = () => done(item.src);
        image.onerror = () => done(fallbackImage);
        image.src = item.src;
      });
      if (request !== galleryRequest || !stage.isConnected) return;
      const outgoing = stage.querySelector('.is-active');
      const incoming = [...stage.querySelectorAll('.gallery-image')].find(img => img !== outgoing);
      incoming.src = source;
      incoming.alt = byId.get(currentDetailId).name + ' — ' + item.label;
      incoming.removeAttribute('aria-hidden');
      outgoing.setAttribute('aria-hidden','true');
      outgoing.classList.remove('is-active');
      incoming.classList.add('is-active');
      galleryIndex = next;
      stage.setAttribute('aria-busy','false');
      $$('[data-gallery-index]').forEach(button => button.setAttribute('aria-pressed',String(Number(button.dataset.galleryIndex) === next)));
      $('#gallery-status').textContent = (next+1) + ' / ' + galleryItems.length + ' · ' + item.label;
    }

    $('#product-detail').addEventListener('click',event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-detail-retry')) loadProducts();
      if (button.hasAttribute('data-specifications')) $('#detail-specifications').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'});
      if (button.hasAttribute('data-gallery-index')) selectGallery(Number(button.dataset.galleryIndex));
      if (button.hasAttribute('data-gallery-step')) selectGallery(galleryIndex + Number(button.dataset.galleryStep));
      if (button.hasAttribute('data-detail-qty')) {
        const input = $('#detail-quantity');
        input.value = Math.max(1,Math.min(Math.max(1,cartLimit(currentDetailId)),(Number(input.value)||1)+Number(button.dataset.detailQty)));
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }
    });
    $('#product-detail').addEventListener('input',event => {
      if (event.target.id !== 'detail-quantity') return;
      const value = Number(event.target.value);
      $('[data-detail-qty="-1"]').disabled = value <= 1;
      $('[data-detail-qty="1"]').disabled = value >= cartLimit(currentDetailId);
    });
    $('#product-detail').addEventListener('keydown',event => {
      if (!event.target.closest('.product-gallery') || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? galleryItems.length-1 : galleryIndex + (event.key === 'ArrowLeft' ? -1 : 1);
      selectGallery(next);
    });
    window.addEventListener('hashchange',renderRoute);

    // One disclosure menu supports pointer hover, click/touch and keyboard access.
    const mega = $('.mega-menu'), megaPanel = $('#mega-panel'), megaToggle = $('#mega-toggle');
    let megaTimer;
    function setMega(open, restoreFocus = false) {
      clearTimeout(megaTimer);
      megaToggle.setAttribute('aria-expanded',String(open));
      mega.classList.toggle('is-open',open);
      megaPanel.inert = !open;
      if (restoreFocus) megaToggle.focus();
    }
    $('#mega-brands').innerHTML = [...$('#brand-filters').querySelectorAll('[data-brand]')].map(button =>
      '<button type="button" data-mega-brand="' + escape(button.dataset.brand) + '">' + escape(button.dataset.brand || 'Tất cả laptop') + '</button>').join('');
    megaToggle.addEventListener('click',() => setMega(megaToggle.getAttribute('aria-expanded') !== 'true'));
    mega.addEventListener('pointerenter',event => {
      if (event.pointerType === 'mouse' && matchMedia('(hover:hover) and (pointer:fine)').matches) {
        clearTimeout(megaTimer);megaTimer = setTimeout(() => setMega(true),120);
      }
    });
    mega.addEventListener('pointerleave',event => {
      if (event.pointerType === 'mouse') { clearTimeout(megaTimer);megaTimer = setTimeout(() => { if (!mega.contains(document.activeElement)) setMega(false); },150); }
    });
    mega.addEventListener('focusout',event => { if (!mega.contains(event.relatedTarget)) setMega(false); });
    mega.addEventListener('keydown',event => {
      if (event.key === 'Escape') { event.preventDefault();setMega(false,true); }
      if (event.key === 'ArrowDown' && event.target === megaToggle) { event.preventDefault();setMega(true);megaPanel.querySelector('button').focus(); }
    });
    mega.addEventListener('click',event => {
      const button = event.target.closest('[data-mega-brand]');
      if (button) {
        resetFilters();state.brand=button.dataset.megaBrand;renderProducts();
        location.hash='products';renderRoute();setMega(false,true);
        $('#main-nav').classList.remove('is-open');
        $('#menu-toggle').setAttribute('aria-expanded','false');
        $('#products').scrollIntoView({behavior:reducedMotion()?'instant':'smooth'});
      } else if (event.target.closest('a')) setMega(false);
    });
    document.addEventListener('click',event => { if (!mega.contains(event.target)) setMega(false); });
    window.addEventListener('hashchange',() => setMega(false));

    $('#year').textContent=new Date().getFullYear();
    updateCartBadge(); loadProducts();
  })();
  
