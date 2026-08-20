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
const PAGE_SIZE = 50; // แบ่งหน้าละ 50 แถว ลด noise เวลาสินค้าเยอะ
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

let allPrRequesters = [];        // cached รายชื่อผู้ขอ (สำหรับ combobox ในฟอร์มขอราคา)
let prRequestersLoaded = false;  // lazy-load: fetch only when tab first opened
let prRequesterHighlightIndex = -1; // index ที่ไฮไลต์ด้วยคีย์บอร์ดใน dropdown
let editingRequesterId = null;   // string = กำลังแก้ไขแถวนี้ใน modal จัดการ
let pendingDeleteRequester = null;
let renameSelectedFiles = [];    // File[] queued for Rename_PO processing

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);

const authScreen = $('authScreen');
const appScreen = $('appScreen');
const toastEl = $('toast');

// ==================================================
// Theme (สว่าง / มืด)
// ==================================================
// ธีมจริงถูกตั้งไปแล้วตั้งแต่ก่อน body render โดย inline script ใน <head> (กันจอกระพริบ)
// ฟังก์ชันนี้แค่ sync สถานะ checkbox ให้ตรงกับธีมปัจจุบัน + ผูก event ตอนผู้ใช้กดสลับ
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('.theme-toggle-checkbox').forEach(cb => { cb.checked = theme === 'light'; });
  const metaTheme = $('themeColorMeta');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'light' ? '#f3f6f7' : '#111111');
}

function initThemeToggle() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(current); // sync checkbox ให้ตรงกับที่ inline script ตั้งไว้แล้ว

  document.querySelectorAll('.theme-toggle-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const next = cb.checked ? 'light' : 'dark';
      try { localStorage.setItem('maiaekhub_theme', next); } catch (e) { /* private mode ฯลฯ — ยังสลับธีมได้ แค่ไม่จำข้ามเซสชัน */ }
      applyTheme(next);
    });
  });
}

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
  initThemeToggle();
  bindAuthTabs();
  bindAuthForms();
  bindLockScreen();
  bindAppEvents();
  bindModalEvents();
  bindImportEvents();
  bindProfileEvents();
  bindViewTabs();
  bindSidebarCollapse();
  bindSidebarProfileMenu();
  bindPriceRequestEvents();
  bindVendorEvents();
  bindVendorImportEvents();
  bindRenamePoEvents();
  bindInsights();
  bindProductInfoCard();
  bindReportModal();

  if (supabaseInitError || !sb) {
    showAuthScreen();
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
        stopIdleLock();
        stopInsightsPolling();
        hideLockScreen();
        showAuthScreen();
      }
    });
  } catch (err) {
    console.error('init session check failed:', err);
    showAuthScreen();
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
  stopIdleLock();
  stopInsightsPolling();
  hideLockScreen();
  await sb.auth.signOut();
  allPriceRequests = [];
  priceRequestsLoaded = false;
  currentPrFilter = 'all';
  currentPrSearch = '';
  showAuthScreen();
}

// ==================================================
// ล็อกหน้าจอเมื่อไม่มีการใช้งาน (idle) เกิน 30 นาที (ไม่ออกจากระบบจริง — session ยังอยู่ ต้องใส่รหัสผ่านซ้ำเพื่อกลับเข้าใช้งาน)
// ==================================================
const IDLE_LOCK_MS = 30 * 60 * 1000;            // ไม่มีการใช้งาน 30 นาที -> ล็อกหน้าจอ
const IDLE_WARNING_BEFORE_MS = 2 * 60 * 1000;   // เตือนล่วงหน้า 2 นาทีก่อนล็อกจริง
const IDLE_ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];
const IDLE_ACTIVITY_THROTTLE_MS = 1000; // กันรีเซ็ตตัวจับเวลาถี่เกินไป เพราะ mousemove ยิงรัวมาก
const LOCK_STORAGE_KEY = 'maiaekhub:locked'; // จำสถานะล็อกไว้ข้ามการรีเฟรชหน้า/เปิดแท็บใหม่ กันรีเฟรชแล้วหลุดผ่านล็อกไปเฉยๆ

let idleWarningTimer = null;
let idleLockTimer = null;
let lastIdleActivityAt = 0;

function startIdleLock() {
  IDLE_ACTIVITY_EVENTS.forEach(evt => document.addEventListener(evt, onIdleActivity, { passive: true }));
  document.addEventListener('visibilitychange', onIdleActivity);
  resetIdleLockTimer();
}

function stopIdleLock() {
  clearTimeout(idleWarningTimer);
  clearTimeout(idleLockTimer);
  idleWarningTimer = null;
  idleLockTimer = null;
  IDLE_ACTIVITY_EVENTS.forEach(evt => document.removeEventListener(evt, onIdleActivity));
  document.removeEventListener('visibilitychange', onIdleActivity);
}

function onIdleActivity() {
  const now = Date.now();
  if (now - lastIdleActivityAt < IDLE_ACTIVITY_THROTTLE_MS) return;
  lastIdleActivityAt = now;
  resetIdleLockTimer();
}

function resetIdleLockTimer() {
  if (!currentUser) return; // ยังไม่ได้ล็อกอิน ไม่ต้องตั้งเวลา
  clearTimeout(idleWarningTimer);
  clearTimeout(idleLockTimer);

  idleWarningTimer = setTimeout(() => {
    showToast('ไม่มีการใช้งานนาน — ระบบจะล็อกหน้าจออัตโนมัติใน 2 นาที', 'error');
  }, IDLE_LOCK_MS - IDLE_WARNING_BEFORE_MS);

  idleLockTimer = setTimeout(() => {
    lockApp();
  }, IDLE_LOCK_MS);
}

function isAppLocked() {
  try { return localStorage.getItem(LOCK_STORAGE_KEY) === '1'; } catch (_) { return false; }
}

// ล็อกหน้าจอ (ไม่ signOut) — เก็บ session ไว้เหมือนเดิม แค่บังหน้าจอไว้จนกว่าจะใส่รหัสผ่านถูก
function lockApp() {
  if (!currentUser) return;
  stopIdleLock(); // หยุดจับเวลาไว้ก่อน จนกว่าจะปลดล็อกแล้วค่อยเริ่มนับใหม่
  try { localStorage.setItem(LOCK_STORAGE_KEY, '1'); } catch (_) { /* localStorage ใช้ไม่ได้ก็ยังล็อกหน้าจอตอนนี้ได้ปกติ แค่รีเฟรชแล้วจะไม่ค้างสถานะล็อกไว้ */ }
  showLockScreen();
  showToast('ล็อกหน้าจออัตโนมัติ เนื่องจากไม่มีการใช้งานเกิน 30 นาที', 'default');
}

function showLockScreen() {
  const nameEl = $('lockScreenUsername');
  nameEl.value = (currentProfile && (currentProfile.username || currentProfile.display_name)) || (currentUser && currentUser.email) || '';
  $('lockPassword').value = '';
  setFieldError($('lockError'), '');
  $('lockScreen').classList.add('is-active');
  setTimeout(() => $('lockPassword').focus(), 50);
}

function hideLockScreen() {
  $('lockScreen').classList.remove('is-active');
  try { localStorage.removeItem(LOCK_STORAGE_KEY); } catch (_) { /* ไม่มีผลอะไรมาก แค่กันเหนียว */ }
}

async function onUnlockSubmit(e) {
  e.preventDefault();
  const password = $('lockPassword').value;
  const errorEl = $('lockError');
  const btn = $('unlockSubmit');
  setFieldError(errorEl, '');

  if (!sb || !currentUser || !currentUser.email) {
    setFieldError(errorEl, 'เชื่อมต่อระบบไม่สำเร็จ กรุณาโหลดหน้าใหม่');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;
  try {
    const { error } = await sb.auth.signInWithPassword({ email: currentUser.email, password });
    if (error) throw error;

    hideLockScreen();
    $('lockPassword').value = '';
    startIdleLock(); // เริ่มจับเวลาการไม่ได้ใช้งานใหม่หลังปลดล็อก
    showToast('ปลดล็อกสำเร็จ', 'success');
  } catch (err) {
    setFieldError(errorEl, err.message === 'Invalid login credentials'
      ? 'รหัสผ่านไม่ถูกต้อง'
      : (err.message || 'ปลดล็อกไม่สำเร็จ'));
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

function bindLockScreen() {
  $('unlockForm').addEventListener('submit', onUnlockSubmit);
  $('lockScreenLogoutBtn').addEventListener('click', onLogout);
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
  if (isAppLocked()) {
    // เคยล็อกหน้าจอค้างไว้จากรอบก่อน (เช่น idle แล้วรีเฟรช/เปิดแท็บใหม่) -> ล็อกต่อทันที ไม่ต้องรอ idle timer ใหม่
    showLockScreen();
  } else {
    startIdleLock();
  }
  startInsightsPolling();
  await loadProducts();
  loadPriceRequests(); // โหลดล่วงหน้าเงียบๆ (ไม่ await) เพื่อให้ badge แจ้งเตือนนับงานขอราคาค้างได้ถูกต้องตั้งแต่เข้าเว็บ แม้ยังไม่ได้กดแท็บ "ขอราคา"
}

function roleLabel(role) {
  return { owner: 'Owner', admin: 'Admin', general_user: 'General User' }[role] || role;
}

function applyRolePermissions() {
  const nameToShow = currentProfile.display_name || currentProfile.username;
  $('userBadge').innerHTML = `<span class="role-dot"></span><span class="user-badge-text">${escapeHtml(nameToShow)} · ${roleLabel(currentProfile.role)}</span>`;
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
function hideBootSplash() {
  const splash = $('bootSplash');
  if (splash) splash.classList.add('is-hidden');
}

function showAuthScreen() {
  hideBootSplash();
  authScreen.classList.add('is-active');
  appScreen.classList.remove('is-active');
}

function showAppScreen() {
  hideBootSplash();
  authScreen.classList.remove('is-active');
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
// Fuzzy search (ค้นหาแบบพิมพ์ผิด/สลับคำก็ยังเจอ) — ทำงานฝั่ง client ล้วนๆ ไม่มีค่าใช้จ่ายเพิ่ม
// ==================================================
function normalizeSearchText(s) {
  return (s || '').toString().toLowerCase().replace(/\s+/g, ' ').trim();
}

// Levenshtein distance (จำนวนตัวอักษรที่ต้องเพิ่ม/ลบ/แก้ เพื่อให้สองคำเหมือนกัน) — ใช้ two-row DP กันเปลือง memory
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ยอมพิมพ์ผิดได้กี่ตัวอักษร ขึ้นกับความยาวคำ (คำสั้นต้องตรงเป๊ะ กันจับคู่มั่ว, คำยาวยอมผิดได้มากขึ้น)
function maxAllowedTypoDistance(len) {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

// เจอคำค้น (token) นี้ในข้อความเป้าหมายไหม — ตรงตัว/เป็นส่วนหนึ่งของคำ (เร็วสุด) หรือใกล้เคียงพอ (พิมพ์ผิดนิดหน่อย)
function tokenMatchesText(token, words, fullText) {
  if (!token) return true;
  if (fullText.includes(token)) return true; // fast path: ตรงตัวอยู่แล้ว
  const maxDist = maxAllowedTypoDistance(token.length);
  if (maxDist === 0) return false;
  for (const w of words) {
    if (Math.abs(w.length - token.length) > maxDist) continue; // ความยาวห่างกันเกินไป ตัดทิ้งไว perf
    if (levenshtein(token, w) <= maxDist) return true;
  }
  return false;
}

// สร้าง/แคช search index (คำแยกเป็น token + ข้อความเต็ม) — ใช้ WeakMap แยกไว้ต่างหาก
// (ไม่ปนกับตัว object เอง กันหลุดไปติดอยู่ใน audit log/CSV export ตอน JSON.stringify ทั้งก้อน)
const __searchIndexCache = new WeakMap();
function getSearchIndex(obj, fields) {
  let idx = __searchIndexCache.get(obj);
  if (!idx) {
    const text = normalizeSearchText(fields.map(f => obj[f] || '').join(' '));
    idx = { text, words: text.split(' ').filter(Boolean) };
    __searchIndexCache.set(obj, idx);
  }
  return idx;
}

// คืนค่า true ถ้าทุก token ในคำค้นเจอในข้อความเป้าหมาย (ไม่สนลำดับ พิมพ์คำไหนก่อนก็ได้ พิมพ์ผิดนิดหน่อยก็เจอ)
function fuzzySearchMatch(query, obj, fields) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const idx = getSearchIndex(obj, fields);
  return tokens.every(t => tokenMatchesText(t, idx.words, idx.text));
}

// คืนค่า true ถ้าทุก token ในคำค้น "ตรงตัว" (เป็นส่วนหนึ่งของข้อความ) ล้วนๆ — ไม่ยอมพิมพ์ผิดเลย
function exactSearchMatch(query, obj, fields) {
  const tokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  const idx = getSearchIndex(obj, fields);
  return tokens.every(t => idx.text.includes(t));
}

// ค้นหาแบบฉลาด: ลองหาแบบตรงตัว (exact) ก่อน — ถ้าเจอ ให้ใช้ผลลัพธ์ชุดนั้นเท่านั้น (กันรหัสสินค้าที่คล้ายกันแต่ไม่ใช่ตัวเดียวกันหลุดมาปนตอนพิมพ์รหัสครบเป๊ะ)
// ถ้าหาแบบตรงตัวไม่เจอเลย ค่อย fallback ไปใช้ fuzzy (กันพิมพ์ผิด/สลับคำ) เหมือนเดิม
function smartSearchFilter(query, list, fields) {
  const exact = list.filter(obj => exactSearchMatch(query, obj, fields));
  if (exact.length > 0) return exact;
  return list.filter(obj => fuzzySearchMatch(query, obj, fields));
}

// Ctrl+Enter (หรือ Cmd+Enter บน Mac) = บันทึกฟอร์มทันที แม้ focus จะอยู่ใน textarea
// (ปกติ Enter ในตัว textarea จะขึ้นบรรทัดใหม่ ไม่ submit — คีย์ลัดนี้ยิง submit event ให้ตรงๆ)
function bindCtrlEnterSubmit(formId) {
  const form = $(formId);
  form.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });
}

// ==================================================
// View tabs (สินค้า / ขอราคา)
// ==================================================
function bindViewTabs() {
  document.querySelectorAll('.view-tab[data-view]').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
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
// Sidebar — ย่อ/ขยาย (แทนที่ header เดิม, จำสถานะไว้ใน localStorage)
// ==================================================
function sidebarCollapseStorageKey() {
  const uid = currentUser && currentUser.id ? currentUser.id : 'anon';
  return `maiaekhub:sidebarCollapsed:${uid}`;
}

function bindSidebarCollapse() {
  const sidebar = $('appSidebar');
  const btn = $('sidebarCollapseBtn');

  let collapsed = false;
  try { collapsed = localStorage.getItem(sidebarCollapseStorageKey()) === '1'; } catch (_) { /* localStorage ใช้ไม่ได้ — ปล่อยเป็นค่าเริ่มต้น (ขยาย) */ }
  setSidebarCollapsed(collapsed);

  btn.addEventListener('click', () => {
    setSidebarCollapsed(!sidebar.classList.contains('is-collapsed'));
  });

  function setSidebarCollapsed(next) {
    sidebar.classList.toggle('is-collapsed', next);
    btn.setAttribute('aria-expanded', String(!next));
    try { localStorage.setItem(sidebarCollapseStorageKey(), next ? '1' : '0'); } catch (_) { /* ข้ามไปเงียบๆ ถ้าจำสถานะไม่ได้ */ }
    // เมนู "เครื่องมือ" ที่เปิดค้างอยู่ตอนย่อ sidebar จะดูแปลกๆ (trigger เหลือแค่ไอคอน) — ปิดไปด้วยเลยกันสับสน
    closeToolsDropdown();
  }
}

// ==================================================
// Sidebar — เมนูโปรไฟล์ท้าย sidebar (แก้ไขโปรไฟล์ / โหมดมืดสว่าง / ออกจากระบบ)
// ==================================================
function bindSidebarProfileMenu() {
  const wrap = $('sidebarProfile');
  const trigger = $('sidebarProfileTrigger');
  const menu = $('sidebarProfileMenu');

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = wrap.classList.contains('is-open');
    if (isOpen) closeSidebarProfileMenu(); else openSidebarProfileMenu();
  });

  // คลิกรายการในเมนู (นอกเหนือจาก dark-mode toggle ที่ต้องเปิดเมนูค้างไว้ให้กดสลับซ้ำได้) แล้วปิดเมนูให้เลย
  menu.querySelectorAll('#profileAvatarBtn, #logoutBtn').forEach(el => {
    el.addEventListener('click', () => closeSidebarProfileMenu());
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeSidebarProfileMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSidebarProfileMenu();
  });

  function openSidebarProfileMenu() {
    wrap.classList.add('is-open');
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeSidebarProfileMenu() {
    wrap.classList.remove('is-open');
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  }
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

      // เมนูตอนนี้เรียงแนวตั้งใน sidebar (เดิมเรียงแนวนอน) — ใช้แกน Y แทน X ในการตัดสินว่าจะวางก่อน/หลัง
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      nav.querySelectorAll('[data-tab-key]').forEach(t => t.classList.remove('drag-over'));
      el.classList.add('drag-over');
      el.classList.toggle('drag-over-before', before);
      el.classList.toggle('drag-over-after', !before);
    });

    el.addEventListener('drop', (e) => {
      if (!dragEl || dragEl === el) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
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

  document.querySelectorAll('.mobile-nav-item[data-view]').forEach(item => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', String(active));
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
  if (view === 'priceRequests' && !prRequestersLoaded) {
    loadPrRequesters();
  }
  if (view === 'renamePo' && !vendorMappingsLoaded) {
    loadVendorMappings();
  }
}

// ==================================================
// Load & render products
// ==================================================
// ==================================================
// Cache ข้อมูลไว้ใน sessionStorage — โชว์ของเดิมทันทีระหว่างรอโหลดข้อมูลใหม่ (stale-while-revalidate)
// กันตารางว่างโล่งๆ / ขึ้น loading วาบๆ ทุกครั้งที่รีเฟรชหน้าในแท็บเดิม (ลดอาการกระตุกตามที่แจ้ง)
// ==================================================
function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeSessionCache(key, list) {
  try {
    sessionStorage.setItem(key, JSON.stringify(list));
  } catch (_) {
    // sessionStorage เต็มโควต้าหรือใช้ไม่ได้ (เช่น private mode) — ข้าม cache ไปเงียบๆ ไม่กระทบการทำงานหลัก
  }
}

async function loadProducts() {
  const cached = readSessionCache('maiaekhub:cache:products');
  if (cached && cached.length) {
    // มีข้อมูลจากรอบก่อนในแท็บนี้ -> โชว์ทันทีก่อนเลยระหว่างรอข้อมูลใหม่ แทนที่จะเคลียร์ตารางโล่งๆ แล้วขึ้น loading
    allProducts = cached;
    renderProducts();
    updateInsightsBadge();
  } else {
    $('loadingState').style.display = 'flex';
    $('emptyState').hidden = true;
  }

  const { data, error } = await sb
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });

  $('loadingState').style.display = 'none';

  if (error) {
    if (cached && cached.length) {
      // มีข้อมูลเดิมอยู่แล้วบนจอ แค่รีเฟรชล่าสุดพลาด -> เตือนเบาๆ พอ ไม่ต้องเคลียร์ของที่เห็นอยู่ทิ้ง
      showToast('อัปเดตข้อมูลสินค้าล่าสุดไม่สำเร็จ (แสดงข้อมูลล่าสุดที่มีอยู่ในเครื่อง)', 'error');
    } else {
      showToast('โหลดข้อมูลสินค้าไม่สำเร็จ: ' + error.message, 'error');
      allProducts = [];
      renderProducts();
      updateInsightsBadge();
    }
    return;
  }

  allProducts = data || [];
  writeSessionCache('maiaekhub:cache:products', allProducts);
  renderProducts();
  updateInsightsBadge();
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
  const query = $('searchInput').value.trim();
  let filtered = query
    ? smartSearchFilter(query, allProducts, ['product_name', 'product_code', 'items_vendor'])
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

// ==================================================
// Inline edit ราคา (double-click ในตาราง แก้เร็วโดยไม่ต้องเปิด modal)
// ==================================================
function startInlinePriceEdit(cell) {
  if (cell.querySelector('input')) return; // กำลังแก้อยู่แล้ว
  const productId = cell.dataset.id;
  const product = allProducts.find(p => p.id === productId);
  if (!product) return;

  const originalHtml = cell.innerHTML;
  const originalLabel = cell.dataset.label;
  cell.dataset.label = 'ราคา';
  cell.classList.add('is-editing');
  cell.innerHTML = `<input type="number" step="0.01" class="price-inline-input" value="${product.price ?? ''}">`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();

  let settled = false;

  const finish = async (commit) => {
    if (settled) return;
    settled = true;

    if (!commit) {
      cell.classList.remove('is-editing');
      cell.dataset.label = originalLabel;
      cell.innerHTML = originalHtml;
      return;
    }

    const newPrice = parseFloat(input.value);
    if (Number.isNaN(newPrice) || newPrice < 0) {
      showToast('ราคาต้องเป็นตัวเลขที่ถูกต้อง', 'error');
      cell.classList.remove('is-editing');
      cell.dataset.label = originalLabel;
      cell.innerHTML = originalHtml;
      return;
    }

    if (newPrice === Number(product.price)) {
      cell.classList.remove('is-editing');
      cell.dataset.label = originalLabel;
      cell.innerHTML = originalHtml;
      return;
    }

    input.disabled = true;
    try {
      const payload = { price: newPrice, price_updated_at: todayIso(), updated_by: currentUser.id };
      const { data, error } = await sb
        .from('products')
        .update(payload)
        .eq('id', productId)
        .select()
        .single();
      if (error) throw error;

      await writeAuditLog('edit', data, product, data);
      showToast('อัปเดตราคาสำเร็จ', 'success');
      await loadProducts();
    } catch (err) {
      showToast('อัปเดตราคาไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'), 'error');
      cell.classList.remove('is-editing');
      cell.dataset.label = originalLabel;
      cell.innerHTML = originalHtml;
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function hasAnyDiscountStep(p) {
  return [p.discount_step_1, p.discount_step_2, p.discount_step_3, p.discount_step_4]
    .some(v => v != null && v !== '');
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
  const startIdx = Number.isFinite(PAGE_SIZE) ? (currentPage - 1) * PAGE_SIZE : 0;
  const pageItems = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const canDel = canDelete();

  pageItems.forEach(p => {
    const tr = document.createElement('tr');
    const isSelected = selectedProductIds.has(p.id);
    if (isSelected) tr.classList.add('is-selected');
    tr.classList.add('product-row');
    tr.innerHTML = `
      <td class="checkbox-col"><input type="checkbox" class="row-select-checkbox" data-id="${p.id}" ${isSelected ? 'checked' : ''} aria-label="เลือกสินค้า ${escapeHtml(p.product_name)}"></td>
      <td class="product-code" data-label="รหัสสินค้า">${escapeHtml(p.product_code)}</td>
      <td class="product-name" data-label="ชื่อสินค้า">
        <span class="product-name-text">${escapeHtml(p.product_name)}</span>
        <button class="copy-btn" data-action="copy" data-id="${p.id}" title="คัดลอกรหัส + ชื่อสินค้า" aria-label="คัดลอกรหัสและชื่อสินค้า ${escapeHtml(p.product_name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </td>
      <td class="num price-cell" data-label="ราคา" data-id="${p.id}" title="ดับเบิลคลิกเพื่อแก้ไขราคาเร็ว">${formatMoney(p.price)}</td>
      <td class="num discount-steps-cell" data-label="ส่วนลด">
        <button type="button" class="discount-steps-toggle" data-action="toggle-steps" aria-expanded="false" title="ดูสเต็ปส่วนลด 1-4">
          ${hasAnyDiscountStep(p) ? 'มีส่วนลด' : '<span class="cell-empty">—</span>'}
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <span class="discount-steps-mobile-text">${
          hasAnyDiscountStep(p)
            ? [1, 2, 3, 4].map(n => {
                const v = p[`discount_step_${n}`];
                return (v != null && v !== '') ? `S${n}: ${escapeHtml(v)}` : '';
              }).filter(Boolean).join(' · ')
            : '<span class="cell-empty">—</span>'
        }</span>
      </td>
      <td class="order-condition" data-label="เงื่อนไข">${p.order_condition ? escapeHtml(p.order_condition) : '<span class="cell-empty">—</span>'}</td>
      <td class="items-vendor" data-label="Items Vendor">${p.items_vendor
        ? `<span class="items-vendor-text">${escapeHtml(p.items_vendor)}</span>
           <button class="copy-btn" data-action="copy-vendor" data-id="${p.id}" title="คัดลอก Items Vendor" aria-label="คัดลอก Items Vendor ${escapeHtml(p.items_vendor)}">
             <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
           </button>`
        : '<span class="cell-empty">—</span>'}</td>
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

    // กดที่แถวสินค้า (ไม่ใช่ปุ่ม/checkbox/ช่องราคาที่ดับเบิลคลิกแก้ไขได้) -> เปิดการ์ดสรุปข้อมูลสไตล์ pixel game
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button, input, a, .price-cell')) return;
      openProductInfoCard(p.id);
    });

    const stepsRow = document.createElement('tr');
    stepsRow.className = 'discount-steps-row';
    stepsRow.hidden = true;
    stepsRow.innerHTML = `
      <td colspan="9">
        <div class="discount-steps-detail">
          <span><b>สเต็ป 1:</b> ${p.discount_step_1 != null && p.discount_step_1 !== '' ? escapeHtml(p.discount_step_1) : '—'}</span>
          <span><b>สเต็ป 2:</b> ${p.discount_step_2 != null && p.discount_step_2 !== '' ? escapeHtml(p.discount_step_2) : '—'}</span>
          <span><b>สเต็ป 3:</b> ${p.discount_step_3 != null && p.discount_step_3 !== '' ? escapeHtml(p.discount_step_3) : '—'}</span>
          <span><b>สเต็ป 4:</b> ${p.discount_step_4 != null && p.discount_step_4 !== '' ? escapeHtml(p.discount_step_4) : '—'}</span>
        </div>
      </td>
    `;
    tbody.appendChild(stepsRow);
  });

  tbody.querySelectorAll('[data-action="toggle-steps"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const stepsRow = btn.closest('tr').nextElementSibling;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      stepsRow.hidden = expanded;
    });
  });

  tbody.querySelectorAll('.price-cell').forEach(cell => {
    cell.addEventListener('dblclick', () => startInlinePriceEdit(cell));
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
  tbody.querySelectorAll('[data-action="copy-vendor"]').forEach(btn => {
    btn.addEventListener('click', () => copyItemsVendor(btn));
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
    const startIdx = Number.isFinite(PAGE_SIZE) ? (currentPage - 1) * PAGE_SIZE : 0;
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

  const startIdx = Number.isFinite(PAGE_SIZE) ? (currentPage - 1) * PAGE_SIZE : 0;
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

async function copyPlainText(text, btn) {
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
  if (btn) {
    btn.classList.add('is-copied');
    setTimeout(() => btn.classList.remove('is-copied'), 1200);
  }
}

async function copyProductCodeAndName(btn) {
  const p = allProducts.find(x => x.id === btn.dataset.id);
  if (!p) return;
  await copyPlainText(`${p.product_code} ${p.product_name}`, btn);
}

async function copyItemsVendor(btn) {
  const p = allProducts.find(x => x.id === btn.dataset.id);
  if (!p || !p.items_vendor) return;
  await copyPlainText(p.items_vendor, btn);
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
  bindCtrlEnterSubmit('productForm');
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

  // Ctrl+N / Cmd+N: เปิดตัวเพิ่มสินค้า (หน้าสินค้า) หรือเพิ่มงานขอราคา (หน้าขอราคา)
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'n') return;

    const onProductsView = !$('productsView').hidden;
    const onPrView = !$('priceRequestsView').hidden;
    if (!onProductsView && !onPrView) return; // อยู่หน้าเครื่องมือ ไม่ทำอะไร ปล่อยให้เบราว์เซอร์ทำงานปกติ

    e.preventDefault(); // กัน browser เปิดหน้าต่างใหม่
    if (onProductsView) {
      openProductModal(null);
    } else if (onPrView) {
      openPrModal(null);
    }
  });
}

// ==================================================
// การ์ดสรุปข้อมูลสินค้าสไตล์ pixel game (กดที่แถวสินค้าเพื่อดูภาพรวมเร็วๆ โดยไม่ต้องเปิดฟอร์มแก้ไข)
// ==================================================
// แปลงชื่อหมวด (เช่น "K04", "C02") ให้เป็นค่า hue คงที่ (0-360) เพื่อให้แต่ละหมวดมีโทนสีเฉพาะตัวที่ไม่ซ้ำกัน แต่ยังคงเดิมทุกครั้ง
function categoryHue(category) {
  if (!category) return 45; // ไม่มีหมวด -> ใช้โทนทองเหมือนสี accent หลักของเว็บ
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = (hash * 31 + category.charCodeAt(i)) >>> 0;
  return hash % 360;
}

function openProductInfoCard(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;

  const category = getProductCategory(p.product_code);
  const hue = categoryHue(category);
  $('pixelCard').style.setProperty('--pixel-hue', String(hue));

  $('pixelCardCategory').textContent = category || '—';
  $('pixelCardCode').textContent = p.product_code;
  $('pixelCardName').textContent = p.product_name;
  $('pixelCardPrice').textContent = formatMoney(p.price);

  const hasDiscount = hasAnyDiscountStep(p);
  const days = daysSince(p.price_updated_at);
  const isStale = days !== null && days > STALE_PRICE_DAYS;

  $('pixelCardSaleRibbon').hidden = !hasDiscount;
  $('pixelCardStaleRibbon').hidden = !isStale;

  const stepsHtml = [1, 2, 3, 4]
    .map(n => p[`discount_step_${n}`])
    .filter(v => v != null && v !== '')
    .map((v, i) => `<div class="pixel-stat-row"><span class="pixel-stat-key">สเต็ป ${i + 1}</span><span class="pixel-stat-val">${escapeHtml(v)}</span></div>`)
    .join('');

  $('pixelCardStats').innerHTML = `
    ${stepsHtml || '<div class="pixel-stat-row"><span class="pixel-stat-key">ส่วนลด</span><span class="pixel-stat-val pixel-stat-empty">ไม่มี</span></div>'}
    <div class="pixel-stat-row">
      <span class="pixel-stat-key">เงื่อนไขสั่งซื้อ</span>
      <span class="pixel-stat-val">${p.order_condition ? escapeHtml(p.order_condition) : '<span class="pixel-stat-empty">—</span>'}</span>
    </div>
    <div class="pixel-stat-row">
      <span class="pixel-stat-key">Items Vendor</span>
      <span class="pixel-stat-val">${p.items_vendor ? escapeHtml(p.items_vendor) : '<span class="pixel-stat-empty">—</span>'}</span>
    </div>
    <div class="pixel-stat-row${isStale ? ' is-alert' : ''}">
      <span class="pixel-stat-key">อัปเดตราคาล่าสุด</span>
      <span class="pixel-stat-val">${p.price_updated_at ? `${formatPrDate(p.price_updated_at)}${days !== null ? ` (${days} วันก่อน)` : ''}` : '<span class="pixel-stat-empty">—</span>'}</span>
    </div>
  `;

  const editBtn = $('pixelCardEditBtn');
  editBtn.onclick = () => { closeProductInfoCard(); openProductModal(p.id); };

  const copyBtn = $('pixelCardCopyBtn');
  copyBtn.dataset.id = p.id;
  copyBtn.onclick = () => copyProductCodeAndName(copyBtn);

  $('productInfoModal').hidden = false;
  $('productInfoModal').classList.add('is-visible');
}

function closeProductInfoCard() {
  $('productInfoModal').classList.remove('is-visible');
  $('productInfoModal').hidden = true;
}

function bindProductInfoCard() {
  $('closePixelCard').addEventListener('click', closeProductInfoCard);
  $('productInfoModal').addEventListener('click', (e) => { if (e.target === $('productInfoModal')) closeProductInfoCard(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('productInfoModal').classList.contains('is-visible')) closeProductInfoCard();
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
    $('fPrice').value = p.price ?? '';
    $('fStep1').value = p.discount_step_1 ?? '';
    $('fStep2').value = p.discount_step_2 ?? '';
    $('fStep3').value = p.discount_step_3 ?? '';
    $('fStep4').value = p.discount_step_4 ?? '';
    $('fCondition').value = p.order_condition || '';
    $('fItemsVendor').value = p.items_vendor || '';
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
    price: parseFloat($('fPrice').value) || 0,
    discount_step_1: $('fStep1').value.trim() || null,
    discount_step_2: $('fStep2').value.trim() || null,
    discount_step_3: $('fStep3').value.trim() || null,
    discount_step_4: $('fStep4').value.trim() || null,
    order_condition: $('fCondition').value.trim() || null,
    items_vendor: $('fItemsVendor').value.trim() || null,
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

      await writeAuditLog('create', data, null, data);
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
    } else if (log.action === 'create') {
      diffHtml = `<div class="history-diff">เพิ่มสินค้าใหม่ <span class="diff-code">${escapeHtml(log.product_code || '')}</span>${log.new_value?.product_name ? ' — ' + escapeHtml(log.new_value.product_name) : ''}</div>`;
    }

    const actionLabel = { create: 'เพิ่มใหม่', edit: 'แก้ไข', delete: 'ลบ' }[log.action] || log.action;

    div.innerHTML = `
      <div class="history-item-head">
        <span class="history-action ${log.action}">${actionLabel}</span>
        <span class="history-meta"><span class="history-user">${escapeHtml(log.username)}</span> · ${dateStr}</span>
      </div>
      ${diffHtml}
    `;
    list.appendChild(div);
  });
}

const PRODUCT_FIELD_LABELS = {
  product_code: 'รหัสสินค้า', product_name: 'ชื่อสินค้า', price: 'ราคา',
  discount_step_1: 'สเต็ป 1', discount_step_2: 'สเต็ป 2',
  discount_step_3: 'สเต็ป 3', discount_step_4: 'สเต็ป 4',
  order_condition: 'เงื่อนไขการสั่งซื้อ', items_vendor: 'Items Vendor'
};

function buildDiffHtml(oldVal, newVal) {
  const changes = [];
  Object.keys(PRODUCT_FIELD_LABELS).forEach(key => {
    const ov = oldVal[key];
    const nv = newVal[key];
    if (String(ov ?? '') !== String(nv ?? '')) {
      changes.push(`<div class="history-diff"><span class="diff-code">${PRODUCT_FIELD_LABELS[key]}</span>: ${escapeHtml(ov ?? '—')} → ${escapeHtml(nv ?? '—')}</div>`);
    }
  });
  return changes.join('') || '<div class="history-diff">ไม่มีการเปลี่ยนแปลงค่า</div>';
}

// เวอร์ชันแยกคอลัมน์ของ diff ด้านบน — ใช้ในไฟล์รายงาน Excel (แยกราคา/ชื่อ/ส่วนลด/อื่นๆ เดิม-ใหม่ เป็นคอลัมน์ชัดเจน แทนที่จะยัดรวมในข้อความเดียว)
function discountStepsSummary(obj) {
  const parts = [1, 2, 3, 4]
    .map(n => ({ n, v: obj[`discount_step_${n}`] }))
    .filter(x => x.v !== null && x.v !== undefined && x.v !== '');
  return parts.map(x => `สเต็ป${x.n}: ${x.v}`).join(' | ');
}

function otherFieldsSummary(obj) {
  const parts = [];
  if (obj.order_condition) parts.push(`เงื่อนไขสั่งซื้อ: ${obj.order_condition}`);
  if (obj.items_vendor) parts.push(`Items Vendor: ${obj.items_vendor}`);
  return parts.join(' | ');
}

// คืนคอลัมน์ "เดิม"/"ใหม่" สำหรับฟิลด์คู่หนึ่งๆ ของแถวรายงาน 1 แถว ตามประเภทการกระทำ
// - create: ไม่มี "เดิม" (ใส่ '-') มีแต่ "ใหม่"
// - delete: ไม่มี "ใหม่" (ใส่ '-') มีแต่ "เดิม" (ค่าที่ถูกลบไป)
// - edit: โชว์ทั้งสองฝั่งเฉพาะตอนค่าเปลี่ยนจริง ถ้าฟิลด์นั้นไม่ได้แก้ไขเลยจะเว้นว่างทั้งคู่ (ลดความรก เห็นเฉพาะจุดที่เปลี่ยนจริง)
function reportFieldPair(action, oldText, newText) {
  if (action === 'create') return { oldVal: '-', newVal: newText || '-' };
  if (action === 'delete') return { oldVal: oldText || '-', newVal: '-' };
  // edit
  if ((oldText || '') === (newText || '')) return { oldVal: '', newVal: '' };
  return { oldVal: oldText || '-', newVal: newText || '-' };
}

function closeHistoryModal() {
  $('historyModal').classList.remove('is-visible');
  $('historyModal').hidden = true;
}

// ==================================================
// รายงาน (Report Export) — ดึงประวัติสินค้า (เพิ่ม/แก้ไข/ลบ) และรายการขอราคา ตามช่วงวันที่ที่เลือก แล้ว export เป็น Excel (.xlsx)
// ==================================================
function openReportModal() {
  setFieldError($('reportError'), '');
  // ค่าเริ่มต้น: ช่วง 7 วันล่าสุด (รวมวันนี้) กันผู้ใช้ต้องมาเลือกวันที่เองทุกครั้ง
  if (!$('reportEndDate').value) {
    const today = todayIso();
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 6);
    $('reportEndDate').value = today;
    $('reportStartDate').value = weekAgo.toISOString().slice(0, 10);
  }
  $('reportModal').hidden = false;
  $('reportModal').classList.add('is-visible');
}

function closeReportModal() {
  $('reportModal').classList.remove('is-visible');
  $('reportModal').hidden = true;
}

function bindReportModal() {
  $('reportExportMenuBtn').addEventListener('click', () => {
    closeToolsDropdown();
    openReportModal();
  });
  $('closeReportModal').addEventListener('click', closeReportModal);
  $('cancelReportBtn').addEventListener('click', closeReportModal);
  $('reportModal').addEventListener('click', (e) => { if (e.target === $('reportModal')) closeReportModal(); });
  $('generateReportBtn').addEventListener('click', generateReport);
}

// ดึง map ของ user id -> ชื่อผู้ใช้ที่แสดงผล (username หรือ display_name) — ใช้ระบุ "ผู้ดำเนินการ" ในรายงานขอราคา
// (audit_logs ของสินค้าเก็บ username ไว้ตรงๆ ตอนบันทึกแล้ว ไม่ต้องมาไล่หาซ้ำ)
async function fetchProfilesMap() {
  const map = {};
  try {
    const { data, error } = await sb.from('profiles').select('id, username, display_name');
    if (!error && data) {
      data.forEach(p => { map[p.id] = p.display_name || p.username || '-'; });
    }
  } catch (err) {
    console.error('fetchProfilesMap failed', err);
  }
  return map;
}

async function generateReport() {
  const errorEl = $('reportError');
  setFieldError(errorEl, '');

  const startDate = $('reportStartDate').value;
  const endDate = $('reportEndDate').value;
  const includeProducts = $('reportIncludeProducts').checked;
  const includePr = $('reportIncludePr').checked;

  if (!startDate || !endDate) {
    setFieldError(errorEl, 'กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด');
    return;
  }
  if (startDate > endDate) {
    setFieldError(errorEl, 'วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
    return;
  }
  if (!includeProducts && !includePr) {
    setFieldError(errorEl, 'กรุณาเลือกประเภทข้อมูลอย่างน้อย 1 อย่าง');
    return;
  }

  const btn = $('generateReportBtn');
  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const wb = XLSX.utils.book_new();
    let sheetCount = 0;

    if (includeProducts) {
      const rangeStart = `${startDate}T00:00:00`;
      const rangeEnd = `${endDate}T23:59:59.999`;
      const { data, error } = await sb
        .from('audit_logs')
        .select('*')
        .gte('created_at', rangeStart)
        .lte('created_at', rangeEnd)
        .order('created_at', { ascending: true });
      if (error) throw new Error('โหลดประวัติสินค้าไม่สำเร็จ: ' + error.message);

      const actionLabel = { create: 'เพิ่มใหม่', edit: 'แก้ไข', delete: 'ลบ' };
      const rows = (data || []).map(log => {
        const dt = new Date(log.created_at);
        const ov = log.old_value || {};
        const nv = log.new_value || {};

        const name = reportFieldPair(log.action, ov.product_name, nv.product_name);
        const price = reportFieldPair(
          log.action,
          ov.price !== undefined && ov.price !== null ? String(ov.price) : '',
          nv.price !== undefined && nv.price !== null ? String(nv.price) : ''
        );
        const discount = reportFieldPair(log.action, discountStepsSummary(ov), discountStepsSummary(nv));
        const other = reportFieldPair(log.action, otherFieldsSummary(ov), otherFieldsSummary(nv));

        return {
          'วันที่': dt.toLocaleDateString('th-TH'),
          'เวลา': dt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
          'การดำเนินการ': actionLabel[log.action] || log.action,
          'รหัสสินค้า': log.product_code || '-',
          'ชื่อสินค้าเดิม': name.oldVal,
          'ชื่อสินค้าใหม่': name.newVal,
          'ราคาเดิม': price.oldVal,
          'ราคาใหม่': price.newVal,
          'ส่วนลดเดิม': discount.oldVal,
          'ส่วนลดใหม่': discount.newVal,
          'อื่นๆ เดิม': other.oldVal,
          'อื่นๆ ใหม่': other.newVal,
          'ผู้ดำเนินการ': log.username || '-',
        };
      });

      const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ผลลัพธ์': 'ไม่มีข้อมูลในช่วงวันที่ที่เลือก' }]);
      sheet['!cols'] = [
        { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 18 },
        { wch: 26 }, { wch: 26 }, { wch: 12 }, { wch: 12 },
        { wch: 24 }, { wch: 24 }, { wch: 30 }, { wch: 30 },
        { wch: 16 },
      ];
      XLSX.utils.book_append_sheet(wb, sheet, 'รายงานสินค้า');
      sheetCount++;
    }

    if (includePr) {
      const { data, error } = await sb
        .from('price_requests')
        .select('*')
        .gte('request_date', startDate)
        .lte('request_date', endDate)
        .order('request_date', { ascending: true });
      if (error) throw new Error('โหลดข้อมูลขอราคาไม่สำเร็จ: ' + error.message);

      const profilesMap = await fetchProfilesMap();
      const rows = (data || []).map(r => {
        const actorId = r.updated_by || r.created_by;
        return {
          'วันที่ขอราคา': formatPrDate(r.request_date),
          'ผู้ขอ': r.requested_by || '-',
          'แหล่งที่มา': r.source || '-',
          'รายละเอียด': r.details || '-',
          'ผู้ขาย (Vendor)': r.vendor || '-',
          'สถานะปัจจุบัน': PR_STATUS_LABEL[r.status] || r.status || '-',
          'บันทึกข้อความ': r.notes || '-',
          'ผู้ดำเนินการล่าสุด': (actorId && profilesMap[actorId]) || '-',
          'แก้ไขล่าสุด': r.last_edited_at ? formatPrDate(r.last_edited_at) : '-',
        };
      });

      const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'ผลลัพธ์': 'ไม่มีข้อมูลในช่วงวันที่ที่เลือก' }]);
      sheet['!cols'] = [{ wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 30 }, { wch: 18 }, { wch: 14 }, { wch: 30 }, { wch: 16 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, sheet, 'รายงานขอราคา');
      sheetCount++;
    }

    if (sheetCount === 0) throw new Error('ไม่มีข้อมูลให้ส่งออก');

    const fileName = `maiaekhub_รายงาน_${startDate}_ถึง_${endDate}.xlsx`;
    XLSX.writeFile(wb, fileName);

    showToast('สร้างรายงานสำเร็จ กำลังดาวน์โหลด', 'success');
    closeReportModal();
  } catch (err) {
    setFieldError(errorEl, err.message || 'สร้างรายงานไม่สำเร็จ');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Import Products from CSV/Excel
// ==================================================
const IMPORT_COLUMNS = [
  'product_code', 'product_name', 'price',
  'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4',
  'order_condition', 'items_vendor'
];
const IMPORT_TEMPLATE_HEADER = IMPORT_COLUMNS.join(',');
const IMPORT_TEMPLATE_SAMPLE = 'SKU-001,ตัวอย่างสินค้า,100.00,90.00,85.00,80.00,75.00,สั่งขั้นต่ำ 10 ชิ้น,ตัวอย่าง Vendor';

let importParsedRows = []; // rows after validation: { data, status: 'new'|'update'|'error', note }
let importMode = 'auto'; // ตัวเลือกที่ผู้ใช้ตั้ง: 'auto' | 'full' | 'partial'
let importEffectiveMode = 'full'; // โหมดที่ใช้จริงหลัง parse ไฟล์แล้ว (ถ้า importMode === 'auto' จะคำนวณจาก header ของไฟล์)
let importUpdatableFields = []; // ฟิลด์ที่โหมด partial จะเทียบ/อัปเดตจริง (คำนวณจาก header ของไฟล์ที่เลือก ตอน handleParsedRows)

let importVendorParsedRows = []; // rows after validation: { data: {vendor_code, vendor_name}, status: 'new'|'update'|'unchanged'|'error', note, rowNum, existingVendor }

const IMPORT_MODE_HINTS = {
  auto: 'รองรับไฟล์ .csv, .xlsx, .xls — ระบบจะดูคอลัมน์ในไฟล์แล้วเลือกให้เองว่าเป็นการนำเข้าแบบไหน:'
      + '<br>• ถ้าไฟล์มีคอลัมน์ <code>product_name</code> → ถือเป็นนำเข้าแบบเต็ม (รหัสใหม่ถูกเพิ่ม, รหัสเดิมถูกอัปเดตทับทุกฟิลด์ที่มีในไฟล์)'
      + '<br>• ถ้าไฟล์ไม่มีคอลัมน์ <code>product_name</code> → ถือเป็นปรับปรุงเฉพาะฟิลด์ที่มี โดย map ด้วย <code>product_code</code> (ใช้ได้เฉพาะรหัสที่มีอยู่แล้ว)'
      + '<br>คอลัมน์ที่ต้องมีเสมอ: <code>product_code</code>',
  full: 'บังคับนำเข้าแบบเต็ม — แถวแรกต้องเป็นหัวคอลัมน์:'
      + '<br><code>product_code, product_name, price, discount_step_1, discount_step_2, discount_step_3, discount_step_4, order_condition, items_vendor</code>'
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
    cols: ['product_code', 'price', 'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4', 'order_condition', 'items_vendor'],
    sample: ['SKU-001', '105.00', '95.00', '90.00', '85.00', '80.00', 'สั่งขั้นต่ำ 10 ชิ้น', 'ตัวอย่าง Vendor'],
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
      const { data, error } = await sb.from('products').insert(payload).select().single();
      if (error) {
        failedRows.push({ rowNum: row.rowNum, product_code: row.data.product_code, message: error.message });
        continue;
      }
      insertedCount++;
      await writeAuditLog('create', data, null, data);
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
  bindCtrlEnterSubmit('priceRequestForm');
  $('priceRequestModal').addEventListener('click', (e) => { if (e.target === $('priceRequestModal')) closePrModal(); });

  $('closeDeletePrModal').addEventListener('click', closeDeletePrModal);
  $('cancelDeletePr').addEventListener('click', closeDeletePrModal);
  $('confirmDeletePr').addEventListener('click', onConfirmDeletePr);
  $('deletePrModal').addEventListener('click', (e) => { if (e.target === $('deletePrModal')) closeDeletePrModal(); });

  $('priceRequestList').addEventListener('click', onPrListClick);

  bindPrRequesterCombobox();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCalendarPopover();
      closePrModal();
      closeDeletePrModal();
      closeRequesterManageModal();
      closeDeleteRequesterModal();
    }
  });
}

async function loadPriceRequests() {
  const cached = readSessionCache('maiaekhub:cache:priceRequests');
  if (cached && cached.length) {
    allPriceRequests = cached;
    priceRequestsLoaded = true;
    renderPriceRequests();
    updateInsightsBadge();
  } else {
    $('prLoadingState').style.display = 'flex';
    $('prEmptyState').hidden = true;
  }

  const { data, error } = await sb
    .from('price_requests')
    .select('*')
    .order('request_date', { ascending: false })
    .order('created_at', { ascending: false });

  $('prLoadingState').style.display = 'none';
  priceRequestsLoaded = true;

  if (error) {
    if (cached && cached.length) {
      showToast('อัปเดตข้อมูลขอราคาล่าสุดไม่สำเร็จ (แสดงข้อมูลล่าสุดที่มีอยู่ในเครื่อง)', 'error');
    } else {
      showToast('โหลดข้อมูลงานขอราคาไม่สำเร็จ: ' + error.message, 'error');
      allPriceRequests = [];
      renderPriceRequests();
      updateInsightsBadge();
    }
    return;
  }

  allPriceRequests = data || [];
  writeSessionCache('maiaekhub:cache:priceRequests', allPriceRequests);
  renderPriceRequests();
  updateInsightsBadge();
}

function updatePrTabBadge() {
  const pending = allPriceRequests.filter(r => r.status !== 'done').length;
  const label = pending > 99 ? '99+' : String(pending);
  [$('prTabBadge'), $('prTabBadgeMobile')].forEach(badge => {
    if (!badge) return;
    if (pending > 0) {
      badge.textContent = label;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  });
}

function renderPriceRequests() {
  let filtered = currentPrFilter === 'all'
    ? allPriceRequests
    : allPriceRequests.filter(r => r.status === currentPrFilter);

  if (currentPrSearch) {
    filtered = smartSearchFilter(currentPrSearch, filtered, ['details', 'requested_by', 'vendor']);
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

    const overdueHours = r.status === 'in_progress' ? hoursSince(r.status_changed_at || r.created_at) : null;
    const isOverdue = overdueHours !== null && overdueHours > OVERDUE_IN_PROGRESS_HOURS;
    if (isOverdue) card.classList.add('is-overdue-in-progress');

    card.innerHTML = `
      <div class="pr-card-titlebar">
        <span class="term-dot term-dot-red"></span>
        <span class="term-dot term-dot-yellow"></span>
        <span class="term-dot term-dot-green"></span>
        <span class="pr-card-titlebar-text">${escapeHtml(r.requested_by)}.request</span>
        ${isOverdue ? `<span class="pr-card-overdue-tag" title="สถานะ &quot;กำลังทำ&quot; ค้างมาแล้ว ${formatHoursTh(overdueHours)}">⏱ เกิน ${OVERDUE_IN_PROGRESS_HOURS} ชม.</span>` : ''}
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
        ${r.last_edited_at && r.created_at && r.last_edited_at !== r.created_at.slice(0, 10) ? `<div class="pr-card-edited">แก้ไขล่าสุด ${formatPrDate(r.last_edited_at)}</div>` : ''}
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
  const nowIso = new Date().toISOString();

  // อัปเดต UI ทันทีเพื่อความลื่นไหล แล้วค่อยยืนยันกับเซิร์ฟเวอร์ (revert ถ้าพลาด)
  const prevStatus = req.status;
  const prevStatusChangedAt = req.status_changed_at;
  req.status = nextStatus;
  req.status_changed_at = nowIso; // ใช้จับเวลาว่า "กำลังทำ" มานานแค่ไหน (แจ้งเตือนถ้าเกิน 2 ชม.)
  renderPriceRequests();
  updateInsightsBadge();

  const { error } = await sb
    .from('price_requests')
    .update({ status: nextStatus, status_changed_at: nowIso, updated_by: currentUser.id })
    .eq('id', id);

  if (error) {
    req.status = prevStatus;
    req.status_changed_at = prevStatusChangedAt;
    renderPriceRequests();
    updateInsightsBadge();
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
    // เก็บค่าตั้งต้นไว้เทียบตอนบันทึก ว่ามีการแก้ไขเนื้อหาจริงหรือไม่ (ใช้ตัดสิน stamp last_edited_at)
    prFormOriginalSnapshot = prSnapshotOf(r);
  } else {
    $('prModalTitle').textContent = 'เพิ่มงานขอราคา';
    $('priceRequestForm').reset();
    $('prId').value = '';
    $('fPrSource').value = '';
    setPrDate(todayIso());
    prFormOriginalSnapshot = null;
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

// ใช้เทียบว่าเนื้อหางานขอราคาถูกแก้ไขจริงหรือไม่ (ไม่รวม request_date/status ซึ่งมีช่องทางแก้ไขแยกของตัวเองอยู่แล้ว)
function prSnapshotOf(data) {
  return JSON.stringify([data.requested_by, data.source, data.details, data.vendor, data.notes]);
}

let prFormOriginalSnapshot = null; // snapshot เนื้อหาตอนเปิดฟอร์มแก้ไข (null = กำลังเพิ่มใหม่)

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

  // stamp วันที่แก้ไขล่าสุด เฉพาะตอนที่เนื้อหาถูกแก้ไขจริง (เทียบกับตอนเปิดฟอร์ม) หรือเป็นการเพิ่มใหม่
  const contentChanged = prFormOriginalSnapshot !== null && prFormOriginalSnapshot !== prSnapshotOf(formData);
  if (contentChanged || prFormOriginalSnapshot === null) {
    formData.last_edited_at = todayIso();
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
        .insert({ ...formData, status: 'pending', status_changed_at: new Date().toISOString(), created_by: currentUser.id, updated_by: currentUser.id })
        .select('*')
        .single();
      if (error) throw error;
      allPriceRequests.unshift(data);
      showToast('เพิ่มงานขอราคาสำเร็จ', 'success');
    }
    ensureRequesterExists(formData.requested_by); // จำชื่อผู้ขอไว้ใช้ auto-complete ครั้งถัดไป (ไม่ต้องรอผลลัพธ์)
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
// Vendor bulk import (นำเข้า Vendor Mapping หลายรายการจากไฟล์)
// ==================================================
function bindVendorImportEvents() {
  $('importVendorsBtn').addEventListener('click', openImportVendorModal);
  $('closeImportVendorModal').addEventListener('click', closeImportVendorModal);
  $('cancelImportVendor').addEventListener('click', closeImportVendorModal);
  $('importVendorModal').addEventListener('click', (e) => { if (e.target === $('importVendorModal')) closeImportVendorModal(); });

  $('downloadVendorTemplateBtn').addEventListener('click', downloadVendorImportTemplate);
  $('importVendorFileInput').addEventListener('change', onImportVendorFileSelected);
  bindVendorImportDropzone();
  $('confirmImportVendorBtn').addEventListener('click', onConfirmImportVendor);
}

function openImportVendorModal() {
  resetImportVendorModal();
  $('importVendorModal').hidden = false;
  $('importVendorModal').classList.add('is-visible');
}

function closeImportVendorModal() {
  $('importVendorModal').classList.remove('is-visible');
  $('importVendorModal').hidden = true;
  resetImportVendorModal();
}

function resetImportVendorModal() {
  importVendorParsedRows = [];
  $('importVendorFileInput').value = '';
  setFieldError($('importVendorPickError'), '');
  setFieldError($('importVendorResultError'), '');
  $('importVendorStepPick').hidden = false;
  $('importVendorStepPreview').hidden = true;
  $('confirmImportVendorBtn').hidden = true;
  $('importVendorPreviewBody').innerHTML = '';

  const zone = $('importVendorDropzone');
  const textEl = zone?.querySelector('.import-dropzone-text');
  if (zone) zone.classList.remove('has-file', 'is-dragover');
  if (textEl) textEl.innerHTML = 'ลากไฟล์มาวางตรงนี้ หรือ <span class="import-dropzone-link">คลิกเพื่อเลือกไฟล์</span>';
}

function downloadVendorImportTemplate() {
  const header = 'vendor_code,vendor_name';
  const sample = 'V00427,บริษัท ตัวอย่าง จำกัด';
  const csvContent = header + '\n' + sample + '\n';
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'maiaekhub_vendor_import_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function bindVendorImportDropzone() {
  const zone = $('importVendorDropzone');
  if (!zone) return;

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

    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      $('importVendorFileInput').files = dt.files;
    } catch {
      // Safari เก่าไม่รองรับ DataTransfer constructor — ข้ามได้ ไม่กระทบการอ่านไฟล์
    }

    showSelectedVendorFileName(file);
    processImportVendorFile(file);
  });
}

function showSelectedVendorFileName(file) {
  const zone = $('importVendorDropzone');
  const textEl = zone?.querySelector('.import-dropzone-text');
  if (!zone || !textEl) return;
  zone.classList.add('has-file');
  textEl.textContent = `เลือกไฟล์แล้ว: ${file.name}`;
}

function onImportVendorFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  showSelectedVendorFileName(file);
  processImportVendorFile(file);
}

function processImportVendorFile(file) {
  setFieldError($('importVendorPickError'), '');

  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => handleParsedVendorRows(results.data),
      error: (err) => setFieldError($('importVendorPickError'), 'อ่านไฟล์ CSV ไม่สำเร็จ: ' + err.message),
    });
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const firstSheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
        handleParsedVendorRows(rows);
      } catch (err) {
        setFieldError($('importVendorPickError'), 'อ่านไฟล์ Excel ไม่สำเร็จ: ' + err.message);
      }
    };
    reader.onerror = () => setFieldError($('importVendorPickError'), 'อ่านไฟล์ไม่สำเร็จ');
    reader.readAsArrayBuffer(file);
  } else {
    setFieldError($('importVendorPickError'), 'รองรับเฉพาะไฟล์ .csv, .xlsx, .xls เท่านั้น');
  }
}

function normalizeImportVendorRow(raw) {
  const cleanKey = cleanImportKey; // ใช้ helper เดียวกับ import สินค้า (กัน BOM + trim + lowercase)
  const map = {};
  Object.keys(raw).forEach((k) => { map[cleanKey(k)] = raw[k]; });

  const vendor_code = String(map['vendor_code'] ?? '').trim().toUpperCase();
  const vendor_name = String(map['vendor_name'] ?? '').trim();
  return { vendor_code, vendor_name };
}

function handleParsedVendorRows(rawRows) {
  if (!rawRows || rawRows.length === 0) {
    setFieldError($('importVendorPickError'), 'ไม่พบข้อมูลในไฟล์ที่เลือก');
    return;
  }
  if (rawRows.length > 1000) {
    setFieldError($('importVendorPickError'), 'ไฟล์มีข้อมูลมากเกินไป (สูงสุด 1000 แถวต่อครั้ง)');
    return;
  }

  // เทียบกับข้อมูล Vendor ที่มีอยู่แล้วในระบบ ด้วยรหัส Vendor (unique key)
  const existingByCode = new Map(allVendorMappings.map(v => [(v.vendor_code || '').toUpperCase(), v]));
  const seenInFile = new Set();

  const parsed = rawRows.map((raw, idx) => {
    const row = normalizeImportVendorRow(raw);
    const rowNum = idx + 2; // +2 เพราะแถวที่ 1 คือ header
    let status, note, existingVendor = null;

    if (!row.vendor_code || !row.vendor_name) {
      status = 'error';
      note = 'ไม่มีรหัส Vendor หรือ ชื่อ Vendor';
    } else if (seenInFile.has(row.vendor_code)) {
      status = 'error';
      note = 'รหัส Vendor นี้ซ้ำกันเองภายในไฟล์ที่อัปโหลด';
    } else if (existingByCode.has(row.vendor_code)) {
      existingVendor = existingByCode.get(row.vendor_code);
      // รหัสซ้ำ + ชื่อไม่เหมือนเดิม -> ถือเป็นอัปเดตชื่อ
      // รหัสซ้ำ + ชื่อเหมือนเดิมทุกตัวอักษร -> ไม่มีอะไรเปลี่ยน ข้าม
      if (existingVendor.vendor_name === row.vendor_name) {
        status = 'unchanged';
        note = 'มีรหัสนี้อยู่แล้ว และชื่อเหมือนเดิมทุกตัวอักษร (จะไม่แก้ไข)';
      } else {
        status = 'update';
        note = `มีรหัสนี้อยู่แล้ว — จะอัปเดตชื่อจาก "${existingVendor.vendor_name}" เป็น "${row.vendor_name}"`;
      }
    } else {
      status = 'new';
      note = 'รหัสใหม่ — จะถูกเพิ่มเป็นรายการใหม่';
    }

    if (row.vendor_code) seenInFile.add(row.vendor_code);
    return { rowNum, data: row, status, note, existingVendor };
  });

  importVendorParsedRows = parsed;
  renderImportVendorPreview();
}

function renderImportVendorPreview() {
  $('importVendorStepPick').hidden = true;
  $('importVendorStepPreview').hidden = false;

  const total = importVendorParsedRows.length;
  const newCount = importVendorParsedRows.filter(r => r.status === 'new').length;
  const updateCount = importVendorParsedRows.filter(r => r.status === 'update').length;
  const unchangedCount = importVendorParsedRows.filter(r => r.status === 'unchanged').length;
  const errorCount = importVendorParsedRows.filter(r => r.status === 'error').length;
  const okCount = newCount + updateCount;

  $('importVendorSummaryText').textContent =
    `พบทั้งหมด ${total} แถว — เพิ่มใหม่ ${newCount} รายการ, อัปเดตชื่อ ${updateCount} รายการ, ไม่มีอะไรเปลี่ยน ${unchangedCount} รายการ (จะข้าม), มีปัญหา ${errorCount} รายการ (จะข้าม)`;

  const statusLabel = { new: 'ใหม่ - จะเพิ่ม', update: 'ซ้ำ - จะอัปเดตชื่อ', unchanged: 'ซ้ำ - เหมือนเดิม', error: 'ผิดพลาด' };
  const statusClass = { new: 'success', update: 'warn', unchanged: 'warn', error: 'error' };

  const tbody = $('importVendorPreviewBody');
  tbody.innerHTML = '';
  importVendorParsedRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="import-status import-status-${statusClass[r.status]}">${statusLabel[r.status]}</span></td>
      <td>${escapeHtml(r.data.vendor_code || '(ว่าง)')}</td>
      <td>${escapeHtml(r.data.vendor_name || '(ว่าง)')}</td>
      <td>${escapeHtml(r.note || '')}</td>
    `;
    tbody.appendChild(tr);
  });

  $('confirmImportVendorBtn').hidden = okCount === 0;
}

async function onConfirmImportVendor() {
  const btn = $('confirmImportVendorBtn');
  setFieldError($('importVendorResultError'), '');

  const toInsert = importVendorParsedRows.filter(r => r.status === 'new');
  const toUpdate = importVendorParsedRows.filter(r => r.status === 'update');

  if (toInsert.length === 0 && toUpdate.length === 0) {
    setFieldError($('importVendorResultError'), 'ไม่มีแถวที่จะนำเข้า');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    let insertedCount = 0;
    let updatedCount = 0;
    const failedRows = []; // { rowNum, vendor_code, message }

    // insert/update ทีละแถว กันแถวเดียวพังแล้วล้มทั้งชุด และรู้ได้แน่ชัดว่าแถวไหนพังจริง
    for (const row of toInsert) {
      const { error } = await sb.from('vendor_mappings').insert({
        vendor_code: row.data.vendor_code,
        vendor_name: row.data.vendor_name,
        created_by: currentUser.id,
        updated_by: currentUser.id,
      });
      if (error) {
        failedRows.push({ rowNum: row.rowNum, vendor_code: row.data.vendor_code, message: error.message });
        continue;
      }
      insertedCount++;
    }

    for (const row of toUpdate) {
      const { error } = await sb
        .from('vendor_mappings')
        .update({ vendor_name: row.data.vendor_name, updated_by: currentUser.id })
        .eq('id', row.existingVendor.id);
      if (error) {
        failedRows.push({ rowNum: row.rowNum, vendor_code: row.data.vendor_code, message: error.message });
        continue;
      }
      updatedCount++;
    }

    if (failedRows.length === 0) {
      showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${insertedCount} รายการ${updatedCount ? `, อัปเดต ${updatedCount} รายการ` : ''}`, 'success');
      closeImportVendorModal();
    } else {
      const detail = failedRows
        .slice(0, 5)
        .map(f => `แถว ${f.rowNum} (${f.vendor_code || '—'}): ${f.message}`)
        .join(' | ');
      const more = failedRows.length > 5 ? ` และอีก ${failedRows.length - 5} แถว` : '';
      setFieldError($('importVendorResultError'), `สำเร็จ ${insertedCount + updatedCount} รายการ, ล้มเหลว ${failedRows.length} รายการ: ${detail}${more}`);
    }

    await loadVendorMappings();
  } catch (err) {
    setFieldError($('importVendorResultError'), err.message || 'นำเข้าไม่สำเร็จ');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// PR Requesters (ผู้ขอ) — combobox + จัดการรายชื่อ (เพิ่ม/แก้ไข/ลบ)
// ==================================================
async function loadPrRequesters() {
  const { data, error } = await sb
    .from('pr_requesters')
    .select('*')
    .order('name', { ascending: true });

  prRequestersLoaded = true;

  if (error) {
    console.error('โหลดรายชื่อผู้ขอไม่สำเร็จ:', error.message);
    allPrRequesters = [];
    return;
  }
  allPrRequesters = data || [];
}

// ถ้าชื่อที่กรอกยังไม่มีในรายชื่อผู้ขอ ให้เพิ่มให้อัตโนมัติ (จะได้ไม่ต้องพิมพ์เต็มซ้ำครั้งหน้า)
// ทำงานเงียบๆ เบื้องหลัง ไม่บล็อกการบันทึกงานขอราคาหลัก แม้จะเพิ่มไม่สำเร็จ (เช่นชื่อซ้ำ)
async function ensureRequesterExists(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;

  const exists = allPrRequesters.some(r => (r.name || '').trim().toLowerCase() === trimmed.toLowerCase());
  if (exists) return;

  try {
    const { data, error } = await sb
      .from('pr_requesters')
      .insert({ name: trimmed, created_by: currentUser.id, updated_by: currentUser.id })
      .select('*')
      .single();
    if (error) return; // ชื่อซ้ำ/error อื่น — เงียบไว้ งานขอราคาหลักบันทึกสำเร็จไปแล้ว
    allPrRequesters.push(data);
    allPrRequesters.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
  } catch (_) { /* เงียบไว้ ไม่กระทบงานหลัก */ }
}

function bindPrRequesterCombobox() {
  const input = $('fPrRequestedBy');

  input.addEventListener('input', () => {
    prRequesterHighlightIndex = -1;
    renderPrRequesterOptions(input.value.trim());
  });
  input.addEventListener('focus', () => {
    renderPrRequesterOptions(input.value.trim());
  });
  input.addEventListener('blur', () => {
    // หน่วงให้ event click/mousedown บน option ทำงานก่อน ไม่งั้น dropdown จะปิดก่อนเลือกได้
    setTimeout(closePrRequesterOptions, 150);
  });
  input.addEventListener('keydown', (e) => {
    const list = $('prRequesterOptions');
    const items = list.querySelectorAll('.combobox-option');
    if (list.hidden || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      prRequesterHighlightIndex = Math.min(prRequesterHighlightIndex + 1, items.length - 1);
      updatePrRequesterHighlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      prRequesterHighlightIndex = Math.max(prRequesterHighlightIndex - 1, 0);
      updatePrRequesterHighlight(items);
    } else if (e.key === 'Enter' && prRequesterHighlightIndex >= 0) {
      if (e.ctrlKey || e.metaKey) return; // ปล่อยให้ Ctrl/Cmd+Enter ไหลไปบันทึกฟอร์ม ไม่ใช่เลือก option
      e.preventDefault();
      selectPrRequester(items[prRequesterHighlightIndex].dataset.name);
    } else if (e.key === 'Escape') {
      closePrRequesterOptions();
    }
  });

  $('manageRequestersBtn').addEventListener('click', openRequesterManageModal);
  $('closeRequesterManageModal').addEventListener('click', closeRequesterManageModal);
  $('requesterManageModal').addEventListener('click', (e) => { if (e.target === $('requesterManageModal')) closeRequesterManageModal(); });
  $('requesterAddForm').addEventListener('submit', onAddRequester);
  $('requesterManageList').addEventListener('click', onRequesterListClick);

  $('closeDeleteRequesterModal').addEventListener('click', closeDeleteRequesterModal);
  $('cancelDeleteRequester').addEventListener('click', closeDeleteRequesterModal);
  $('confirmDeleteRequester').addEventListener('click', onConfirmDeleteRequester);
  $('deleteRequesterModal').addEventListener('click', (e) => { if (e.target === $('deleteRequesterModal')) closeDeleteRequesterModal(); });
}

function renderPrRequesterOptions(query) {
  const list = $('prRequesterOptions');
  const q = query.toLowerCase();
  // จับคู่แบบ "มีคำนี้อยู่ตรงไหนก็ได้ในชื่อ" เช่นพิมพ์ "ตาล" หรือ "พี่ต" ก็เจอ "พี่ตาล"
  const matches = q
    ? allPrRequesters.filter(r => (r.name || '').toLowerCase().includes(q))
    : allPrRequesters.slice(0, 20); // ยังไม่พิมพ์อะไร โชว์รายชื่อทั้งหมด (จำกัด 20 แถวแรกกันยาวเกิน)

  if (matches.length === 0) {
    list.innerHTML = `<li class="combobox-option-empty">${q ? 'ไม่พบชื่อนี้ในรายชื่อ — พิมพ์ต่อแล้วบันทึกได้เลย ระบบจะเพิ่มให้อัตโนมัติ' : 'ยังไม่มีรายชื่อผู้ขอ'}</li>`;
    list.hidden = false;
    $('fPrRequestedBy').setAttribute('aria-expanded', 'true');
    return;
  }

  list.innerHTML = matches.map(r => `<li class="combobox-option" role="option" data-name="${escapeHtml(r.name)}">${escapeHtml(r.name)}</li>`).join('');
  list.hidden = false;
  $('fPrRequestedBy').setAttribute('aria-expanded', 'true');

  list.querySelectorAll('.combobox-option').forEach(li => {
    li.addEventListener('mousedown', (e) => {
      e.preventDefault(); // กัน input blur ก่อน click จะได้ select ทัน
      selectPrRequester(li.dataset.name);
    });
  });
}

function updatePrRequesterHighlight(items) {
  items.forEach((li, i) => li.classList.toggle('is-highlighted', i === prRequesterHighlightIndex));
  const active = items[prRequesterHighlightIndex];
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function selectPrRequester(name) {
  $('fPrRequestedBy').value = name;
  closePrRequesterOptions();
  $('fPrRequestedBy').focus();
}

function closePrRequesterOptions() {
  $('prRequesterOptions').hidden = true;
  $('fPrRequestedBy').setAttribute('aria-expanded', 'false');
  prRequesterHighlightIndex = -1;
}

// ---- Manage requesters modal (เพิ่ม/แก้ไข/ลบ) ----
function openRequesterManageModal() {
  setFieldError($('requesterManageError'), '');
  $('newRequesterName').value = '';
  editingRequesterId = null;
  renderRequesterManageList();
  $('requesterManageModal').hidden = false;
  $('requesterManageModal').classList.add('is-visible');
  $('newRequesterName').focus();
}

function closeRequesterManageModal() {
  $('requesterManageModal').classList.remove('is-visible');
  $('requesterManageModal').hidden = true;
  editingRequesterId = null;
}

function renderRequesterManageList() {
  const list = $('requesterManageList');

  if (allPrRequesters.length === 0) {
    list.innerHTML = '';
    $('requesterManageEmpty').hidden = false;
    return;
  }
  $('requesterManageEmpty').hidden = true;

  list.innerHTML = allPrRequesters.map(r => {
    if (r.id === editingRequesterId) {
      return `
        <li class="requester-row" data-id="${r.id}">
          <input type="text" class="requester-edit-input" value="${escapeHtml(r.name)}" autocomplete="off">
          <div class="requester-row-actions">
            <button type="button" class="icon-btn" data-action="save-edit" title="บันทึก" aria-label="บันทึกชื่อ">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
            </button>
            <button type="button" class="icon-btn" data-action="cancel-edit" title="ยกเลิก" aria-label="ยกเลิกแก้ไข">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </li>`;
    }
    return `
      <li class="requester-row" data-id="${r.id}">
        <span class="requester-row-name">${escapeHtml(r.name)}</span>
        <div class="requester-row-actions">
          <button type="button" class="icon-btn" data-action="edit" title="แก้ไข" aria-label="แก้ไขชื่อ ${escapeHtml(r.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button type="button" class="icon-btn icon-btn-danger" data-action="delete" title="ลบ" aria-label="ลบผู้ขอ ${escapeHtml(r.name)}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6"/></svg>
          </button>
        </div>
      </li>`;
  }).join('');
}

async function onAddRequester(e) {
  e.preventDefault();
  const errorEl = $('requesterManageError');
  setFieldError(errorEl, '');

  const name = $('newRequesterName').value.trim();
  if (!name) {
    setFieldError(errorEl, 'กรุณากรอกชื่อผู้ขอ');
    return;
  }
  if (allPrRequesters.some(r => (r.name || '').trim().toLowerCase() === name.toLowerCase())) {
    setFieldError(errorEl, 'มีชื่อนี้อยู่แล้วในรายชื่อ');
    return;
  }

  try {
    const { data, error } = await sb
      .from('pr_requesters')
      .insert({ name, created_by: currentUser.id, updated_by: currentUser.id })
      .select('*')
      .single();
    if (error) throw error;

    allPrRequesters.push(data);
    allPrRequesters.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
    $('newRequesterName').value = '';
    renderRequesterManageList();
    showToast('เพิ่มผู้ขอสำเร็จ', 'success');
  } catch (err) {
    setFieldError(errorEl, err.message?.includes('duplicate') || err.code === '23505'
      ? 'มีชื่อนี้อยู่แล้วในรายชื่อ'
      : (err.message || 'เพิ่มไม่สำเร็จ'));
  }
}

function onRequesterListClick(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const row = btn.closest('.requester-row');
  const id = row?.dataset.id;
  if (!id) return;

  const action = btn.dataset.action;
  if (action === 'edit') {
    editingRequesterId = id;
    renderRequesterManageList();
    document.querySelector(`.requester-row[data-id="${id}"] .requester-edit-input`)?.focus();
  } else if (action === 'cancel-edit') {
    editingRequesterId = null;
    renderRequesterManageList();
  } else if (action === 'save-edit') {
    const input = row.querySelector('.requester-edit-input');
    onSaveRequesterEdit(id, input.value.trim());
  } else if (action === 'delete') {
    openDeleteRequesterModal(id);
  }
}

async function onSaveRequesterEdit(id, newName) {
  const errorEl = $('requesterManageError');
  setFieldError(errorEl, '');

  if (!newName) {
    setFieldError(errorEl, 'กรุณากรอกชื่อผู้ขอ');
    return;
  }
  if (allPrRequesters.some(r => r.id !== id && (r.name || '').trim().toLowerCase() === newName.toLowerCase())) {
    setFieldError(errorEl, 'มีชื่อนี้อยู่แล้วในรายชื่อ');
    return;
  }

  try {
    const { data, error } = await sb
      .from('pr_requesters')
      .update({ name: newName, updated_by: currentUser.id })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    const idx = allPrRequesters.findIndex(r => r.id === id);
    if (idx !== -1) allPrRequesters[idx] = data;
    allPrRequesters.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th'));
    editingRequesterId = null;
    renderRequesterManageList();
    showToast('บันทึกการแก้ไขสำเร็จ', 'success');
  } catch (err) {
    setFieldError(errorEl, err.message?.includes('duplicate') || err.code === '23505'
      ? 'มีชื่อนี้อยู่แล้วในรายชื่อ'
      : (err.message || 'บันทึกไม่สำเร็จ'));
  }
}

function openDeleteRequesterModal(id) {
  const r = allPrRequesters.find(x => x.id === id);
  if (!r) return;
  pendingDeleteRequester = r;
  $('deleteRequesterModalText').innerHTML = `ต้องการลบผู้ขอ <strong>${escapeHtml(r.name)}</strong> ออกจากรายชื่อใช่หรือไม่? (งานขอราคาที่เคยบันทึกไว้จะไม่ถูกลบหรือแก้ไข)`;
  $('deleteRequesterModal').hidden = false;
  $('deleteRequesterModal').classList.add('is-visible');
}

function closeDeleteRequesterModal() {
  $('deleteRequesterModal').classList.remove('is-visible');
  $('deleteRequesterModal').hidden = true;
  pendingDeleteRequester = null;
}

async function onConfirmDeleteRequester() {
  if (!pendingDeleteRequester) return;
  const btn = $('confirmDeleteRequester');
  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    const r = pendingDeleteRequester;
    const { error } = await sb.from('pr_requesters').delete().eq('id', r.id);
    if (error) throw error;

    allPrRequesters = allPrRequesters.filter(x => x.id !== r.id);
    showToast('ลบผู้ขอสำเร็จ', 'success');
    closeDeleteRequesterModal();
    renderRequesterManageList();
  } catch (err) {
    showToast('ลบไม่สำเร็จ: ' + (err.message || 'เกิดข้อผิดพลาด'), 'error');
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

// ==================================================
// Insights (แจ้งเตือน & สรุปข้อมูล) — ฟรี ไม่มีการเรียก API ภายนอกเพิ่ม คำนวณจากข้อมูลที่โหลดอยู่แล้ว
// ==================================================
const STALE_PRICE_DAYS = 90;   // ราคาไม่อัปเดตเกินกี่วันถึงนับว่า "ค้าง"
const STALE_PR_DAYS = 14;      // งานขอราคาที่ยังไม่เสร็จ ค้างเกินกี่วันถึงนับว่า "ค้าง"
const OVERDUE_IN_PROGRESS_HOURS = 2; // งานที่สถานะ "กำลังทำ" นานเกินกี่ชั่วโมงถึงนับว่า "เกินกำหนด" ต้องแจ้งเตือน

function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  const now = new Date(todayIso() + 'T00:00:00');
  if (Number.isNaN(then.getTime())) return null;
  return Math.round((now - then) / (1000 * 60 * 60 * 24));
}

// ต่างจาก daysSince ตรงที่รับ timestamp เต็ม (มีเวลา) แล้วคืนเป็นจำนวน "ชั่วโมง" ที่ผ่านมา — ใช้กับงานที่ต้องจับเวลาละเอียดระดับชั่วโมง เช่นสถานะ "กำลังทำ"
function hoursSince(isoDateTimeStr) {
  if (!isoDateTimeStr) return null;
  const then = new Date(isoDateTimeStr);
  if (Number.isNaN(then.getTime())) return null;
  return (Date.now() - then.getTime()) / (1000 * 60 * 60);
}

function getStaleProducts() {
  return allProducts
    .map(p => ({ p, days: daysSince(p.price_updated_at) }))
    .filter(x => x.days !== null && x.days > STALE_PRICE_DAYS)
    .sort((a, b) => b.days - a.days);
}

function getStalePriceRequests() {
  return allPriceRequests
    .map(r => ({ r, days: daysSince(r.request_date) }))
    .filter(x => x.r.status !== 'done' && x.days !== null && x.days > STALE_PR_DAYS)
    .sort((a, b) => b.days - a.days);
}

// งานขอราคาที่สถานะ "กำลังทำ" ค้างนานเกิน OVERDUE_IN_PROGRESS_HOURS ชม. แล้วยังไม่เสร็จ
// (ถ้าแถวเก่าที่ยังไม่มี status_changed_at ในฐานข้อมูล จะ fallback ไปใช้ created_at แทนแบบประมาณการ)
function getOverdueInProgressPr() {
  return allPriceRequests
    .filter(r => r.status === 'in_progress')
    .map(r => ({ r, hours: hoursSince(r.status_changed_at || r.created_at) }))
    .filter(x => x.hours !== null && x.hours > OVERDUE_IN_PROGRESS_HOURS)
    .sort((a, b) => b.hours - a.hours);
}

// แจ้งเตือนแบบ toast ครั้งเดียวต่องาน เมื่อเพิ่งข้ามเกณฑ์ "เกิน 2 ชม." (กันเตือนซ้ำทุกรอบที่เช็ค)
let notifiedOverdueInProgressIds = new Set();
function checkOverdueInProgressNotifications() {
  const overdue = getOverdueInProgressPr();
  overdue.forEach(({ r }) => {
    if (!notifiedOverdueInProgressIds.has(r.id)) {
      notifiedOverdueInProgressIds.add(r.id);
      showToast(`งานขอราคา "${r.details}" (${r.requested_by}) สถานะ "กำลังทำ" นานเกิน ${OVERDUE_IN_PROGRESS_HOURS} ชม.แล้ว`, 'error');
    }
  });
  // เอา id ที่ไม่ overdue แล้วออกจาก set (เผื่อสถานะเปลี่ยนแล้วกลับมาเป็น "กำลังทำ" ใหม่ในอนาคต จะเตือนซ้ำได้ถูกต้อง)
  const overdueIds = new Set(overdue.map(x => x.r.id));
  Array.from(notifiedOverdueInProgressIds).forEach(id => {
    if (!overdueIds.has(id)) notifiedOverdueInProgressIds.delete(id);
  });
}

// เช็คงานค้างเป็นระยะๆ ระหว่างเปิดแอปทิ้งไว้ (ไม่ต้องรีโหลดหน้าก็เจอแจ้งเตือนได้ตรงเวลา)
const INSIGHTS_POLL_INTERVAL_MS = 2 * 60 * 1000; // เช็คทุก 2 นาที
let insightsPollTimer = null;
function startInsightsPolling() {
  stopInsightsPolling();
  insightsPollTimer = setInterval(() => {
    if (!priceRequestsLoaded) return;
    updateInsightsBadge();
    checkOverdueInProgressNotifications();
    // ถ้ากำลังเปิดหน้า "ขอราคา" อยู่ รีเฟรชการ์ดเพื่อให้แท็ก/พัลส์ "เกิน 2 ชม." ตรงเวลาจริงโดยไม่ต้องรอ action อื่น
    if ($('priceRequestsView') && !$('priceRequestsView').hidden) renderPriceRequests();
  }, INSIGHTS_POLL_INTERVAL_MS);
}
function stopInsightsPolling() {
  clearInterval(insightsPollTimer);
  insightsPollTimer = null;
  notifiedOverdueInProgressIds.clear();
}

function updateInsightsBadge() {
  const badge = $('insightsBadge');
  if (!badge) return;
  const count = getStaleProducts().length + getStalePriceRequests().length + getOverdueInProgressPr().length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function bindInsights() {
  $('insightsBtn').addEventListener('click', openInsightsModal);
  $('closeInsightsModal').addEventListener('click', closeInsightsModal);
  $('insightsModal').addEventListener('click', (e) => { if (e.target === $('insightsModal')) closeInsightsModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeInsightsModal(); });
}

function openInsightsModal() {
  const staleProducts = getStaleProducts();
  const stalePr = getStalePriceRequests();
  const overdueInProgress = getOverdueInProgressPr();
  const pendingPr = allPriceRequests.filter(r => r.status !== 'done').length;

  $('insightsSummary').innerHTML = `
    <div class="insights-summary-card">
      <div class="insights-summary-value">${allProducts.length.toLocaleString('th-TH')}</div>
      <div class="insights-summary-label">สินค้าทั้งหมด</div>
    </div>
    <div class="insights-summary-card${staleProducts.length ? ' is-alert' : ''}">
      <div class="insights-summary-value">${staleProducts.length}</div>
      <div class="insights-summary-label">ราคาค้างเกิน ${STALE_PRICE_DAYS} วัน</div>
    </div>
    <div class="insights-summary-card">
      <div class="insights-summary-value">${pendingPr}</div>
      <div class="insights-summary-label">งานขอราคาที่ยังไม่เสร็จ</div>
    </div>
    <div class="insights-summary-card${stalePr.length ? ' is-alert' : ''}">
      <div class="insights-summary-value">${stalePr.length}</div>
      <div class="insights-summary-label">ขอราคาค้างเกิน ${STALE_PR_DAYS} วัน</div>
    </div>
    <div class="insights-summary-card${overdueInProgress.length ? ' is-alert' : ''}">
      <div class="insights-summary-value">${overdueInProgress.length}</div>
      <div class="insights-summary-label">กำลังทำเกิน ${OVERDUE_IN_PROGRESS_HOURS} ชม.</div>
    </div>
  `;

  const staleProductsEl = $('insightsStaleProducts');
  if (staleProducts.length === 0) {
    staleProductsEl.innerHTML = '';
    $('insightsStaleProductsEmpty').hidden = false;
  } else {
    $('insightsStaleProductsEmpty').hidden = true;
    staleProductsEl.innerHTML = staleProducts.slice(0, 50).map(({ p, days }) => `
      <div class="insights-row" data-action="open-product" data-id="${p.id}">
        <div class="insights-row-main">
          <div class="insights-row-title">${escapeHtml(p.product_name)}</div>
          <div class="insights-row-sub">${escapeHtml(p.product_code)} · อัปเดตล่าสุด ${formatPrDate(p.price_updated_at)}</div>
        </div>
        <span class="insights-row-days">${days} วัน</span>
      </div>
    `).join('');
  }

  const stalePrEl = $('insightsStalePr');
  if (stalePr.length === 0) {
    stalePrEl.innerHTML = '';
    $('insightsStalePrEmpty').hidden = false;
  } else {
    $('insightsStalePrEmpty').hidden = true;
    stalePrEl.innerHTML = stalePr.slice(0, 50).map(({ r, days }) => `
      <div class="insights-row" data-action="open-pr" data-id="${r.id}">
        <div class="insights-row-main">
          <div class="insights-row-title">${escapeHtml(r.details)}</div>
          <div class="insights-row-sub">ผู้ขอ ${escapeHtml(r.requested_by)} · ${escapeHtml(PR_STATUS_LABEL[r.status] || r.status)} · ${formatPrDate(r.request_date)}</div>
        </div>
        <span class="insights-row-days">${days} วัน</span>
      </div>
    `).join('');
  }

  const overdueInProgressEl = $('insightsOverdueInProgress');
  if (overdueInProgress.length === 0) {
    overdueInProgressEl.innerHTML = '';
    $('insightsOverdueInProgressEmpty').hidden = false;
  } else {
    $('insightsOverdueInProgressEmpty').hidden = true;
    overdueInProgressEl.innerHTML = overdueInProgress.slice(0, 50).map(({ r, hours }) => `
      <div class="insights-row" data-action="open-pr" data-id="${r.id}">
        <div class="insights-row-main">
          <div class="insights-row-title">${escapeHtml(r.details)}</div>
          <div class="insights-row-sub">ผู้ขอ ${escapeHtml(r.requested_by)} · กำลังทำมา ${formatHoursTh(hours)}</div>
        </div>
        <span class="insights-row-days">${formatHoursTh(hours)}</span>
      </div>
    `).join('');
  }

  staleProductsEl.querySelectorAll('.insights-row').forEach(row => {
    row.addEventListener('click', () => {
      closeInsightsModal();
      switchView('products');
      openProductModal(row.dataset.id);
    });
  });
  stalePrEl.querySelectorAll('.insights-row').forEach(row => {
    row.addEventListener('click', () => {
      closeInsightsModal();
      switchView('priceRequests');
      openPrModal(row.dataset.id);
    });
  });
  overdueInProgressEl.querySelectorAll('.insights-row').forEach(row => {
    row.addEventListener('click', () => {
      closeInsightsModal();
      switchView('priceRequests');
      openPrModal(row.dataset.id);
    });
  });

  $('insightsModal').hidden = false;
  $('insightsModal').classList.add('is-visible');
}

// จำนวนชั่วโมง (ทศนิยม) -> ข้อความอ่านง่ายแบบไทย เช่น 2.4 -> "2 ชม. 24 นาที"
function formatHoursTh(hours) {
  if (hours == null || Number.isNaN(hours)) return '';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} นาที`;
  return m > 0 ? `${h} ชม. ${m} นาที` : `${h} ชม.`;
}

function closeInsightsModal() {
  $('insightsModal').classList.remove('is-visible');
  $('insightsModal').hidden = true;
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
