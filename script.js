// ==================================================
// MaiaekHub — Application Logic
// ==================================================

// ---------- Supabase Client ----------
// สำคัญ: ห้ามให้ error ตรงนี้ทำให้ script.js ทั้งไฟล์หยุดทำงาน
// (เดิมถ้า Supabase library โหลดไม่สำเร็จ บรรทัดนี้จะ throw แบบ synchronous
//  แล้วโค้ดทุกอย่างข้างล่างจะไม่ถูกรันเลย รวมถึงปุ่ม/แท็บทั้งหมดในหน้าเว็บ)
const supabaseUrl = 'https://vcbugctmyqubqvabrric.supabase.co';
const supabaseKey = 'sb_publishable_SceKfh95c5dbx9hAK3Hhng_9Api0Ynj';
let sb = null;
let supabaseInitError = null;
try {
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase library ไม่ได้โหลด');
  }
  sb = window.supabase.createClient(supabaseUrl, supabaseKey);
} catch (err) {
  supabaseInitError = err;
  console.error('Supabase init failed:', err);
}

// ---------- State ----------
let currentUser = null;      // auth user object
let currentProfile = null;   // { id, username, role, email }
let allProducts = [];        // cached product list
let editingProductId = null; // null = adding new, string = editing existing
let pendingDeleteProduct = null; // Product | Product[] (bulk delete)
let currentCategoryFilter = 'all'; // 'all' | 'K06' | 'C04' | ... (คำนวณจากรหัสสินค้า)

// ---- Sort / Pagination / Bulk select state (ตาราง products) ----
let sortColumn = null;        // 'product_code' | 'product_name' | 'price' | null
let sortDirection = 'asc';    // 'asc' | 'desc'
let currentPage = 1;
const PAGE_SIZE = Infinity; // แสดงสินค้าทั้งหมดในหน้าเดียว (ไม่แบ่งหน้า)
let selectedProductIds = new Set();
let lastFilteredProducts = []; // เก็บผลลัพธ์ filter+sort ล่าสุด (ก่อนแบ่งหน้า) ไว้ใช้กับ export/bulk

let allPriceRequests = [];       // cached price request list
let priceRequestsLoaded = false; // lazy-load: fetch only when tab first opened
let editingPrId = null;          // null = adding new, string = editing existing
let pendingDeletePr = null;
let currentPrFilter = 'all';     // 'all' | 'pending' | 'in_progress' | 'done'
let currentPrSearch = '';        // ค้นหาจากรายละเอียด หรือ ผู้ขอ
let selectedPrSource = null;     // 'personal_chat' | 'group_chat' | 'cs_group'

let allVendorMappings = [];      // cached vendor mapping list
let vendorMappingsLoaded = false; // lazy-load: fetch only when tab first opened
let editingVendorId = null;      // null = adding new, string = editing existing
let pendingDeleteVendor = null;
let renameSelectedFiles = [];    // File[] queued for Rename_PO processing

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);

const authScreen = $('authScreen');
const appScreen = $('appScreen');
const toastEl = $('toast');

// ==================================================
// Init
// ==================================================
document.addEventListener('DOMContentLoaded', init);

// ============ PWA: register service worker ============
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}

async function init() {
  // bind UI events ก่อนเสมอ ไม่ว่า Supabase จะพร้อมใช้งานหรือไม่
  bindAuthTabs();
  bindAuthForms();
  bindAppEvents();
  bindModalEvents();
  bindImportEvents();
  bindProfileEvents();
  bindViewTabs();
  bindPriceRequestEvents();
  bindVendorEvents();
  bindRenamePoEvents();

  showAuthScreen();

  if (supabaseInitError || !sb) {
    showToast('เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่ (Reload) หรือตรวจสอบการเชื่อมต่ออินเทอร์เน็ต', 'error');
    return;
  }

  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      await handleSignedIn(session.user);
    } else {
      showAuthScreen();
    }

    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentProfile = null;
        showAuthScreen();
      }
    });
  } catch (err) {
    console.error('init session check failed:', err);
    showToast('เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่', 'error');
  }
}

// ==================================================
// Toast
// ==================================================
let toastTimer = null;
function showToast(message, type = 'default') {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = 'toast is-visible' + (type === 'error' ? ' is-error' : type === 'success' ? ' is-success' : '');
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('is-visible');
  }, 3200);
}

// ==================================================
// Auth: tabs
// ==================================================
function bindAuthTabs() {
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => {
        t.classList.remove('is-active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');

      const target = tab.dataset.tab;
      document.querySelectorAll('.auth-form').forEach(f => {
        f.classList.toggle('is-active', f.dataset.form === target);
      });
    });
  });
}

// ==================================================
// Auth: login / register forms
// ==================================================
function bindAuthForms() {
  $('loginForm').addEventListener('submit', onLoginSubmit);
  $('registerForm').addEventListener('submit', onRegisterSubmit);
  $('logoutBtn').addEventListener('click', onLogout);
}

function setFieldError(el, message) {
  if (!message) {
    el.textContent = '';
    el.classList.remove('is-visible');
  } else {
    el.textContent = message;
    el.classList.add('is-visible');
  }
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const usernameOrEmail = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  const errorEl = $('loginError');
  const btn = $('loginSubmit');

  setFieldError(errorEl, '');

  if (!sb) {
    setFieldError(errorEl, 'เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่');
    return;
  }
  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    // Login รับได้ทั้ง username หรือ email — ถ้าไม่มี @ ให้ค้นหา email จริงจาก profiles ก่อน
    let email = usernameOrEmail;
    if (!usernameOrEmail.includes('@')) {
      const { data: profileRow, error: lookupErr } = await sb
        .from('profiles')
        .select('id, username, email')
        .eq('username', usernameOrEmail)
        .maybeSingle();

      if (lookupErr || !profileRow) {
        throw new Error('ไม่พบชื่อผู้ใช้นี้ในระบบ');
      }
      if (!profileRow.email) {
        throw new Error('บัญชีนี้ไม่มีอีเมลผูกอยู่ กรุณาติดต่อผู้ดูแลระบบ');
      }
      // ใช้ email จริงที่ผูกไว้กับ username ตอนสมัคร (เก็บในคอลัมน์ profiles.email)
      email = profileRow.email;
    }

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;

    await handleSignedIn(data.user);
    $('loginForm').reset();
  } catch (err) {
    setFieldError(errorEl, err.message === 'Invalid login credentials'
      ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
      : (err.message || 'เข้าสู่ระบบไม่สำเร็จ'));
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

async function onRegisterSubmit(e) {
  e.preventDefault();
  const username = $('registerUsername').value.trim();
  const email = $('registerEmail').value.trim();
  const password = $('registerPassword').value;
  const errorEl = $('registerError');
  const successEl = $('registerSuccess');
  const btn = $('registerSubmit');

  setFieldError(errorEl, '');
  setFieldError(successEl, '');

  if (!sb) {
    setFieldError(errorEl, 'เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    if (username.length < 3) throw new Error('ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');

    // เช็คว่า username ซ้ำหรือไม่
    const { data: existing } = await sb
      .from('profiles')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (existing) throw new Error('ชื่อผู้ใช้นี้ถูกใช้งานแล้ว');

    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: { data: { username, email } }
    });
    if (error) throw error;

    // เก็บ/อัปเดต email ลงตาราง profiles ทันทีที่มี user id
    // (เผื่อ trigger สร้าง row profiles อัตโนมัติแต่ไม่ได้ใส่ email มาให้)
    if (data.user) {
      await sb
        .from('profiles')
        .update({ email })
        .eq('id', data.user.id);
    }

    if (data.session) {
      // ไม่ต้องยืนยันอีเมล — เข้าระบบได้ทันที
      await handleSignedIn(data.user);
      $('registerForm').reset();
    } else {
      successEl.textContent = 'สมัครสมาชิกสำเร็จ! กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ (หากเปิดใช้งานการยืนยันอีเมล)';
      successEl.classList.add('is-visible');
      $('registerForm').reset();
    }
  } catch (err) {
    setFieldError(errorEl, err.message || 'สมัครสมาชิกไม่สำเร็จ');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

async function onLogout() {
  await sb.auth.signOut();
  allPriceRequests = [];
  priceRequestsLoaded = false;
  currentPrFilter = 'all';
  currentPrSearch = '';
  showAuthScreen();
}

// ==================================================
// Post sign-in: load profile, show app
// ==================================================
async function handleSignedIn(user) {
  currentUser = user;

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, username, role, email, display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  if (error || !profile) {
    showToast('ไม่พบข้อมูลผู้ใช้งาน กรุณาลองใหม่', 'error');
    await sb.auth.signOut();
    showAuthScreen();
    return;
  }

  // เผื่อ profile เก่ายังไม่มี email ผูกอยู่ (บัญชีที่สมัครก่อนอัปเดตระบบนี้) ให้เติมให้อัตโนมัติ
  if (!profile.email && user.email) {
    await sb.from('profiles').update({ email: user.email }).eq('id', user.id);
    profile.email = user.email;
  }

  currentProfile = profile;
  applyRolePermissions();
  applySavedTabOrder();
  showAppScreen();
  await loadProducts();
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', general_user: 'General User' }[role] || role;
}

function applyRolePermissions() {
  const nameToShow = currentProfile.display_name || currentProfile.username;
  $('userBadge').innerHTML = `<span class="role-dot"></span>${escapeHtml(nameToShow)} · ${roleLabel(currentProfile.role)}`;
  $('historyBtn').hidden = !(currentProfile.role === 'owner' || currentProfile.role === 'admin');
  renderHeaderAvatar();
}

function renderHeaderAvatar() {
  const img = $('profileAvatarImg');
  const fallback = $('profileAvatarFallback');
  if (currentProfile.avatar_url) {
    img.src = currentProfile.avatar_url;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = (currentProfile.display_name || currentProfile.username || 'M').charAt(0).toUpperCase();
  }
}

function canDelete() {
  return currentProfile && (currentProfile.role === 'owner' || currentProfile.role === 'admin');
}

// ==================================================
// Screen switching
// ==================================================
function showAuthScreen() {
  authScreen.style.display = 'flex';
  appScreen.classList.remove('is-active');
}

function showAppScreen() {
  authScreen.style.display = 'none';
  appScreen.classList.add('is-active');
}

// ==================================================
// App events (toolbar, search, add button)
// ==================================================
function bindAppEvents() {
  $('searchInput').addEventListener('input', debounce(() => {
    currentPage = 1;
    renderProducts();
  }, 150));
  $('addProductBtn').addEventListener('click', () => openProductModal(null));
  $('historyBtn').addEventListener('click', openHistoryModal);
  bindSortEvents();
  bindBulkSelectionEvents();
  bindPaginationEvents();
  bindScrollNavEvents();
}

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// ==================================================
// View tabs (สินค้า / ขอราคา)
// ==================================================
function bindViewTabs() {
  document.querySelectorAll('.view-tab[data-view]').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  document.querySelectorAll('.nav-dropdown-item[data-view]').forEach(item => {
    item.addEventListener('click', () => {
      switchView(item.dataset.view);
      closeToolsDropdown();
    });
  });

  const dropdownBtn = $('toolsDropdownBtn');
  dropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleToolsDropdown();
  });

  document.addEventListener('click', (e) => {
    const insideTrigger = $('toolsDropdown').contains(e.target);
    const insideMenu = $('toolsDropdownMenu').contains(e.target);
    if (!insideTrigger && !insideMenu) closeToolsDropdown();
  });

  bindTabDragReorder();
}

// ==================================================
// View tabs — drag & drop reorder (เก็บลำดับต่อผู้ใช้ใน localStorage)
// ==================================================
function tabOrderStorageKey() {
  const uid = currentUser && currentUser.id ? currentUser.id : 'anon';
  return `maiaekhub:tabOrder:${uid}`;
}

function bindTabDragReorder() {
  const nav = $('viewTabsNav');
  let dragEl = null;

  nav.querySelectorAll('[data-tab-key]').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      // ไม่ให้เริ่มลากถ้าเมนู "เครื่องมือ" กำลังเปิดอยู่ (จะกวนกับการคลิกเปิดเมนู)
      dragEl = el;
      el.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', el.dataset.tabKey); } catch (_) {}
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('is-dragging');
      dragEl = null;
      nav.querySelectorAll('[data-tab-key]').forEach(t => t.classList.remove('drag-over'));
      saveCurrentTabOrder();
    });

    el.addEventListener('dragover', (e) => {
      if (!dragEl || dragEl === el) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      nav.querySelectorAll('[data-tab-key]').forEach(t => t.classList.remove('drag-over'));
      el.classList.add('drag-over');
      el.classList.toggle('drag-over-before', before);
      el.classList.toggle('drag-over-after', !before);
    });

    el.addEventListener('drop', (e) => {
      if (!dragEl || dragEl === el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientX - rect.left) < rect.width / 2;
      nav.insertBefore(dragEl, before ? el : el.nextSibling);
      el.classList.remove('drag-over', 'drag-over-before', 'drag-over-after');
    });
  });
}

function saveCurrentTabOrder() {
  const order = Array.from($('viewTabsNav').querySelectorAll('[data-tab-key]')).map(el => el.dataset.tabKey);
  try {
    localStorage.setItem(tabOrderStorageKey(), JSON.stringify(order));
  } catch (_) { /* localStorage อาจไม่พร้อมใช้งาน — ข้ามไปเงียบๆ */ }
}

function applySavedTabOrder() {
  let order;
  try {
    order = JSON.parse(localStorage.getItem(tabOrderStorageKey()) || 'null');
  } catch (_) { order = null; }
  if (!Array.isArray(order) || order.length === 0) return;

  const nav = $('viewTabsNav');
  const els = {};
  nav.querySelectorAll('[data-tab-key]').forEach(el => { els[el.dataset.tabKey] = el; });

  order.forEach(key => {
    if (els[key]) nav.appendChild(els[key]);
  });
  // เผื่อมีแท็บใหม่ที่ยังไม่เคยถูกบันทึกลำดับไว้ ให้ต่อท้ายตามเดิม
  Object.keys(els).forEach(key => {
    if (!order.includes(key)) nav.appendChild(els[key]);
  });
}

function toggleToolsDropdown() {
  const isOpen = $('toolsDropdown').classList.contains('is-open');
  if (isOpen) closeToolsDropdown(); else openToolsDropdown();
}

function openToolsDropdown() {
  const btn = $('toolsDropdownBtn');
  const menu = $('toolsDropdownMenu');

  $('toolsDropdown').classList.add('is-open');
  menu.hidden = false;
  btn.setAttribute('aria-expanded', 'true');

  // .view-tabs มี overflow-x: auto ซึ่งจะตัด dropdown menu ที่เป็น position:absolute
  // ทิ้งไป — ย้าย menu ไปแปะที่ <body> แล้วคำนวณตำแหน่งเอง เพื่อไม่ให้โดน clip
  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.style.left = rect.left + 'px';
  document.body.appendChild(menu);
}

function closeToolsDropdown() {
  const dropdown = $('toolsDropdown');
  const menu = $('toolsDropdownMenu');

  dropdown.classList.remove('is-open');
  menu.hidden = true;
  $('toolsDropdownBtn').setAttribute('aria-expanded', 'false');

  // ย้าย menu กลับเข้าที่เดิมใน DOM (ในกล่อง .nav-dropdown)
  if (menu.parentElement !== dropdown) {
    menu.style.position = '';
    menu.style.top = '';
    menu.style.left = '';
    dropdown.appendChild(menu);
  }
}

function switchView(view) {
  document.querySelectorAll('.view-tab[data-view]').forEach(tab => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  document.querySelectorAll('.nav-dropdown-item[data-view]').forEach(item => {
    item.classList.toggle('is-active', item.dataset.view === view);
  });

  // "เครื่องมือ" trigger เองไม่ถือเป็น view-tab ที่มี data-view ตรงๆ
  // แต่ให้ไฮไลต์เมื่อ view ปัจจุบันคือหนึ่งในเมนูย่อยของมัน
  $('toolsDropdownBtn').classList.toggle('is-active', view === 'renamePo');

  $('productsView').hidden = view !== 'products';
  $('priceRequestsView').hidden = view !== 'priceRequests';
  $('renamePoView').hidden = view !== 'renamePo';
  $('productsScrollNav').hidden = view !== 'products';

  if (view === 'priceRequests' && !priceRequestsLoaded) {
    loadPriceRequests();
  }
  if (view === 'renamePo' && !vendorMappingsLoaded) {
    loadVendorMappings();
  }
}

// ==================================================
// Load & render products
// ==================================================
async function loadProducts() {
  $('loadingState').style.display = 'flex';
  $('emptyState').hidden = true;

  const { data, error } = await sb
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  $('loadingState').style.display = 'none';

  if (error) {
    showToast('โหลดข้อมูลสินค้าไม่สำเร็จ: ' + error.message, 'error');
    allProducts = [];
  } else {
    allProducts = data || [];
  }
  renderProducts();
}

function getProductCategory(productCode) {
  const code = (productCode || '').trim().toUpperCase();
  // หมวด = ตัวอักษร 1 ตัวที่ตำแหน่งที่ 5 + เลข 2 หลักถัดไป (ตำแหน่งที่ 6-7)
  // เช่น OTHEK06000125 -> K06, TASEC04000037 -> C04
  const match = code.match(/^.{4}([A-Z]\d{2})/);
  return match ? match[1] : null;
}

function getAvailableCategories() {
  const counts = new Map();
  allProducts.forEach(p => {
    const cat = getProductCategory(p.product_code);
    if (!cat) return;
    counts.set(cat, (counts.get(cat) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, count]) => ({ category, count }));
}

function renderCategoryFilters() {
  const wrap = $('categoryFilters');
  const categories = getAvailableCategories();

  if (categories.length === 0) {
    wrap.innerHTML = '';
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;

  // ถ้าหมวดที่เคยเลือกไว้หายไป (เช่นลบสินค้าหมวดนั้นหมด) ให้กลับไปที่ "ทั้งหมด"
  if (currentCategoryFilter !== 'all' && !categories.some(c => c.category === currentCategoryFilter)) {
    currentCategoryFilter = 'all';
  }

  const totalCount = allProducts.length;
  const chips = [
    `<button class="category-filter-chip${currentCategoryFilter === 'all' ? ' is-active' : ''}" data-category="all" role="tab" aria-selected="${currentCategoryFilter === 'all'}">
      <span>ทั้งหมด</span><span class="category-filter-chip-count">${totalCount}</span>
    </button>`
  ];
  categories.forEach(({ category, count }) => {
    chips.push(`<button class="category-filter-chip${currentCategoryFilter === category ? ' is-active' : ''}" data-category="${escapeHtml(category)}" role="tab" aria-selected="${currentCategoryFilter === category}">
      <span>${escapeHtml(category)}</span><span class="category-filter-chip-count">${count}</span>
    </button>`);
  });

  wrap.innerHTML = chips.join('');

  wrap.querySelectorAll('.category-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentCategoryFilter = chip.dataset.category;
      currentPage = 1;
      renderProducts();
    });
  });
}

function getFilteredSortedProducts() {
  const query = $('searchInput').value.trim().toLowerCase();
  let filtered = query
    ? allProducts.filter(p =>
        (p.product_name || '').toLowerCase().includes(query) ||
        (p.product_code || '').toLowerCase().includes(query) ||
        (p.items_vendor || '').toLowerCase().includes(query))
    : allProducts.slice();

  if (currentCategoryFilter !== 'all') {
    filtered = filtered.filter(p => getProductCategory(p.product_code) === currentCategoryFilter);
  }

  if (sortColumn) {
    const dir = sortDirection === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let av = a[sortColumn];
      let bv = b[sortColumn];
      if (sortColumn === 'price') {
        av = Number(av) || 0;
        bv = Number(bv) || 0;
        return (av - bv) * dir;
      }
      av = (av || '').toString().toLowerCase();
      bv = (bv || '').toString().toLowerCase();
      return av.localeCompare(bv, 'th') * dir;
    });
  }

  return filtered;
}

function renderProducts() {
  renderCategoryFilters();

  const filtered = getFilteredSortedProducts();
  lastFilteredProducts = filtered;

  // ตัด id ที่เลือกไว้แต่ไม่อยู่ใน filtered ปัจจุบันออก (กันเลือกค้างข้ามหมวด/คำค้น)
  updateSortHeaderUI();

  const query = $('searchInput').value.trim();

  const tbody = $('productTableBody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    $('emptyState').hidden = false;
    $('emptyStateText').textContent = query
      ? `ไม่พบสินค้าที่ตรงกับ "${query}"`
      : currentCategoryFilter !== 'all'
      ? `ไม่มีสินค้าในหมวด "${currentCategoryFilter}"`
      : 'ยังไม่มีข้อมูลสินค้า — เริ่มเพิ่มสินค้าแรกของคุณ';
    $('paginationBar').hidden = true;
    renderBulkBar();
    return;
  }
  $('emptyState').hidden = true;

  // ---- Pagination ----
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const canDel = canDelete();

  pageItems.forEach(p => {
    const tr = document.createElement('tr');
    const isSelected = selectedProductIds.has(p.id);
    if (isSelected) tr.classList.add('is-selected');
    tr.innerHTML = `
      <td class="checkbox-col"><input type="checkbox" class="row-select-checkbox" data-id="${p.id}" ${isSelected ? 'checked' : ''} aria-label="เลือกสินค้า ${escapeHtml(p.product_name)}"></td>
      <td class="product-code" data-label="รหัสสินค้า">${escapeHtml(p.product_code)}</td>
      <td class="product-name" data-label="ชื่อสินค้า">
        <span class="product-name-text">${escapeHtml(p.product_name)}</span>
        <button class="copy-btn" data-action="copy" data-id="${p.id}" title="คัดลอกรหัส + ชื่อสินค้า" aria-label="คัดลอกรหัสและชื่อสินค้า ${escapeHtml(p.product_name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </td>
      <td class="items-vendor" data-label="Items Vendor">${p.items_vendor ? escapeHtml(p.items_vendor) : '<span class="cell-empty">—</span>'}</td>
      <td class="num" data-label="ราคา">${formatMoney(p.price)}</td>
      <td class="num" data-label="สเต็ป 1">${p.discount_step_1 != null && p.discount_step_1 !== '' ? escapeHtml(p.discount_step_1) : '<span class="cell-empty">—</span>'}</td>
      <td class="num" data-label="สเต็ป 2">${p.discount_step_2 != null && p.discount_step_2 !== '' ? escapeHtml(p.discount_step_2) : '<span class="cell-empty">—</span>'}</td>
      <td class="num" data-label="สเต็ป 3">${p.discount_step_3 != null && p.discount_step_3 !== '' ? escapeHtml(p.discount_step_3) : '<span class="cell-empty">—</span>'}</td>
      <td class="num" data-label="สเต็ป 4">${p.discount_step_4 != null && p.discount_step_4 !== '' ? escapeHtml(p.discount_step_4) : '<span class="cell-empty">—</span>'}</td>
      <td class="order-condition" data-label="เงื่อนไข">${p.order_condition ? escapeHtml(p.order_condition) : '<span class="cell-empty">—</span>'}</td>
      <td class="price-date" data-label="อัปเดตราคาล่าสุด">${p.price_updated_at ? formatPrDate(p.price_updated_at) : '<span class="cell-empty">—</span>'}</td>
      <td class="actions-col" data-label="">
        <div class="row-actions">
          <button class="icon-btn" data-action="edit" data-id="${p.id}" title="แก้ไข" aria-label="แก้ไขสินค้า ${escapeHtml(p.product_name)}">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn icon-btn-danger" data-action="delete" data-id="${p.id}" title="ลบ" aria-label="ลบสินค้า ${escapeHtml(p.product_name)}" ${canDel ? '' : 'disabled'}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', () => openProductModal(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteModal(btn.dataset.id));
  });
  tbody.querySelectorAll('[data-action="copy"]').forEach(btn => {
    btn.addEventListener('click', () => copyProductCodeAndName(btn));
  });
  tbody.querySelectorAll('.row-select-checkbox').forEach(cb => {
    cb.addEventListener('change', () => onRowCheckboxChange(cb));
  });

  renderPaginationBar(filtered.length, totalPages, startIdx, pageItems.length);
  updateSelectAllCheckboxState(pageItems);
  renderBulkBar();
}

function renderPaginationBar(totalCount, totalPages, startIdx, pageItemCount) {
  const bar = $('paginationBar');
  if (totalCount <= PAGE_SIZE) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  const from = startIdx + 1;
  const to = startIdx + pageItemCount;
  $('paginationInfo').textContent = `แสดง ${from}-${to} จาก ${totalCount} รายการ`;
  $('paginationPageLabel').textContent = `หน้า ${currentPage} / ${totalPages}`;
  $('paginationPrevBtn').disabled = currentPage <= 1;
  $('paginationNextBtn').disabled = currentPage >= totalPages;
}

function bindPaginationEvents() {
  $('paginationPrevBtn').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderProducts(); }
  });
  $('paginationNextBtn').addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(lastFilteredProducts.length / PAGE_SIZE));
    if (currentPage < totalPages) { currentPage++; renderProducts(); }
  });
}

function bindScrollNavEvents() {
  $('scrollTopBtn').addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  $('scrollBottomBtn').addEventListener('click', () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
}

// ---- Sortable column headers ----
function bindSortEvents() {
  document.querySelectorAll('.product-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortColumn === col) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortColumn = col;
        sortDirection = 'asc';
      }
      currentPage = 1;
      renderProducts();
    });
  });
}

function updateSortHeaderUI() {
  document.querySelectorAll('.product-table thead th.sortable').forEach(th => {
    th.classList.remove('is-sorted', 'is-sorted-asc', 'is-sorted-desc');
    if (th.dataset.sort === sortColumn) {
      th.classList.add('is-sorted', sortDirection === 'asc' ? 'is-sorted-asc' : 'is-sorted-desc');
    }
  });
}

// ---- Bulk selection ----
function bindBulkSelectionEvents() {
  $('selectAllCheckbox').addEventListener('change', (e) => {
    // เลือก/ยกเลิกเฉพาะรายการที่แสดงอยู่ในหน้าปัจจุบัน
    const startIdx = (currentPage - 1) * PAGE_SIZE;
    const pageItems = lastFilteredProducts.slice(startIdx, startIdx + PAGE_SIZE);
    if (e.target.checked) {
      pageItems.forEach(p => selectedProductIds.add(p.id));
    } else {
      pageItems.forEach(p => selectedProductIds.delete(p.id));
    }
    renderProducts();
  });

  $('bulkClearBtn').addEventListener('click', () => {
    selectedProductIds.clear();
    renderProducts();
  });
  $('bulkDeleteBtn').addEventListener('click', onBulkDeleteClick);
  $('bulkExportBtn').addEventListener('click', onBulkExportClick);
}

function onRowCheckboxChange(cb) {
  const id = cb.dataset.id;
  if (cb.checked) selectedProductIds.add(id);
  else selectedProductIds.delete(id);

  const tr = cb.closest('tr');
  if (tr) tr.classList.toggle('is-selected', cb.checked);

  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageItems = lastFilteredProducts.slice(startIdx, startIdx + PAGE_SIZE);
  updateSelectAllCheckboxState(pageItems);
  renderBulkBar();
}

function updateSelectAllCheckboxState(pageItems) {
  const selectAll = $('selectAllCheckbox');
  if (!pageItems || pageItems.length === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }
  const selectedCount = pageItems.filter(p => selectedProductIds.has(p.id)).length;
  selectAll.checked = selectedCount === pageItems.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < pageItems.length;
}

function renderBulkBar() {
  const bar = $('bulkActionBar');
  const count = selectedProductIds.size;
  if (count === 0) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  $('bulkSelectedCount').textContent = count;
}

function onBulkDeleteClick() {
  if (!canDelete()) return;
  const products = allProducts.filter(p => selectedProductIds.has(p.id));
  if (products.length === 0) return;
  pendingDeleteProduct = products; // array = bulk
  $('deleteModalText').innerHTML = `ต้องการลบสินค้า <strong>${products.length} รายการ</strong> ที่เลือกไว้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`;
  $('deleteModal').hidden = false;
  $('deleteModal').classList.add('is-visible');
}

function onBulkExportClick() {
  const products = allProducts.filter(p => selectedProductIds.has(p.id));
  if (products.length === 0) return;
  exportProductsToCsv(products, 'ที่เลือก');
}

async function copyProductCodeAndName(btn) {
  const p = allProducts.find(x => x.id === btn.dataset.id);
  if (!p) return;
  const text = `${p.product_code} ${p.product_name}`;

  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    // fallback สำหรับเบราว์เซอร์/บริบทที่ Clipboard API ใช้ไม่ได้ (เช่นไม่ใช่ HTTPS)
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* เงียบไว้ ไม่ block การใช้งาน */ }
    document.body.removeChild(ta);
  }

  showToast('คัดลอกแล้ว', 'success');
  btn.classList.add('is-copied');
  setTimeout(() => btn.classList.remove('is-copied'), 1200);
}

function formatMoney(n) {
  return Number(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ==================================================
// Product Modal (Add / Edit)
// ==================================================
function bindModalEvents() {
  $('closeProductModal').addEventListener('click', closeProductModal);
  $('cancelProductForm').addEventListener('click', closeProductModal);
  $('productForm').addEventListener('submit', onSaveProduct);
  $('productModal').addEventListener('click', (e) => { if (e.target === $('productModal')) closeProductModal(); });

  productCalendar = createCalendarInstance({
    hiddenInput: 'fPriceDate',
    label: 'fPriceDateLabel',
    trigger: 'fPriceDateTrigger',
    popover: 'productCalendarPopover',
    monthLabel: 'productCalMonthLabel',
    grid: 'productCalendar',
    prevBtn: 'productCalPrevMonth',
    nextBtn: 'productCalNextMonth',
    todayBtn: 'productCalTodayBtn',
  }, () => { priceDateManuallySet = true; });
  productCalendar.bind();


  $('closeDeleteModal').addEventListener('click', closeDeleteModal);
  $('cancelDelete').addEventListener('click', closeDeleteModal);
  $('confirmDelete').addEventListener('click', onConfirmDelete);
  $('deleteModal').addEventListener('click', (e) => { if (e.target === $('deleteModal')) closeDeleteModal(); });

  $('closeHistoryModal').addEventListener('click', closeHistoryModal);
  $('historyModal').addEventListener('click', (e) => { if (e.target === $('historyModal')) closeHistoryModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeProductModal();
      closeDeleteModal();
      closeHistoryModal();
      closeImportModal();
      closeProfileModal();
      closeVendorModal();
      closeDeleteVendorModal();
      closeToolsDropdown();
    }
  });
}

function openProductModal(productId) {
  editingProductId = productId;
  setFieldError($('productFormError'), '');

  if (productId) {
    const p = allProducts.find(x => x.id === productId);
    if (!p) return;
    $('productModalTitle').textContent = 'แก้ไขสินค้า';
    $('productId').value = p.id;
    $('fProductCode').value = p.product_code || '';
    $('fProductName').value = p.product_name || '';
    $('fItemsVendor').value = p.items_vendor || '';
    $('fPrice').value = p.price ?? '';
    $('fStep1').value = p.discount_step_1 ?? '';
    $('fStep2').value = p.discount_step_2 ?? '';
    $('fStep3').value = p.discount_step_3 ?? '';
    $('fStep4').value = p.discount_step_4 ?? '';
    $('fCondition').value = p.order_condition || '';
    productCalendar.setDate(p.price_updated_at ? p.price_updated_at.slice(0, 10) : todayIso());
    // เก็บค่าตั้งต้นไว้เทียบตอนบันทึก ว่าราคา/ส่วนลดถูกแก้ไขจริงหรือไม่
    productFormOriginalPriceSnapshot = priceSnapshotOf(p);
    priceDateManuallySet = false;
  } else {
    $('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
    $('productForm').reset();
    $('productId').value = '';
    productCalendar.setDate(todayIso());
    productFormOriginalPriceSnapshot = null;
    priceDateManuallySet = false;
  }

  $('productModal').hidden = false;
  $('productModal').classList.add('is-visible');
  $('fProductCode').focus();
}

function closeProductModal() {
  $('productModal').classList.remove('is-visible');
  $('productModal').hidden = true;
  editingProductId = null;
}

function priceSnapshotOf(data) {
  // ใช้เทียบว่าราคา/ส่วนลดถูกแก้ไขจริงหรือไม่ (ไม่รวม order_condition หรือฟิลด์อื่น)
  return JSON.stringify([data.price, data.discount_step_1, data.discount_step_2, data.discount_step_3, data.discount_step_4]);
}

let productFormOriginalPriceSnapshot = null; // snapshot ราคา/ส่วนลดตอนเปิดฟอร์มแก้ไข (null = กำลังเพิ่มใหม่)
let priceDateManuallySet = false; // true ถ้าผู้ใช้เลือกวันที่ในฟอร์มสินค้าเอง (ไม่ใช่ auto-stamp)

function readProductForm() {
  return {
    product_code: $('fProductCode').value.trim(),
    product_name: $('fProductName').value.trim(),
    items_vendor: $('fItemsVendor').value.trim() || null,
    price: parseFloat($('fPrice').value) || 0,
    discount_step_1: $('fStep1').value.trim() || null,
    discount_step_2: $('fStep2').value.trim() || null,
    discount_step_3: $('fStep3').value.trim() || null,
    discount_step_4: $('fStep4').value.trim() || null,
    order_condition: $('fCondition').value.trim() || null,
    price_updated_at: $('fPriceDate').value || todayIso(),
  };
}

// ตรวจว่าสเต็ปส่วนลดเรียงจากมากไปน้อยหรือไม่ (ยิ่งซื้อเยอะ ราคาต่อหน่วยควรยิ่งถูกลง)
// สเต็ปส่วนลดตอนนี้เป็นข้อความอิสระ (พิมพ์อะไรก็ได้ เช่น "90 บาท/ลัง") — เทียบลำดับได้เฉพาะค่าที่เป็นตัวเลขล้วนๆ เท่านั้น
// ค่าที่เป็นข้อความ (ไม่ใช่ตัวเลขล้วน) จะถูกข้ามไปเงียบๆ ไม่นับเป็นผิดปกติ
// คืนค่า true ถ้าเรียงถูกต้อง (หรือว่าง/เป็นข้อความจนตรวจไม่ได้), false ถ้าผิดปกติ
function parseNumericStepOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null; // ข้อความอิสระ เช่น "90 บาท/ลัง" -> null (ข้ามการเทียบ)
}

function isDiscountStepOrderValid(data) {
  const steps = [data.price, data.discount_step_1, data.discount_step_2, data.discount_step_3, data.discount_step_4]
    .map(parseNumericStepOrNull)
    .filter(v => v !== null);
  for (let i = 1; i < steps.length; i++) {
    if (steps[i] > steps[i - 1]) return false;
  }
  return true;
}

async function onSaveProduct(e) {
  e.preventDefault();
  const errorEl = $('productFormError');
  const btn = $('saveProductBtn');
  setFieldError(errorEl, '');

  const formData = readProductForm();
  if (!formData.product_code || !formData.product_name) {
    setFieldError(errorEl, 'กรุณากรอกรหัสสินค้าและชื่อสินค้า');
    return;
  }

  if (!isDiscountStepOrderValid(formData)) {
    const proceed = confirm('สเต็ปส่วนลดที่กรอกไม่ได้เรียงจากมากไปน้อย (ราคาขั้นถัดไปแพงกว่าขั้นก่อนหน้า) ต้องการบันทึกต่อหรือไม่?');
    if (!proceed) return;
  }

  // ถ้าราคา/ส่วนลดถูกแก้ไขจริง และผู้ใช้ไม่ได้เลือกวันที่เองในฟอร์ม -> อัปเดต price_updated_at เป็นวันนี้อัตโนมัติ
  // ถ้าผู้ใช้เลือกวันที่เองแล้ว (priceDateManuallySet) ให้เคารพค่าที่เลือกไว้เสมอ
  const priceChanged = productFormOriginalPriceSnapshot !== null && productFormOriginalPriceSnapshot !== priceSnapshotOf(formData);
  if ((priceChanged || productFormOriginalPriceSnapshot === null) && !priceDateManuallySet) {
    formData.price_updated_at = todayIso();
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const id = $('productId').value;

    if (id) {
      // ---- EDIT ----
      const oldProduct = allProducts.find(p => p.id === id);
      const payload = { ...formData, updated_by: currentUser.id };

      const { data, error } = await sb
        .from('products')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      await writeAuditLog('edit', data, oldProduct, data);
      showToast('บันทึกการแก้ไขสำเร็จ', 'success');
    } else {
      // ---- ADD ----
      const payload = { ...formData, created_by: currentUser.id, updated_by: currentUser.id };
      const { data, error } = await sb
        .from('products')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;

      showToast('เพิ่มสินค้าสำเร็จ', 'success');
    }

    closeProductModal();
    await loadProducts();
  } catch (err) {
    setFieldError(errorEl, err.message?.includes('duplicate') || err.code === '23505'
      ? 'รหัสสินค้านี้มีอยู่แล้วในระบบ'
      : (err.message || 'บันทึกไม่สำเร็จ'));
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Delete Modal
// ==================================================
function openDeleteModal(productId) {
  if (!canDelete()) return;
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;
  pendingDeleteProduct = p;
  $('deleteModalText').innerHTML = `ต้องการลบสินค้า <strong>${escapeHtml(p.product_name)}</strong> (รหัส: ${escapeHtml(p.product_code)}) ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`;
  $('deleteModal').hidden = false;
  $('deleteModal').classList.add('is-visible');
}

function closeDeleteModal() {
  $('deleteModal').classList.remove('is-visible');
  $('deleteModal').hidden = true;
  pendingDeleteProduct = null;
}

async function onConfirmDelete() {
  if (!pendingDeleteProduct) return;
  const btn = $('confirmDelete');
  btn.classList.add('is-loading');
  btn.disabled = true;

  const isBulk = Array.isArray(pendingDeleteProduct);
  const products = isBulk ? pendingDeleteProduct : [pendingDeleteProduct];

  try {
    let deletedCount = 0;
    const failedNames = [];

    // ลบทีละแถว กันแถวเดียวพังแล้วล้มทั้งชุด — บอกได้ว่าตัวไหนพังจริง
    for (const p of products) {
      const { error } = await sb.from('products').delete().eq('id', p.id);
      if (error) {
        failedNames.push(p.product_name || p.product_code || p.id);
        continue;
      }
      await writeAuditLog('delete', p, p, null);
      deletedCount++;
    }

    if (failedNames.length === 0) {
      showToast(isBulk ? `ลบสินค้าสำเร็จ ${deletedCount} รายการ` : 'ลบสินค้าสำเร็จ', 'success');
    } else if (deletedCount > 0) {
      showToast(`ลบสำเร็จ ${deletedCount} รายการ, ล้มเหลว ${failedNames.length} รายการ: ${failedNames.join(', ')}`, 'error');
    } else {
      showToast('ลบไม่สำเร็จทั้งหมด: ' + failedNames.join(', '), 'error');
    }

    selectedProductIds.clear();
    closeDeleteModal();
    await loadProducts();
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'), 'error');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Audit log
// ==================================================
async function writeAuditLog(action, refProduct, oldValue, newValue) {
  try {
    await sb.from('audit_logs').insert({
      user_id: currentUser.id,
      username: currentProfile.username,
      action,
      product_id: refProduct.id,
      product_code: refProduct.product_code,
      old_value: oldValue,
      new_value: newValue,
    });
  } catch (err) {
    // ไม่ block การทำงานหลักถ้า log ล้มเหลว แต่แจ้งเตือนเบาๆ
    console.error('audit log failed', err);
  }
}

// ==================================================
// History Modal (Owner/Admin only)
// ==================================================
async function openHistoryModal() {
  if (!(currentProfile.role === 'owner' || currentProfile.role === 'admin')) return;

  $('historyModal').hidden = false;
  $('historyModal').classList.add('is-visible');
  $('historyList').innerHTML = '<div class="loading-state" style="padding:32px 0;"><div class="spinner" aria-label="กำลังโหลด"></div></div>';
  $('historyEmpty').hidden = true;

  const { data, error } = await sb
    .from('audit_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    $('historyList').innerHTML = '';
    showToast('โหลดประวัติไม่สำเร็จ: ' + error.message, 'error');
    return;
  }

  renderHistory(data || []);
}

function renderHistory(logs) {
  const list = $('historyList');
  list.innerHTML = '';

  if (logs.length === 0) {
    $('historyEmpty').hidden = false;
    return;
  }
  $('historyEmpty').hidden = true;

  logs.forEach(log => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const dt = new Date(log.created_at);
    const dateStr = dt.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

    let diffHtml = '';
    if (log.action === 'edit' && log.old_value && log.new_value) {
      diffHtml = buildDiffHtml(log.old_value, log.new_value);
    } else if (log.action === 'delete') {
      diffHtml = `<div class="history-diff">ลบสินค้า <span class="diff-code">${escapeHtml(log.product_code || '')}</span> ออกจากระบบ</div>`;
    }

    div.innerHTML = `
      <div class="history-item-head">
        <span class="history-action ${log.action}">${log.action === 'edit' ? 'แก้ไข' : 'ลบ'}</span>
        <span class="history-meta"><span class="history-user">${escapeHtml(log.username)}</span> · ${dateStr}</span>
      </div>
      ${diffHtml}
    `;
    list.appendChild(div);
  });
}

function buildDiffHtml(oldVal, newVal) {
  const fieldLabels = {
    product_code: 'รหัสสินค้า', product_name: 'ชื่อสินค้า', items_vendor: 'Items Vendor', price: 'ราคา',
    discount_step_1: 'สเต็ป 1', discount_step_2: 'สเต็ป 2',
    discount_step_3: 'สเต็ป 3', discount_step_4: 'สเต็ป 4',
    order_condition: 'เงื่อนไขการสั่งซื้อ'
  };
  const changes = [];
  Object.keys(fieldLabels).forEach(key => {
    const ov = oldVal[key];
    const nv = newVal[key];
    if (String(ov ?? '') !== String(nv ?? '')) {
      changes.push(`<div class="history-diff"><span class="diff-code">${fieldLabels[key]}</span>: ${escapeHtml(ov ?? '—')} → ${escapeHtml(nv ?? '—')}</div>`);
    }
  });
  return changes.join('') || '<div class="history-diff">ไม่มีการเปลี่ยนแปลงค่า</div>';
}

function closeHistoryModal() {
  $('historyModal').classList.remove('is-visible');
  $('historyModal').hidden = true;
}

// ==================================================
// Import Products from CSV/Excel
// ==================================================
const IMPORT_COLUMNS = [
  'product_code', 'product_name', 'items_vendor', 'price',
  'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4',
  'order_condition'
];
const IMPORT_TEMPLATE_HEADER = IMPORT_COLUMNS.join(',');
const IMPORT_TEMPLATE_SAMPLE = 'SKU-001,ตัวอย่างสินค้า,ตัวอย่าง Vendor,100.00,90.00,85.00,80.00,75.00,สั่งขั้นต่ำ 10 ชิ้น';

let importParsedRows = []; // rows after validation: { data, status: 'new'|'update'|'error', note }
let importMode = 'auto'; // ตัวเลือกที่ผู้ใช้ตั้ง: 'auto' | 'full' | 'partial'
let importEffectiveMode = 'full'; // โหมดที่ใช้จริงหลัง parse ไฟล์แล้ว (ถ้า importMode === 'auto' จะคำนวณจาก header ของไฟล์)
let importUpdatableFields = []; // ฟิลด์ที่โหมด partial จะเทียบ/อัปเดตจริง (คำนวณจาก header ของไฟล์ที่เลือก ตอน handleParsedRows)

const IMPORT_MODE_HINTS = {
  auto: 'รองรับไฟล์ .csv, .xlsx, .xls — ระบบจะดูคอลัมน์ในไฟล์แล้วเลือกให้เองว่าเป็นการนำเข้าแบบไหน:'
      + '<br>• ถ้าไฟล์มีคอลัมน์ <code>product_name</code> → ถือเป็นนำเข้าแบบเต็ม (รหัสใหม่ถูกเพิ่ม, รหัสเดิมถูกอัปเดตทับทุกฟิลด์ที่มีในไฟล์)'
      + '<br>• ถ้าไฟล์ไม่มีคอลัมน์ <code>product_name</code> → ถือเป็นปรับปรุงเฉพาะฟิลด์ที่มี โดย map ด้วย <code>product_code</code> (ใช้ได้เฉพาะรหัสที่มีอยู่แล้ว)'
      + '<br>คอลัมน์ที่ต้องมีเสมอ: <code>product_code</code>',
  full: 'บังคับนำเข้าแบบเต็ม — แถวแรกต้องเป็นหัวคอลัมน์:'
      + '<br><code>product_code, product_name, items_vendor, price, discount_step_1, discount_step_2, discount_step_3, discount_step_4, order_condition</code>'
      + '<br>(จำเป็นเฉพาะ <code>product_code</code> และ <code>product_name</code> ทุกแถว ส่วนที่เหลือเว้นว่างได้ — รหัสใหม่จะถูกเพิ่ม, รหัสที่มีอยู่แล้วจะถูกอัปเดตทับทุกฟิลด์)',
  partial: 'บังคับปรับปรุงเฉพาะบางฟิลด์ — ใช้กับรหัสสินค้าที่มีอยู่แล้วในระบบเท่านั้น (จะไม่เพิ่มรายการใหม่) — คอลัมน์ที่จำเป็น: <code>product_code</code>'
      + '<br>ใส่เฉพาะคอลัมน์ที่ต้องการแก้ไข เช่น <code>product_code, price</code> หรือ <code>product_code, discount_step_1, order_condition</code>'
      + '<br>คอลัมน์ที่ไม่ได้ใส่มาในไฟล์จะไม่ถูกแตะเลย ส่วนคอลัมน์ที่ใส่มาแต่เว้นค่าว่างไว้ในบางแถว จะถือว่าล้างค่านั้นให้ว่าง'
      + '<br>เลือก "เทมเพลตด่วน" ด้านล่างเพื่อโหลดไฟล์ตัวอย่างที่มีเฉพาะคอลัมน์ที่ต้องใช้',
};

// เทมเพลตด่วนสำหรับโหมด partial — คอลัมน์ตรงตามการใช้งานจริงแต่ละแบบ ไม่ต้องมาลบคอลัมน์เอง
const IMPORT_PARTIAL_PRESETS = {
  custom: {
    label: 'กำหนดเอง (ครบทุกคอลัมน์ที่แก้ได้ — ลบคอลัมน์ที่ไม่ใช้ออกเอง)',
    cols: ['product_code', 'items_vendor', 'price', 'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4', 'order_condition'],
    sample: ['SKU-001', 'ตัวอย่าง Vendor', '105.00', '95.00', '90.00', '85.00', '80.00', 'สั่งขั้นต่ำ 10 ชิ้น'],
    filename: 'maiaekhub_partial_update_template.csv',
  },
  rename: {
    label: 'เปลี่ยนชื่อสินค้า',
    cols: ['product_code', 'product_name'],
    sample: ['SKU-001', 'ชื่อสินค้าใหม่'],
    filename: 'maiaekhub_partial_rename_template.csv',
  },
  items_vendor: {
    label: 'แก้ไข Items Vendor',
    cols: ['product_code', 'items_vendor'],
    sample: ['SKU-001', 'Vendor ใหม่'],
    filename: 'maiaekhub_partial_items_vendor_template.csv',
  },
  price: {
    label: 'แก้ไขราคา',
    cols: ['product_code', 'price'],
    sample: ['SKU-001', '105.00'],
    filename: 'maiaekhub_partial_price_template.csv',
  },
  discount: {
    label: 'แก้ไขส่วนลด (สเต็ป 1-4)',
    cols: ['product_code', 'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4'],
    sample: ['SKU-001', '95.00', '90.00', '85.00', '80.00'],
    filename: 'maiaekhub_partial_discount_template.csv',
  },
  condition: {
    label: 'แก้เงื่อนไขสั่งซื้อ',
    cols: ['product_code', 'order_condition'],
    sample: ['SKU-001', 'สั่งขั้นต่ำ 10 ชิ้น'],
    filename: 'maiaekhub_partial_condition_template.csv',
  },
  price_discount: {
    label: 'แก้ราคา + ส่วนลด',
    cols: ['product_code', 'price', 'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4'],
    sample: ['SKU-001', '105.00', '95.00', '90.00', '85.00', '80.00'],
    filename: 'maiaekhub_partial_price_discount_template.csv',
  },
};

function bindImportEvents() {
  $('importProductsBtn').addEventListener('click', openImportModal);
  $('closeImportModal').addEventListener('click', closeImportModal);
  $('cancelImport').addEventListener('click', closeImportModal);
  $('importModal').addEventListener('click', (e) => { if (e.target === $('importModal')) closeImportModal(); });

  $('downloadTemplateBtn').addEventListener('click', downloadImportTemplate);
  $('exportProductsBtn').addEventListener('click', exportProductsToCsv);
  $('importFileInput').addEventListener('change', onImportFileSelected);
  bindImportDropzone();
  $('importDuplicateMode').addEventListener('change', () => {
    if (importParsedRows.length) renderImportPreview();
  });
  $('importModeSelect')?.addEventListener('change', (e) => {
    importMode = ['full', 'partial'].includes(e.target.value) ? e.target.value : 'auto';
    const hintEl = $('importModeHint');
    if (hintEl) hintEl.innerHTML = IMPORT_MODE_HINTS[importMode];
    if ($('importPresetField')) $('importPresetField').hidden = importMode !== 'partial';
  });
  $('confirmImportBtn').addEventListener('click', onConfirmImport);
}

function openImportModal() {
  resetImportModal();
  $('importModal').hidden = false;
  $('importModal').classList.add('is-visible');
}

function closeImportModal() {
  $('importModal').classList.remove('is-visible');
  $('importModal').hidden = true;
  resetImportModal();
}

function resetImportModal() {
  importParsedRows = [];
  $('importFileInput').value = '';
  setFieldError($('importPickError'), '');
  setFieldError($('importResultError'), '');
  $('importStepPick').hidden = false;
  $('importStepPreview').hidden = true;
  $('confirmImportBtn').hidden = true;
  $('importPreviewBody').innerHTML = '';
  $('importDuplicateMode').value = 'update';
  importMode = 'auto';
  importEffectiveMode = 'full';
  importUpdatableFields = [];
  if ($('importModeSelect')) $('importModeSelect').value = 'auto';
  if ($('importModeHint')) $('importModeHint').innerHTML = IMPORT_MODE_HINTS.auto;
  if ($('importPresetField')) $('importPresetField').hidden = true;
  if ($('importPresetSelect')) $('importPresetSelect').value = 'custom';
  if ($('duplicateModeField')) $('duplicateModeField').hidden = false;

  const zone = $('importDropzone');
  const textEl = zone?.querySelector('.import-dropzone-text');
  if (zone) zone.classList.remove('has-file', 'is-dragover');
  if (textEl) textEl.innerHTML = 'ลากไฟล์มาวางตรงนี้ หรือ <span class="import-dropzone-link">คลิกเพื่อเลือกไฟล์</span>';
}

function downloadImportTemplate() {
  let csvContent, filename;
  if (importMode === 'partial') {
    const presetKey = $('importPresetSelect')?.value || 'custom';
    const preset = IMPORT_PARTIAL_PRESETS[presetKey] || IMPORT_PARTIAL_PRESETS.custom;
    csvContent = preset.cols.join(',') + '\n' + preset.cols.map((_, i) => csvEscapeField(preset.sample[i])).join(',') + '\n';
    filename = preset.filename;
  } else {
    csvContent = IMPORT_TEMPLATE_HEADER + '\n' + IMPORT_TEMPLATE_SAMPLE + '\n';
    filename = 'maiaekhub_import_template.csv';
  }
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscapeField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // ถ้ามี comma, quote, หรือ newline ต้องครอบด้วย " และ escape " ภายในเป็น ""
  if (/[",\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function exportProductsToCsv(productsOverride, labelOverride) {
  // ไม่ระบุ list มาเอง -> export ตามตัวกรอง/คำค้นที่กำลังแสดงอยู่ตอนนี้ (ไม่ใช่ทั้งหมดเสมอไป)
  const query = $('searchInput').value.trim();
  const isFiltered = !!query || currentCategoryFilter !== 'all';
  const products = productsOverride || (isFiltered ? getFilteredSortedProducts() : allProducts);
  const label = labelOverride || (isFiltered ? 'ตามตัวกรองปัจจุบัน' : 'ทั้งหมด');

  if (!products || products.length === 0) {
    showToast('ไม่มีข้อมูลสินค้าให้ส่งออก', 'error');
    return;
  }

  const rows = products.map(p => IMPORT_COLUMNS.map(col => csvEscapeField(p[col])).join(','));
  const csvContent = IMPORT_COLUMNS.join(',') + '\n' + rows.join('\n') + '\n';

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `maiaekhub_products_${dateStr}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  showToast(`ส่งออกข้อมูล (${label}) ${products.length} รายการเรียบร้อย`, 'success');
}

function bindImportDropzone() {
  const zone = $('importDropzone');
  if (!zone) return;

  // ไฟล์ที่ลากเข้ามาซ้อนกันหลาย element (svg/span) ข้างในทำให้ dragleave ยิงเกินจำเป็นระหว่างลากผ่าน
  // นับ dragenter/dragleave คู่กันด้วย counter กันปัญหา flicker ของ .is-dragover
  let dragCounter = 0;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evtName) => {
    zone.addEventListener(evtName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  zone.addEventListener('dragenter', () => {
    dragCounter++;
    zone.classList.add('is-dragover');
  });

  zone.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) zone.classList.remove('is-dragover');
  });

  zone.addEventListener('drop', (e) => {
    dragCounter = 0;
    zone.classList.remove('is-dragover');

    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    // sync ให้ input file ตัวจริงมีค่าด้วย เผื่อโค้ดอื่นอ้างอิง $('importFileInput').files
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      $('importFileInput').files = dt.files;
    } catch {
      // เบราว์เซอร์บางตัว (โดยเฉพาะ Safari เก่า) ไม่รองรับ DataTransfer constructor — ข้ามได้ ไม่กระทบการอ่านไฟล์
    }

    showSelectedFileName(file);
    processImportFile(file);
  });
}

function showSelectedFileName(file) {
  const zone = $('importDropzone');
  const textEl = zone?.querySelector('.import-dropzone-text');
  if (!zone || !textEl) return;
  zone.classList.add('has-file');
  textEl.textContent = `เลือกไฟล์แล้ว: ${file.name}`;
}

function onImportFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  showSelectedFileName(file);
  processImportFile(file);
}

function processImportFile(file) {
  setFieldError($('importPickError'), '');

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => handleParsedRows(results.data),
      error: (err) => setFieldError($('importPickError'), 'อ่านไฟล์ CSV ไม่สำเร็จ: ' + err.message),
    });
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
        handleParsedRows(rows);
      } catch (err) {
        setFieldError($('importPickError'), 'อ่านไฟล์ Excel ไม่สำเร็จ: ' + err.message);
      }
    };
    reader.onerror = () => setFieldError($('importPickError'), 'อ่านไฟล์ไม่สำเร็จ');
    reader.readAsArrayBuffer(file);
  } else {
    setFieldError($('importPickError'), 'รองรับเฉพาะไฟล์ .csv, .xlsx, .xls เท่านั้น');
  }
}

// รองรับ header ที่มีช่องว่าง/ตัวพิมพ์ใหญ่เล็กต่างกันเล็กน้อย
// และตัด BOM ที่บางโปรแกรม (Excel, Google Sheets) แอบใส่ไว้หน้าคอลัมน์แรกตอนเซฟ/export CSV
// ต้องกันทั้ง BOM ปกติ (\uFEFF) และ BOM ที่ถูก encode ผิดซ้อนเป็น UTF-8 สองรอบ (ปรากฏเป็น "ï»¿")
// ซึ่งเกิดได้บ่อยเวลาไฟล์เดิมมี BOM อยู่แล้วแล้วถูก Google Sheets เซฟทับอีกที
// อยู่ระดับโมดูล (ไม่ใช่ในตัว normalizeImportRow) เพราะ getPresentImportColumns() ต้องใช้ตัวเดียวกันด้วย
const stripBom = (s) => s.replace(/^(\uFEFF|\u00EF\u00BB\u00BF|ï»¿)+/, '');
const cleanImportKey = (k) => stripBom(String(k)).trim().toLowerCase();

// หาว่าไฟล์ที่เลือกมามีคอลัมน์อะไรอยู่จริงบ้าง (เทียบกับ header แถวแรก) — ใช้สำหรับโหมด partial
// เพื่อไม่ให้แตะฟิลด์ที่ผู้ใช้ไม่ได้ตั้งใจจะแก้ (คอลัมน์ไม่มีในไฟล์ ≠ คอลัมน์มีแต่ค่าว่าง)
function getPresentImportColumns(rawRows) {
  const firstRow = rawRows && rawRows[0];
  if (!firstRow) return new Set();
  const keys = new Set(Object.keys(firstRow).map(cleanImportKey));
  return new Set(IMPORT_COLUMNS.filter((col) => keys.has(col)));
}

function normalizeImportRow(raw) {
  const cleanKey = cleanImportKey;

  const get = (key) => {
    const foundKey = Object.keys(raw).find(k => cleanKey(k) === key);
    return foundKey !== undefined ? stripBom(String(raw[foundKey] ?? '')).trim() : '';
  };

  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? undefined : n; // undefined = ค่าที่ parse ไม่ได้ (invalid)
  };

  const priceRaw = toNum(get('price'));
  // ราคาว่าง (ยังไม่กรอก) ให้ default เป็น 0 แทนที่จะถือเป็น error
  // เผื่อกรณีอยากเพิ่มรายการสินค้าไว้ก่อน แล้วค่อยมากรอกราคาทีหลัง
  // ถ้ากรอกมาแต่เป็นค่าที่ parse เป็นตัวเลขไม่ได้ (เช่น "abc") ยังถือเป็น error เหมือนเดิม (priceRaw === undefined)

  return {
    product_code: get('product_code'),
    product_name: get('product_name'),
    items_vendor: get('items_vendor') || null,
    price: priceRaw === null ? 0 : priceRaw,
    // สเต็ปส่วนลดเป็นข้อความอิสระ (พิมพ์อะไรก็ได้ เช่น "90 บาท/ลัง") — ไม่ต้อง parse เป็นตัวเลข
    discount_step_1: get('discount_step_1') || null,
    discount_step_2: get('discount_step_2') || null,
    discount_step_3: get('discount_step_3') || null,
    discount_step_4: get('discount_step_4') || null,
    order_condition: get('order_condition') || null,
  };
}

// เทียบค่าข้อความ (ชื่อ/เงื่อนไข/สเต็ปส่วนลด) — null, undefined, '' ถือว่าเหมือนกัน, ตัด whitespace หัวท้าย
function normCompareText(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

// เทียบราคา — กันปัญหาชนิดข้อมูลต่างกัน (string vs number จาก DB) และเศษทศนิยมเล็กน้อย
function normComparePrice(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

// เทียบสินค้าเดิมในระบบ กับแถวที่นำเข้าใหม่ ว่ามีฟิลด์ไหนเปลี่ยนแปลงบ้าง
// คืนค่า { changed, changedFields, priceChanged } — priceChanged ใช้ตัดสินว่าต้อง stamp price_updated_at ใหม่ไหม
const IMPORT_COMPARE_FIELDS = [
  { key: 'product_name', label: 'ชื่อสินค้า', norm: normCompareText },
  { key: 'items_vendor', label: 'Items Vendor', norm: normCompareText },
  { key: 'price', label: 'ราคา', norm: normComparePrice },
  { key: 'discount_step_1', label: 'ส่วนลดขั้น 1', norm: normCompareText },
  { key: 'discount_step_2', label: 'ส่วนลดขั้น 2', norm: normCompareText },
  { key: 'discount_step_3', label: 'ส่วนลดขั้น 3', norm: normCompareText },
  { key: 'discount_step_4', label: 'ส่วนลดขั้น 4', norm: normCompareText },
  { key: 'order_condition', label: 'เงื่อนไขสั่งซื้อ', norm: normCompareText },
];
const IMPORT_PRICE_FIELD_KEYS = ['price', 'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4'];

function diffImportRow(existingProduct, newRow, fieldsToCompare = IMPORT_COMPARE_FIELDS) {
  const changedFields = fieldsToCompare.filter(
    (f) => f.norm(existingProduct[f.key]) !== f.norm(newRow[f.key])
  );
  return {
    changed: changedFields.length > 0,
    changedFields,
    priceChanged: changedFields.some((f) => IMPORT_PRICE_FIELD_KEYS.includes(f.key)),
  };
}

async function handleParsedRows(rawRows) {
  if (!rawRows || rawRows.length === 0) {
    setFieldError($('importPickError'), 'ไม่พบข้อมูลในไฟล์ที่เลือก');
    return;
  }
  if (rawRows.length > 1000) {
    setFieldError($('importPickError'), 'ไฟล์มีข้อมูลมากเกินไป (สูงสุด 1000 แถวต่อครั้ง)');
    return;
  }

  // ดึงข้อมูลสินค้าที่มีอยู่แล้วในระบบ (product_code -> ตัวสินค้าเต็ม) เพื่อตรวจสอบรายการซ้ำ + เทียบว่ามีอะไรเปลี่ยนบ้าง
  const existingByCode = new Map(allProducts.map(p => [p.product_code, p]));
  const seenInFile = new Set();

  // 'auto' = ดูจากคอลัมน์ในไฟล์เอง — ไม่มีคอลัมน์ product_name แปลว่าไม่ได้ตั้งใจเปลี่ยนชื่อ ให้ถือเป็นปรับปรุงเฉพาะฟิลด์ที่มี (map ด้วย product_code)
  const presentColumns = getPresentImportColumns(rawRows);
  importEffectiveMode = importMode === 'auto'
    ? (presentColumns.has('product_name') ? 'full' : 'partial')
    : importMode;

  if (importEffectiveMode === 'partial') {
    if (!presentColumns.has('product_code')) {
      setFieldError($('importPickError'), 'ไฟล์นี้ต้องมีคอลัมน์ product_code');
      return;
    }
    importUpdatableFields = IMPORT_COMPARE_FIELDS.filter((f) => presentColumns.has(f.key));
    if (importUpdatableFields.length === 0) {
      setFieldError($('importPickError'), 'ไม่พบคอลัมน์ที่จะปรับปรุง — ต้องมีอย่างน้อย 1 คอลัมน์นอกเหนือจาก product_code (เช่น price, discount_step_1, order_condition)');
      return;
    }

    const parsed = rawRows.map((raw, idx) => {
      const row = normalizeImportRow(raw);
      const rowNum = idx + 2;
      let status, note, diff = null, existingProduct = null;

      if (!row.product_code) {
        status = 'error';
        note = 'ไม่มีรหัสสินค้า';
      } else if (seenInFile.has(row.product_code)) {
        status = 'error';
        note = 'รหัสสินค้าซ้ำกันภายในไฟล์เดียวกัน';
      } else if (!existingByCode.has(row.product_code)) {
        status = 'error';
        note = 'ไม่พบรหัสสินค้านี้ในระบบ — โหมดปรับปรุงเฉพาะฟิลด์ใช้ได้กับสินค้าที่มีอยู่แล้วเท่านั้น';
      } else {
        existingProduct = existingByCode.get(row.product_code);
        diff = diffImportRow(existingProduct, row, importUpdatableFields);
        status = 'duplicate';
        note = diff.changed
          ? `จะอัปเดต: ${diff.changedFields.map(f => f.label).join(', ')}`
          : 'ไม่มีอะไรเปลี่ยนแปลงในคอลัมน์ที่ระบุ (จะไม่แก้ไข)';
      }

      if (row.product_code) seenInFile.add(row.product_code);
      return { rowNum, data: row, status, note, diff, existingProduct };
    });

    importParsedRows = parsed;
    renderImportPreview();
    return;
  }

  const parsed = rawRows.map((raw, idx) => {
    const row = normalizeImportRow(raw);
    const rowNum = idx + 2; // +2 เพราะแถวที่ 1 คือ header
    let status = 'new';
    let note = '';
    let diff = null;
    let existingProduct = null;

    if (!row.product_code || !row.product_name) {
      status = 'error';
      note = 'ไม่มีรหัสสินค้า หรือ ชื่อสินค้า';
    } else if (row.price === undefined) {
      status = 'error';
      note = 'ราคาไม่ใช่ตัวเลข';
    } else if (seenInFile.has(row.product_code)) {
      status = 'error';
      note = 'รหัสสินค้าซ้ำกันภายในไฟล์เดียวกัน';
    } else if (existingByCode.has(row.product_code)) {
      status = 'duplicate';
      existingProduct = existingByCode.get(row.product_code);
      diff = diffImportRow(existingProduct, row);
      note = diff.changed
        ? `มีรหัสนี้อยู่แล้ว — เปลี่ยน: ${diff.changedFields.map(f => f.label).join(', ')}`
        : 'มีรหัสนี้อยู่แล้ว — ข้อมูลเหมือนเดิมทุกอย่าง (จะไม่แก้ไข)';
    } else if (!isDiscountStepOrderValid(row)) {
      status = 'warn';
      note = 'สเต็ปส่วนลดไม่เรียงจากมากไปน้อย (ตรวจสอบก่อนนำเข้า)';
    }

    // ถ้าเป็นรายการซ้ำ ให้ตรวจสอบสเต็ปส่วนลดด้วยเช่นกัน (จะถูกอัปเดตทับถ้าเลือกโหมด "อัปเดต")
    if (status === 'duplicate' && !isDiscountStepOrderValid(row)) {
      note += ' — และสเต็ปส่วนลดไม่เรียงจากมากไปน้อย';
    }

    if (row.product_code) seenInFile.add(row.product_code);

    return { rowNum, data: row, status, note, diff, existingProduct };
  });

  importParsedRows = parsed;
  renderImportPreview();
}

function renderImportPreview() {
  $('importStepPick').hidden = true;
  $('importStepPreview').hidden = false;

  const total = importParsedRows.length;
  const errorCount = importParsedRows.filter(r => r.status === 'error').length;
  const dupChangedCount = importParsedRows.filter(r => r.status === 'duplicate' && r.diff?.changed).length;
  const dupUnchangedCount = importParsedRows.filter(r => r.status === 'duplicate' && !r.diff?.changed).length;
  const warnCount = importParsedRows.filter(r => r.status === 'warn').length;
  const okCount = total - errorCount;
  const duplicateMode = importEffectiveMode === 'partial' ? 'update' : $('importDuplicateMode').value; // 'skip' | 'update'

  if ($('duplicateModeField')) $('duplicateModeField').hidden = importEffectiveMode === 'partial';

  const autoNote = importMode === 'auto'
    ? (importEffectiveMode === 'partial' ? ' [ตรวจพบอัตโนมัติ: ไม่มีคอลัมน์ product_name → ปรับปรุงเฉพาะฟิลด์ที่มีในไฟล์]' : ' [ตรวจพบอัตโนมัติ: มีคอลัมน์ product_name → นำเข้าแบบเต็ม]')
    : '';

  const dupText = duplicateMode === 'update'
    ? `ซ้ำกับของเดิม ${dupChangedCount + dupUnchangedCount} แถว (มีการเปลี่ยนแปลงจริง ${dupChangedCount} แถวจะถูกอัปเดต, เหมือนเดิมทุกอย่าง ${dupUnchangedCount} แถวจะไม่แตะ)`
    : `ซ้ำกับของเดิม ${dupChangedCount + dupUnchangedCount} แถว (จะถูกข้ามทั้งหมด)`;

  $('importSummaryText').textContent = (importEffectiveMode === 'partial'
    ? `พบทั้งหมด ${total} แถว — จะปรับปรุงจริง ${dupChangedCount} แถว, ไม่มีอะไรเปลี่ยน ${dupUnchangedCount} แถว, มีปัญหา ${errorCount} แถว (จะถูกข้าม)`
    : `พบทั้งหมด ${total} แถว — ${dupText}, สเต็ปส่วนลดผิดปกติ ${warnCount} แถว, มีปัญหา ${errorCount} แถว (จะถูกข้าม)`) + autoNote;

  const statusLabel = { new: 'ใหม่', duplicate: 'ซ้ำ - จะอัปเดต', error: 'ผิดพลาด', warn: 'คำเตือน' };
  const statusClass = { new: 'success', duplicate: 'warn', error: 'error', warn: 'warn' };

  const tbody = $('importPreviewBody');
  tbody.innerHTML = '';
  importParsedRows.forEach(r => {
    const tr = document.createElement('tr');
    let label = statusLabel[r.status];
    if (r.status === 'duplicate') {
      if (importEffectiveMode === 'partial') {
        label = r.diff?.changed ? 'จะอัปเดต' : 'ไม่มีอะไรเปลี่ยน';
      } else {
        label = duplicateMode === 'update'
          ? (r.diff?.changed ? 'ซ้ำ - จะอัปเดต' : 'ซ้ำ - เหมือนเดิม')
          : 'ซ้ำ - จะข้าม';
      }
    }
    tr.innerHTML = `
      <td><span class="import-status import-status-${statusClass[r.status]}">${label}</span></td>
      <td class="product-code">${escapeHtml(r.data.product_code || '(ว่าง)')}</td>
      <td class="product-name">${escapeHtml(r.data.product_name || '(ว่าง)')}</td>
      <td class="num">${r.data.price != null && r.data.price !== undefined ? formatMoney(r.data.price) : '—'}</td>
      <td>${escapeHtml(r.note || '')}</td>
    `;
    tbody.appendChild(tr);
  });

  $('confirmImportBtn').hidden = okCount === 0;
}

async function onConfirmImport() {
  const btn = $('confirmImportBtn');
  const duplicateMode = importEffectiveMode === 'partial' ? 'update' : $('importDuplicateMode').value; // 'skip' | 'update'
  setFieldError($('importResultError'), '');

  // โหมด partial ไม่มีการเพิ่มรายการใหม่เลย (แถวที่ไม่พบรหัสในระบบถูกตีเป็น error ไปแล้วตอน parse)
  const toInsert = importEffectiveMode === 'partial' ? [] : importParsedRows
    .filter(r => r.status === 'new' || r.status === 'warn')
    .map(r => ({ row: r, payload: { ...r.data, created_by: currentUser.id, updated_by: currentUser.id } }));

  // อัปเดตเฉพาะแถวที่เทียบแล้วมีอะไรเปลี่ยนจริง — ถ้าข้อมูลเหมือนเดิมทุกอย่าง ไม่ต้องยิง update ทิ้งไว้เฉยๆ
  const toUpdate = duplicateMode === 'update'
    ? importParsedRows
        .filter(r => r.status === 'duplicate' && r.diff?.changed)
        .map(r => {
          let payload;
          if (importEffectiveMode === 'partial') {
            // ส่งเฉพาะฟิลด์ที่มีในไฟล์ + เปลี่ยนแปลงจริง — ไม่แตะฟิลด์อื่นที่ไม่ได้ระบุมาในไฟล์เด็ดขาด
            payload = { product_code: r.data.product_code, updated_by: currentUser.id };
            r.diff.changedFields.forEach((f) => { payload[f.key] = r.data[f.key]; });
          } else {
            payload = { ...r.data, updated_by: currentUser.id };
          }
          // stamp วันที่แก้ไขราคาใหม่ เฉพาะตอนที่ราคา/สเต็ปส่วนลดเปลี่ยนจริง (ตรงตาม convention เดียวกับฟอร์มแก้ไขสินค้าปกติ)
          if (r.diff.priceChanged) payload.price_updated_at = todayIso();
          return { row: r, payload };
        })
    : [];
  const skippedUnchangedCount = duplicateMode === 'update'
    ? importParsedRows.filter(r => r.status === 'duplicate' && !r.diff?.changed).length
    : 0;

  if (toInsert.length === 0 && toUpdate.length === 0) {
    setFieldError($('importResultError'), 'ไม่มีแถวที่จะนำเข้า');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    let insertedCount = 0;
    let updatedCount = 0;
    const failedRows = []; // { rowNum, product_code, message }

    // insert ทีละแถว (ไม่ใช่ chunk 500) — กันแถวเดียวพังแล้วล้มทั้งชุด และรู้ได้แน่ชัดว่าแถวไหนพังจริง
    for (const { row, payload } of toInsert) {
      const { error } = await sb.from('products').insert(payload);
      if (error) {
        failedRows.push({ rowNum: row.rowNum, product_code: row.data.product_code, message: error.message });
        continue;
      }
      insertedCount++;
    }

    for (const { row, payload } of toUpdate) {
      const { data, error } = await sb
        .from('products')
        .update(payload)
        .eq('product_code', payload.product_code)
        .select()
        .single();
      if (error) {
        failedRows.push({ rowNum: row.rowNum, product_code: row.data.product_code, message: error.message });
        continue;
      }
      updatedCount++;
      await writeAuditLog('edit', data, row.existingProduct, data);
    }

    const skippedNote = skippedUnchangedCount ? ` (ข้ามแบบไม่แก้ไข ${skippedUnchangedCount} รายการ เพราะข้อมูลเหมือนเดิมทุกอย่าง)` : '';

    if (failedRows.length === 0) {
      showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${insertedCount} รายการ${updatedCount ? `, อัปเดต ${updatedCount} รายการ` : ''}${skippedNote}`, 'success');
      closeImportModal();
    } else {
      const detail = failedRows
        .slice(0, 5)
        .map(f => `แถว ${f.rowNum} (${f.product_code || '—'}): ${f.message}`)
        .join(' | ');
      const more = failedRows.length > 5 ? ` และอีก ${failedRows.length - 5} แถว` : '';
      setFieldError($('importResultError'),
        `นำเข้าสำเร็จบางส่วน: เพิ่มใหม่ ${insertedCount} รายการ${updatedCount ? `, อัปเดต ${updatedCount} รายการ` : ''}${skippedNote} — ล้มเหลว ${failedRows.length} แถว: ${detail}${more}`);
    }

    await loadProducts();
  } catch (err) {
    setFieldError($('importResultError'), 'นำเข้าไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'));
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Profile Edit (display name + avatar)
// ==================================================
const AVATAR_MAX_BYTES = 8 * 1024 * 1024; // 8MB
let pendingAvatarFile = null; // ไฟล์รูปที่เลือกไว้ แต่ยังไม่อัปโหลดจนกว่าจะกด "บันทึก"

function bindProfileEvents() {
  $('profileAvatarBtn').addEventListener('click', openProfileModal);
  $('closeProfileModal').addEventListener('click', closeProfileModal);
  $('cancelProfileForm').addEventListener('click', closeProfileModal);
  $('profileModal').addEventListener('click', (e) => { if (e.target === $('profileModal')) closeProfileModal(); });

  $('profileAvatarInput').addEventListener('change', onProfileAvatarSelected);
  $('profileForm').addEventListener('submit', onSaveProfile);
}

function openProfileModal() {
  pendingAvatarFile = null;
  setFieldError($('profileFormError'), '');
  $('fDisplayName').value = currentProfile.display_name || '';

  renderProfilePreview(currentProfile.avatar_url, currentProfile.display_name || currentProfile.username);

  $('profileModal').hidden = false;
  $('profileModal').classList.add('is-visible');
}

function closeProfileModal() {
  $('profileModal').classList.remove('is-visible');
  $('profileModal').hidden = true;
  pendingAvatarFile = null;
  $('profileAvatarInput').value = '';
}

function renderProfilePreview(avatarUrl, nameForFallback) {
  const img = $('profileAvatarPreviewImg');
  const fallback = $('profileAvatarPreviewFallback');
  if (avatarUrl) {
    img.src = avatarUrl;
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
    fallback.textContent = (nameForFallback || 'M').charAt(0).toUpperCase();
  }
}

function onProfileAvatarSelected(e) {
  const file = e.target.files[0];
  const errorEl = $('profileFormError');
  setFieldError(errorEl, '');
  if (!file) return;

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    setFieldError(errorEl, 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP เท่านั้น');
    $('profileAvatarInput').value = '';
    return;
  }
  if (file.size > AVATAR_MAX_BYTES) {
    setFieldError(errorEl, 'ไฟล์ใหญ่เกินไป (สูงสุด 8MB)');
    $('profileAvatarInput').value = '';
    return;
  }

  pendingAvatarFile = file;
  // แสดงตัวอย่างรูปทันทีจากไฟล์ในเครื่อง (ยังไม่อัปโหลดจนกว่าจะกดบันทึก)
  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = $('profileAvatarPreviewImg');
    img.src = evt.target.result;
    img.hidden = false;
    $('profileAvatarPreviewFallback').hidden = true;
  };
  reader.readAsDataURL(file);
}

async function onSaveProfile(e) {
  e.preventDefault();
  const errorEl = $('profileFormError');
  const btn = $('saveProfileBtn');
  setFieldError(errorEl, '');

  const displayName = $('fDisplayName').value.trim();

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    let avatarUrl = currentProfile.avatar_url || null;

    if (pendingAvatarFile) {
      // เก็บไฟล์ใต้โฟลเดอร์ {user_id}/ ตามที่ storage policy กำหนดไว้
      const ext = pendingAvatarFile.name.split('.').pop().toLowerCase();
      const path = `${currentUser.id}/avatar.${ext}`;

      const { error: uploadError } = await sb.storage
        .from('avatars')
        .upload(path, pendingAvatarFile, { upsert: true, cacheControl: '3600' });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = sb.storage.from('avatars').getPublicUrl(path);
      // ต่อ query string กันแคชรูปเก่าค้างในเบราว์เซอร์
      avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
    }

    const payload = {
      display_name: displayName || null,
      avatar_url: avatarUrl,
    };

    const { data, error } = await sb
      .from('profiles')
      .update(payload)
      .eq('id', currentUser.id)
      .select('id, username, role, email, display_name, avatar_url')
      .single();
    if (error) throw error;

    currentProfile = data;
    applyRolePermissions();
    showToast('บันทึกโปรไฟล์สำเร็จ', 'success');
    closeProfileModal();
  } catch (err) {
    setFieldError(errorEl, err.message || 'บันทึกโปรไฟล์ไม่สำเร็จ');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Price Requests (งานขอราคา)
// ==================================================
const PR_SOURCE_LABEL = {
  personal_chat: 'แชทส่วนตัว',
  group_chat: 'กลุ่ม',
  cs_group: 'กลุ่ม CS',
};
const PR_SOURCE_ICON = {
  personal_chat: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  group_chat: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  cs_group: '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
};
const PR_STATUS_LABEL = { pending: 'รอดำเนินการ', in_progress: 'กำลังทำ', done: 'เสร็จแล้ว' };
const PR_STATUS_CYCLE = { pending: 'in_progress', in_progress: 'done', done: 'pending' };

// ==================================================
// Calendar popover (ปฏิทินเลือกวันที่แบบ grid)
// ==================================================
const CAL_DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const CAL_MONTH_NAMES_TH = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---- Generic calendar instance factory ----
// รองรับหลาย date picker พร้อมกันในหน้าเดียว (เช่น ฟอร์มขอราคา + ฟอร์มสินค้า)
// ids: { hiddenInput, label, trigger, popover, monthLabel, grid, prevBtn, nextBtn, todayBtn }
function createCalendarInstance(ids, onDateChange) {
  const state = { year: null, month: null };

  function setDate(isoDate) {
    $(ids.hiddenInput).value = isoDate;
    $(ids.label).textContent = formatPrDate(isoDate);
    const [y, m] = isoDate.split('-').map(Number);
    state.year = y;
    state.month = m - 1;
    render();
    if (onDateChange) onDateChange(isoDate);
  }

  function open() {
    const current = $(ids.hiddenInput).value || todayIso();
    const [y, m] = current.split('-').map(Number);
    state.year = y;
    state.month = m - 1;
    render();
    $(ids.popover).hidden = false;
    $(ids.trigger).classList.add('is-open');
    $(ids.trigger).setAttribute('aria-expanded', 'true');
  }

  function close() {
    $(ids.popover).hidden = true;
    $(ids.trigger).classList.remove('is-open');
    $(ids.trigger).setAttribute('aria-expanded', 'false');
  }

  function toggle() {
    if ($(ids.popover).hidden) open(); else close();
  }

  function shiftMonth(delta) {
    state.month += delta;
    if (state.month < 0) { state.month = 11; state.year--; }
    if (state.month > 11) { state.month = 0; state.year++; }
    render();
  }

  function buildDay(dayNum, monthIndex, isOutside, selectedIso, todayIsoStr) {
    const realDate = new Date(state.year, monthIndex, dayNum);
    const iso = `${realDate.getFullYear()}-${String(realDate.getMonth() + 1).padStart(2, '0')}-${String(realDate.getDate()).padStart(2, '0')}`;

    const li = document.createElement('li');
    li.className = 'date' + (isOutside ? ' is-outside' : '');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-day-btn';
    if (iso === todayIsoStr) btn.classList.add('is-today');
    if (iso === selectedIso) btn.classList.add('is-selected');
    btn.textContent = String(dayNum);
    btn.addEventListener('click', () => {
      setDate(iso);
      close();
    });

    li.appendChild(btn);
    return li;
  }

  function render() {
    $(ids.monthLabel).textContent = `${CAL_MONTH_NAMES_TH[state.month]} ${state.year + 543}`;

    const calEl = $(ids.grid);
    calEl.innerHTML = '';

    const headerFrag = document.createDocumentFragment();
    CAL_DAY_HEADERS.forEach(d => {
      const li = document.createElement('li');
      li.className = 'day';
      li.textContent = d;
      headerFrag.appendChild(li);
    });
    calEl.appendChild(headerFrag);

    const firstOfMonth = new Date(state.year, state.month, 1);
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(state.year, state.month + 1, 0).getDate();
    const daysInPrevMonth = new Date(state.year, state.month, 0).getDate();

    const selectedIso = $(ids.hiddenInput).value;
    const todayIsoStr = todayIso();
    const bodyFrag = document.createDocumentFragment();

    for (let i = leadingBlanks - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      bodyFrag.appendChild(buildDay(dayNum, state.month - 1, true, selectedIso, todayIsoStr));
    }
    for (let d = 1; d <= daysInMonth; d++) {
      bodyFrag.appendChild(buildDay(d, state.month, false, selectedIso, todayIsoStr));
    }
    const totalCells = leadingBlanks + daysInMonth;
    const trailingBlanks = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= trailingBlanks; d++) {
      bodyFrag.appendChild(buildDay(d, state.month + 1, true, selectedIso, todayIsoStr));
    }

    calEl.appendChild(bodyFrag);
  }

  function bind() {
    $(ids.trigger).addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });
    $(ids.prevBtn).addEventListener('click', () => shiftMonth(-1));
    $(ids.nextBtn).addEventListener('click', () => shiftMonth(1));
    $(ids.todayBtn).addEventListener('click', () => {
      setDate(todayIso());
      close();
    });
    document.addEventListener('click', (e) => {
      const popover = $(ids.popover);
      if (!popover.hidden && !popover.contains(e.target) && e.target !== $(ids.trigger) && !$(ids.trigger).contains(e.target)) {
        close();
      }
    });
  }

  return { setDate, open, close, toggle, bind };
}

let prCalendar = null; // instance สำหรับฟอร์มงานขอราคา
let productCalendar = null; // instance สำหรับฟอร์มสินค้า (วันที่อัปเดตราคา/ส่วนลด)
function setPrDate(isoDate) { prCalendar.setDate(isoDate); }
function closeCalendarPopover() { prCalendar.close(); }

function bindPriceRequestEvents() {
  $('addPriceRequestBtn').addEventListener('click', () => openPrModal(null));

  prCalendar = createCalendarInstance({
    hiddenInput: 'fPrDate',
    label: 'fPrDateLabel',
    trigger: 'fPrDateTrigger',
    popover: 'prCalendarPopover',
    monthLabel: 'calMonthLabel',
    grid: 'calendar',
    prevBtn: 'calPrevMonth',
    nextBtn: 'calNextMonth',
    todayBtn: 'calTodayBtn',
  });
  prCalendar.bind();

  document.querySelectorAll('.pr-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      currentPrFilter = chip.dataset.status;
      document.querySelectorAll('.pr-filter-chip').forEach(c => {
        c.classList.toggle('is-active', c === chip);
        c.setAttribute('aria-selected', String(c === chip));
      });
      renderPriceRequests();
    });
  });

  $('prSearchInput').addEventListener('input', debounce(() => {
    currentPrSearch = $('prSearchInput').value.trim().toLowerCase();
    renderPriceRequests();
  }, 150));

  document.querySelectorAll('.pr-source-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedPrSource = opt.dataset.source;
      $('fPrSource').value = selectedPrSource;
      document.querySelectorAll('.pr-source-opt').forEach(o => {
        o.classList.toggle('is-selected', o === opt);
        o.setAttribute('aria-checked', String(o === opt));
      });
    });
  });

  $('closePrModal').addEventListener('click', closePrModal);
  $('cancelPrForm').addEventListener('click', closePrModal);
  $('priceRequestForm').addEventListener('submit', onSavePriceRequest);
  $('priceRequestModal').addEventListener('click', (e) => { if (e.target === $('priceRequestModal')) closePrModal(); });

  $('closeDeletePrModal').addEventListener('click', closeDeletePrModal);
  $('cancelDeletePr').addEventListener('click', closeDeletePrModal);
  $('confirmDeletePr').addEventListener('click', onConfirmDeletePr);
  $('deletePrModal').addEventListener('click', (e) => { if (e.target === $('deletePrModal')) closeDeletePrModal(); });

  $('priceRequestList').addEventListener('click', onPrListClick);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCalendarPopover();
      closePrModal();
      closeDeletePrModal();
    }
  });
}

async function loadPriceRequests() {
  $('prLoadingState').style.display = 'flex';
  $('prEmptyState').hidden = true;

  const { data, error } = await sb
    .from('price_requests')
    .select('*')
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false });

  $('prLoadingState').style.display = 'none';
  priceRequestsLoaded = true;

  if (error) {
    showToast('โหลดข้อมูลงานขอราคาไม่สำเร็จ: ' + error.message, 'error');
    allPriceRequests = [];
  } else {
    allPriceRequests = data || [];
  }
  renderPriceRequests();
}

function updatePrTabBadge() {
  const pending = allPriceRequests.filter(r => r.status !== 'done').length;
  const badge = $('prTabBadge');
  if (pending > 0) {
    badge.textContent = pending > 99 ? '99+' : String(pending);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderPriceRequests() {
  let filtered = currentPrFilter === 'all'
    ? allPriceRequests
    : allPriceRequests.filter(r => r.status === currentPrFilter);

  if (currentPrSearch) {
    filtered = filtered.filter(r =>
      (r.details || '').toLowerCase().includes(currentPrSearch) ||
      (r.requested_by || '').toLowerCase().includes(currentPrSearch)
    );
  }

  const list = $('priceRequestList');
  list.innerHTML = '';

  updatePrTabBadge();

  if (filtered.length === 0) {
    $('prEmptyState').hidden = false;
    if (currentPrSearch) {
      $('prEmptyStateText').textContent = `ไม่พบงานที่ตรงกับ "${$('prSearchInput').value.trim()}"`;
    } else {
      $('prEmptyStateText').textContent = currentPrFilter === 'all'
        ? 'ยังไม่มีงานขอราคา — เริ่มเพิ่มงานแรก'
        : `ไม่มีงานสถานะ "${PR_STATUS_LABEL[currentPrFilter]}"`;
    }
    return;
  }
  $('prEmptyState').hidden = true;

  const canDel = canDelete();
  const frag = document.createDocumentFragment();

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'pr-card';
    card.dataset.status = r.status;
    card.dataset.id = r.id;

    card.innerHTML = `
      <div class="pr-card-titlebar">
        <span class="term-dot term-dot-red"></span>
        <span class="term-dot term-dot-yellow"></span>
        <span class="term-dot term-dot-green"></span>
        <span class="pr-card-titlebar-text">${escapeHtml(r.requested_by)}.request</span>
      </div>
      <div class="pr-card-body">
      <div class="pr-card-main">
        <div class="pr-card-top">
          <span class="pr-card-date">${formatPrDate(r.request_date)}</span>
          <span class="pr-source-tag">${PR_SOURCE_ICON[r.source] || ''}${escapeHtml(PR_SOURCE_LABEL[r.source] || r.source)}</span>
          <span class="pr-card-by">${escapeHtml(r.requested_by)}</span>
        </div>
        <div class="pr-card-details">${escapeHtml(r.details)}</div>
        ${r.vendor ? `<div class="pr-card-vendor"><span class="pr-card-vendor-label">Vendor</span> ${escapeHtml(r.vendor)}</div>` : ''}
        ${r.notes ? `<div class="pr-card-notes">${escapeHtml(r.notes)}</div>` : ''}
      </div>
      <div class="pr-card-side">
        <button type="button" class="pr-status-btn" data-status="${r.status}" data-action="cycle-status" data-id="${r.id}" title="กดเพื่อเปลี่ยนสถานะ">
          ${escapeHtml(PR_STATUS_LABEL[r.status] || r.status)}
        </button>
        <div class="pr-card-actions">
          <button type="button" class="btn btn-ghost btn-icon" data-action="edit" data-id="${r.id}" title="แก้ไข" aria-label="แก้ไขงานขอราคา">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          ${canDel ? `
          <button type="button" class="btn btn-ghost btn-icon danger" data-action="delete" data-id="${r.id}" title="ลบ" aria-label="ลบงานขอราคา">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>` : ''}
        </div>
      </div>
      </div>
    `;
    frag.appendChild(card);
  });

  list.appendChild(frag);
}

function formatPrDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function onPrListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;

  if (action === 'edit') {
    openPrModal(id);
  } else if (action === 'delete') {
    openDeletePrModal(id);
  } else if (action === 'cycle-status') {
    cyclePrStatus(id);
  }
}

async function cyclePrStatus(id) {
  const req = allPriceRequests.find(r => r.id === id);
  if (!req) return;
  const nextStatus = PR_STATUS_CYCLE[req.status] || 'pending';

  // อัปเดต UI ทันทีเพื่อความลื่นไหล แล้วค่อยยืนยันกับเซิร์ฟเวอร์ (revert ถ้าพลาด)
  const prevStatus = req.status;
  req.status = nextStatus;
  renderPriceRequests();

  const { error } = await sb
    .from('price_requests')
    .update({ status: nextStatus, updated_by: currentUser.id })
    .eq('id', id);

  if (error) {
    req.status = prevStatus;
    renderPriceRequests();
    showToast('เปลี่ยนสถานะไม่สำเร็จ: ' + error.message, 'error');
  }
}

function openPrModal(prId) {
  editingPrId = prId;
  setFieldError($('priceRequestFormError'), '');
  selectedPrSource = null;

  document.querySelectorAll('.pr-source-opt').forEach(o => {
    o.classList.remove('is-selected');
    o.setAttribute('aria-checked', 'false');
  });

  if (prId) {
    const r = allPriceRequests.find(x => x.id === prId);
    if (!r) return;
    $('prModalTitle').textContent = 'แก้ไขงานขอราคา';
    $('prId').value = r.id;
    setPrDate(r.request_date || todayIso());
    $('fPrRequestedBy').value = r.requested_by || '';
    $('fPrDetails').value = r.details || '';
    $('fPrVendor').value = r.vendor || '';
    $('fPrNotes').value = r.notes || '';
    $('fPrSource').value = r.source || '';
    selectedPrSource = r.source || null;
    const opt = document.querySelector(`.pr-source-opt[data-source="${r.source}"]`);
    if (opt) {
      opt.classList.add('is-selected');
      opt.setAttribute('aria-checked', 'true');
    }
  } else {
    $('prModalTitle').textContent = 'เพิ่มงานขอราคา';
    $('priceRequestForm').reset();
    $('prId').value = '';
    $('fPrSource').value = '';
    setPrDate(todayIso());
  }

  closeCalendarPopover();
  $('priceRequestModal').hidden = false;
  $('priceRequestModal').classList.add('is-visible');
  $('fPrRequestedBy').focus();
}

function closePrModal() {
  $('priceRequestModal').classList.remove('is-visible');
  $('priceRequestModal').hidden = true;
  editingPrId = null;
  closeCalendarPopover();
}

function readPriceRequestForm() {
  return {
    request_date: $('fPrDate').value,
    requested_by: $('fPrRequestedBy').value.trim(),
    source: $('fPrSource').value,
    details: $('fPrDetails').value.trim(),
    vendor: $('fPrVendor').value.trim() || null,
    notes: $('fPrNotes').value.trim() || null,
  };
}

async function onSavePriceRequest(e) {
  e.preventDefault();
  const errorEl = $('priceRequestFormError');
  const btn = $('savePrBtn');
  setFieldError(errorEl, '');

  const formData = readPriceRequestForm();
  if (!formData.request_date || !formData.requested_by || !formData.source || !formData.details) {
    setFieldError(errorEl, 'กรุณากรอกวันที่ ผู้ขอ แหล่งที่มา และรายละเอียดให้ครบ');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    if (editingPrId) {
      const { data, error } = await sb
        .from('price_requests')
        .update({ ...formData, updated_by: currentUser.id })
        .eq('id', editingPrId)
        .select('*')
        .single();
      if (error) throw error;
      const idx = allPriceRequests.findIndex(r => r.id === editingPrId);
      if (idx !== -1) allPriceRequests[idx] = data;
      showToast('บันทึกการแก้ไขสำเร็จ', 'success');
    } else {
      const { data, error } = await sb
        .from('price_requests')
        .insert({ ...formData, status: 'pending', created_by: currentUser.id, updated_by: currentUser.id })
        .select('*')
        .single();
      if (error) throw error;
      allPriceRequests.unshift(data);
      showToast('เพิ่มงานขอราคาสำเร็จ', 'success');
    }
    renderPriceRequests();
    closePrModal();
  } catch (err) {
    setFieldError(errorEl, err.message || 'บันทึกไม่สำเร็จ');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

function openDeletePrModal(id) {
  const r = allPriceRequests.find(x => x.id === id);
  if (!r) return;
  pendingDeletePr = r;
  $('deletePrModalText').textContent = `ต้องการลบงานขอราคา "${r.details.slice(0, 60)}${r.details.length > 60 ? '…' : ''}" ใช่หรือไม่? การลบไม่สามารถย้อนกลับได้`;
  $('deletePrModal').hidden = false;
  $('deletePrModal').classList.add('is-visible');
}

function closeDeletePrModal() {
  $('deletePrModal').classList.remove('is-visible');
  $('deletePrModal').hidden = true;
  pendingDeletePr = null;
}

async function onConfirmDeletePr() {
  if (!pendingDeletePr) return;
  const btn = $('confirmDeletePr');
  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const { error } = await sb
      .from('price_requests')
      .delete()
      .eq('id', pendingDeletePr.id);
    if (error) throw error;

    allPriceRequests = allPriceRequests.filter(r => r.id !== pendingDeletePr.id);
    renderPriceRequests();
    showToast('ลบงานขอราคาสำเร็จ', 'success');
    closeDeletePrModal();
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + (err.message || ''), 'error');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Vendor Mapping (สำหรับเครื่องมือ Rename_PO)
// ==================================================
function bindVendorEvents() {
  $('addVendorBtn').addEventListener('click', () => openVendorModal(null));
  $('closeVendorModal').addEventListener('click', closeVendorModal);
  $('cancelVendorForm').addEventListener('click', closeVendorModal);
  $('vendorForm').addEventListener('submit', onSaveVendor);
  $('vendorModal').addEventListener('click', (e) => { if (e.target === $('vendorModal')) closeVendorModal(); });

  $('closeDeleteVendorModal').addEventListener('click', closeDeleteVendorModal);
  $('cancelDeleteVendor').addEventListener('click', closeDeleteVendorModal);
  $('confirmDeleteVendor').addEventListener('click', onConfirmDeleteVendor);
  $('deleteVendorModal').addEventListener('click', (e) => { if (e.target === $('deleteVendorModal')) closeDeleteVendorModal(); });

  $('vendorSearchInput').addEventListener('input', debounce(renderVendorMappings, 150));
}

async function loadVendorMappings() {
  $('vendorLoadingState').hidden = false;
  $('vendorEmptyState').hidden = true;

  const { data, error } = await sb
    .from('vendor_mappings')
    .select('*')
    .order('vendor_name', { ascending: true });

  $('vendorLoadingState').hidden = true;
  vendorMappingsLoaded = true;

  if (error) {
    showToast('โหลดข้อมูล Vendor ไม่สำเร็จ: ' + (error.message || ''), 'error');
    return;
  }

  allVendorMappings = data || [];
  renderVendorMappings();
}

function renderVendorMappings() {
  const tbody = $('vendorTableBody');
  const query = ($('vendorSearchInput').value || '').trim().toLowerCase();

  let list = allVendorMappings;
  if (query) {
    list = list.filter(v =>
      (v.vendor_code || '').toLowerCase().includes(query) ||
      (v.vendor_name || '').toLowerCase().includes(query)
    );
  }

  if (list.length === 0) {
    tbody.innerHTML = '';
    $('vendorEmptyState').hidden = false;
    $('vendorEmptyStateText').textContent = query
      ? 'ไม่พบ Vendor ที่ตรงกับการค้นหา'
      : 'ยังไม่มีข้อมูล Vendor Mapping';
    return;
  }

  $('vendorEmptyState').hidden = true;
  tbody.innerHTML = list.map(v => `
    <tr>
      <td>${escapeHtml(v.vendor_code)}</td>
      <td>${escapeHtml(v.vendor_name)}</td>
      <td class="num">
        <div class="vendor-table-actions">
          <button class="icon-btn" title="แก้ไข" onclick="openVendorModal('${v.id}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn icon-btn-danger" title="ลบ" onclick="openDeleteVendorModal('${v.id}')">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

function openVendorModal(vendorId) {
  editingVendorId = vendorId;
  setFieldError($('vendorFormError'), '');

  if (vendorId) {
    const v = allVendorMappings.find(x => x.id === vendorId);
    if (!v) return;
    $('vendorModalTitle').textContent = 'แก้ไข Vendor';
    $('vendorId').value = v.id;
    $('fVendorCode').value = v.vendor_code || '';
    $('fVendorName').value = v.vendor_name || '';
  } else {
    $('vendorModalTitle').textContent = 'เพิ่ม Vendor ใหม่';
    $('vendorForm').reset();
    $('vendorId').value = '';
  }

  $('vendorModal').hidden = false;
  $('vendorModal').classList.add('is-visible');
  $('fVendorCode').focus();
}

function closeVendorModal() {
  $('vendorModal').classList.remove('is-visible');
  $('vendorModal').hidden = true;
  editingVendorId = null;
}

async function onSaveVendor(e) {
  e.preventDefault();
  const errorEl = $('vendorFormError');
  const btn = $('saveVendorBtn');
  setFieldError(errorEl, '');

  const vendor_code = $('fVendorCode').value.trim().toUpperCase();
  const vendor_name = $('fVendorName').value.trim();

  if (!vendor_code || !vendor_name) {
    setFieldError(errorEl, 'กรุณากรอกรหัสและชื่อ Vendor');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const id = $('vendorId').value;

    if (id) {
      const { error } = await sb
        .from('vendor_mappings')
        .update({ vendor_code, vendor_name, updated_by: currentUser.id })
        .eq('id', id);
      if (error) throw error;
      showToast('บันทึกการแก้ไขสำเร็จ', 'success');
    } else {
      const { error } = await sb
        .from('vendor_mappings')
        .insert({ vendor_code, vendor_name, created_by: currentUser.id, updated_by: currentUser.id });
      if (error) throw error;
      showToast('เพิ่ม Vendor สำเร็จ', 'success');
    }

    closeVendorModal();
    await loadVendorMappings();
  } catch (err) {
    setFieldError(errorEl, err.message?.includes('duplicate') || err.code === '23505'
      ? 'รหัส Vendor นี้มีอยู่แล้วในระบบ'
      : (err.message || 'บันทึกไม่สำเร็จ'));
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

function openDeleteVendorModal(vendorId) {
  const v = allVendorMappings.find(x => x.id === vendorId);
  if (!v) return;
  pendingDeleteVendor = v;
  $('deleteVendorModalText').innerHTML = `ต้องการลบ Vendor <strong>${escapeHtml(v.vendor_name)}</strong> (รหัส: ${escapeHtml(v.vendor_code)}) ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้`;
  $('deleteVendorModal').hidden = false;
  $('deleteVendorModal').classList.add('is-visible');
}

function closeDeleteVendorModal() {
  $('deleteVendorModal').classList.remove('is-visible');
  $('deleteVendorModal').hidden = true;
  pendingDeleteVendor = null;
}

async function onConfirmDeleteVendor() {
  if (!pendingDeleteVendor) return;
  const btn = $('confirmDeleteVendor');
  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const v = pendingDeleteVendor;
    const { error } = await sb.from('vendor_mappings').delete().eq('id', v.id);
    if (error) throw error;

    showToast('ลบ Vendor สำเร็จ', 'success');
    closeDeleteVendorModal();
    await loadVendorMappings();
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'), 'error');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Rename_PO Tool
// ==================================================
let pdfJsWorkerConfigured = false;

function bindRenamePoEvents() {
  const dropzone = $('renameDropzone');
  const fileInput = $('renamePdfInput');

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    setRenameSelectedFiles(Array.from(fileInput.files || []));
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer.files || []).filter(f => f.type === 'application/pdf');
    if (files.length) setRenameSelectedFiles(files);
  });

  $('renameProcessBtn').addEventListener('click', processRenamePoFiles);
}

function setRenameSelectedFiles(files) {
  renameSelectedFiles = files;
  const countEl = $('renameFileCount');
  const btn = $('renameProcessBtn');

  if (files.length === 0) {
    countEl.hidden = true;
    btn.disabled = true;
    return;
  }

  countEl.hidden = false;
  countEl.textContent = `เลือกแล้ว ${files.length} ไฟล์`;
  btn.disabled = false;
}

function ensurePdfJsWorker() {
  if (pdfJsWorkerConfigured) return;
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('ไม่พบไลบรารี pdf.js — กรุณาโหลดหน้าใหม่');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  pdfJsWorkerConfigured = true;
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await page.getTextContent();
    fullText += text.items.map(item => item.str).join(' ');
  }
  return fullText;
}

function extractPoNumber(cleanText) {
  const poMatch = cleanText.match(/เลขที่ใบสั่งซื้อ\s*[:|.-]?\s*([A-Z0-9]{6,})/i);
  if (poMatch) return poMatch[1].trim();

  const fallbackMatch = cleanText.match(/\b(26\d{6}|\d{8})\b/);
  if (fallbackMatch) return fallbackMatch[1];

  return null;
}

function extractVendorCode(cleanText) {
  const vendorMatch = cleanText.match(/V\d{5,}/i);
  return vendorMatch ? vendorMatch[0].toUpperCase() : null;
}

function findVendorName(vendorCode) {
  if (!vendorCode) return null;
  const match = allVendorMappings.find(v => (v.vendor_code || '').toUpperCase() === vendorCode);
  return match ? match.vendor_name : null;
}

function sanitizeFileNamePart(str) {
  // กันอักขระที่ใช้เป็นชื่อไฟล์ไม่ได้ (แต่คงภาษาไทย/อังกฤษ/ตัวเลขไว้)
  return String(str).replace(/[\\/:*?"<>|]/g, '').trim();
}

function downloadPdfBlob(arrayBuffer, fileName) {
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function renderRenameStatus(index, state, fileName, detail) {
  const list = $('renameStatusList');
  let item = document.getElementById('renameStatus-' + index);

  const icon = state === 'success'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
    : state === 'error'
    ? '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';

  const html = `
    <span class="rename-status-icon">${icon}</span>
    <span class="rename-status-name">${escapeHtml(fileName)}</span>
    ${detail ? `<span class="rename-status-detail">${escapeHtml(detail)}</span>` : ''}
  `;

  if (item) {
    item.className = 'rename-status-item is-' + state;
    item.innerHTML = html;
  } else {
    item = document.createElement('div');
    item.id = 'renameStatus-' + index;
    item.className = 'rename-status-item is-' + state;
    item.innerHTML = html;
    list.appendChild(item);
  }
}

async function processRenamePoFiles() {
  if (renameSelectedFiles.length === 0) return;

  const btn = $('renameProcessBtn');
  const fileInput = $('renamePdfInput');
  $('renameStatusList').innerHTML = '';
  btn.disabled = true;
  btn.classList.add('is-loading');

  try {
    ensurePdfJsWorker();
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false;
    btn.classList.remove('is-loading');
    return;
  }

  // ให้แน่ใจว่าตาราง vendor mapping โหลดล่าสุดก่อนเริ่มจับคู่
  if (!vendorMappingsLoaded) {
    await loadVendorMappings();
  }

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < renameSelectedFiles.length; i++) {
    const file = renameSelectedFiles[i];
    renderRenameStatus(i, 'pending', file.name, 'กำลังอ่านไฟล์…');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const extractedText = await extractTextFromPdf(file);
      const cleanText = extractedText.replace(/\s+/g, ' ');

      const poNumber = extractPoNumber(cleanText);
      const vendorCode = extractVendorCode(cleanText);
      const vendorName = findVendorName(vendorCode);

      if (!poNumber && !vendorCode) {
        renderRenameStatus(i, 'error', file.name, 'ไม่พบเลข PO และรหัส Vendor ในไฟล์');
        errorCount++;
        continue;
      }

      const poPart = sanitizeFileNamePart(poNumber || 'UnknownPO');
      const vendorPart = sanitizeFileNamePart(vendorName || vendorCode || 'UnknownVendor');
      const newFileName = `${poPart}-${vendorPart}.pdf`;

      downloadPdfBlob(arrayBuffer, newFileName);

      const detailParts = [];
      if (!poNumber) detailParts.push('ไม่พบเลข PO');
      if (vendorCode && !vendorName) detailParts.push(`ไม่พบชื่อสำหรับรหัส ${vendorCode} ในตาราง Mapping`);
      if (!vendorCode) detailParts.push('ไม่พบรหัส Vendor');

      renderRenameStatus(i, 'success', newFileName, detailParts.join(' • '));
      successCount++;
    } catch (err) {
      console.error('Rename PO error:', file.name, err);
      renderRenameStatus(i, 'error', file.name, err.message || 'เกิดข้อผิดพลาดระหว่างประมวลผล');
      errorCount++;
    }
  }

  btn.disabled = false;
  btn.classList.remove('is-loading');
  fileInput.value = '';
  renameSelectedFiles = [];
  $('renameFileCount').hidden = true;
  $('renameProcessBtn').disabled = true;

  if (errorCount === 0) {
    showToast(`ประมวลผลสำเร็จ ${successCount} ไฟล์`, 'success');
  } else {
    showToast(`สำเร็จ ${successCount} ไฟล์ / ผิดพลาด ${errorCount} ไฟล์`, successCount > 0 ? 'default' : 'error');
  }
}
