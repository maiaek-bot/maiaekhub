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
let pendingDeleteProduct = null;

let allPriceRequests = [];       // cached price request list
let priceRequestsLoaded = false; // lazy-load: fetch only when tab first opened
let editingPrId = null;          // null = adding new, string = editing existing
let pendingDeletePr = null;
let currentPrFilter = 'all';     // 'all' | 'pending' | 'in_progress' | 'done'
let selectedPrSource = null;     // 'personal_chat' | 'group_chat' | 'cs_group'

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);

const authScreen = $('authScreen');
const appScreen = $('appScreen');
const toastEl = $('toast');

// ==================================================
// Init
// ==================================================
document.addEventListener('DOMContentLoaded', init);

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
  $('searchInput').addEventListener('input', debounce(renderProducts, 150));
  $('addProductBtn').addEventListener('click', () => openProductModal(null));
  $('historyBtn').addEventListener('click', openHistoryModal);
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
  document.querySelectorAll('.view-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(tab => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  $('productsView').hidden = view !== 'products';
  $('priceRequestsView').hidden = view !== 'priceRequests';

  if (view === 'priceRequests' && !priceRequestsLoaded) {
    loadPriceRequests();
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

function renderProducts() {
  const query = $('searchInput').value.trim().toLowerCase();
  const filtered = query
    ? allProducts.filter(p =>
        (p.product_name || '').toLowerCase().includes(query) ||
        (p.product_code || '').toLowerCase().includes(query))
    : allProducts;

  const tbody = $('productTableBody');
  tbody.innerHTML = '';

  if (filtered.length === 0) {
    $('emptyState').hidden = false;
    $('emptyStateText').textContent = query
      ? `ไม่พบสินค้าที่ตรงกับ "${query}"`
      : 'ยังไม่มีข้อมูลสินค้า — เริ่มเพิ่มสินค้าแรกของคุณ';
    return;
  }
  $('emptyState').hidden = true;

  const canDel = canDelete();

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="product-code">${escapeHtml(p.product_code)}</td>
      <td class="product-name">
        <span class="product-name-text">${escapeHtml(p.product_name)}</span>
        <button class="copy-btn" data-action="copy" data-id="${p.id}" title="คัดลอกรหัส + ชื่อสินค้า" aria-label="คัดลอกรหัสและชื่อสินค้า ${escapeHtml(p.product_name)}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </td>
      <td class="num">${formatMoney(p.price)}</td>
      <td class="num">${p.discount_step_1 != null ? formatMoney(p.discount_step_1) : '<span class="cell-empty">—</span>'}</td>
      <td class="num">${p.discount_step_2 != null ? formatMoney(p.discount_step_2) : '<span class="cell-empty">—</span>'}</td>
      <td class="num">${p.discount_step_3 != null ? formatMoney(p.discount_step_3) : '<span class="cell-empty">—</span>'}</td>
      <td class="num">${p.discount_step_4 != null ? formatMoney(p.discount_step_4) : '<span class="cell-empty">—</span>'}</td>
      <td class="order-condition">${p.order_condition ? escapeHtml(p.order_condition) : '<span class="cell-empty">—</span>'}</td>
      <td class="actions-col">
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
    $('fPrice').value = p.price ?? '';
    $('fStep1').value = p.discount_step_1 ?? '';
    $('fStep2').value = p.discount_step_2 ?? '';
    $('fStep3').value = p.discount_step_3 ?? '';
    $('fStep4').value = p.discount_step_4 ?? '';
    $('fCondition').value = p.order_condition || '';
  } else {
    $('productModalTitle').textContent = 'เพิ่มสินค้าใหม่';
    $('productForm').reset();
    $('productId').value = '';
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

function readProductForm() {
  return {
    product_code: $('fProductCode').value.trim(),
    product_name: $('fProductName').value.trim(),
    price: parseFloat($('fPrice').value) || 0,
    discount_step_1: $('fStep1').value === '' ? null : parseFloat($('fStep1').value),
    discount_step_2: $('fStep2').value === '' ? null : parseFloat($('fStep2').value),
    discount_step_3: $('fStep3').value === '' ? null : parseFloat($('fStep3').value),
    discount_step_4: $('fStep4').value === '' ? null : parseFloat($('fStep4').value),
    order_condition: $('fCondition').value.trim() || null,
  };
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

  try {
    const p = pendingDeleteProduct;
    const { error } = await sb.from('products').delete().eq('id', p.id);
    if (error) throw error;

    await writeAuditLog('delete', p, p, null);
    showToast('ลบสินค้าสำเร็จ', 'success');
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
    product_code: 'รหัสสินค้า', product_name: 'ชื่อสินค้า', price: 'ราคา',
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
  'product_code', 'product_name', 'price',
  'discount_step_1', 'discount_step_2', 'discount_step_3', 'discount_step_4',
  'order_condition'
];
const IMPORT_TEMPLATE_HEADER = IMPORT_COLUMNS.join(',');
const IMPORT_TEMPLATE_SAMPLE = 'SKU-001,ตัวอย่างสินค้า,100.00,90.00,85.00,80.00,75.00,สั่งขั้นต่ำ 10 ชิ้น';

let importParsedRows = []; // rows after validation: { data, status: 'new'|'update'|'error', note }

function bindImportEvents() {
  $('importProductsBtn').addEventListener('click', openImportModal);
  $('closeImportModal').addEventListener('click', closeImportModal);
  $('cancelImport').addEventListener('click', closeImportModal);
  $('importModal').addEventListener('click', (e) => { if (e.target === $('importModal')) closeImportModal(); });

  $('downloadTemplateBtn').addEventListener('click', downloadImportTemplate);
  $('importFileInput').addEventListener('change', onImportFileSelected);
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
  $('importDuplicateMode').value = 'skip';
}

function downloadImportTemplate() {
  const csvContent = IMPORT_TEMPLATE_HEADER + '\n' + IMPORT_TEMPLATE_SAMPLE + '\n';
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'maiaekhub_import_template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function onImportFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
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

function normalizeImportRow(raw) {
  // รองรับ header ที่มีช่องว่าง/ตัวพิมพ์ใหญ่เล็กต่างกันเล็กน้อย
  const get = (key) => {
    const foundKey = Object.keys(raw).find(k => k.trim().toLowerCase() === key);
    return foundKey !== undefined ? String(raw[foundKey] ?? '').trim() : '';
  };

  const toNum = (v) => {
    if (v === '' || v == null) return null;
    const n = parseFloat(String(v).replace(/,/g, ''));
    return isNaN(n) ? undefined : n; // undefined = ค่าที่ parse ไม่ได้ (invalid)
  };

  const priceRaw = toNum(get('price'));

  return {
    product_code: get('product_code'),
    product_name: get('product_name'),
    price: priceRaw,
    discount_step_1: toNum(get('discount_step_1')),
    discount_step_2: toNum(get('discount_step_2')),
    discount_step_3: toNum(get('discount_step_3')),
    discount_step_4: toNum(get('discount_step_4')),
    order_condition: get('order_condition') || null,
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

  // ดึงรหัสสินค้าที่มีอยู่แล้วในระบบ เพื่อตรวจสอบรายการซ้ำ
  const existingCodes = new Set(allProducts.map(p => p.product_code));
  const seenInFile = new Set();

  const parsed = rawRows.map((raw, idx) => {
    const row = normalizeImportRow(raw);
    const rowNum = idx + 2; // +2 เพราะแถวที่ 1 คือ header
    let status = 'new';
    let note = '';

    if (!row.product_code || !row.product_name) {
      status = 'error';
      note = 'ไม่มีรหัสสินค้า หรือ ชื่อสินค้า';
    } else if (row.price === undefined || row.price === null) {
      status = 'error';
      note = row.price === undefined ? 'ราคาไม่ใช่ตัวเลข' : 'ไม่มีราคา';
    } else if ([row.discount_step_1, row.discount_step_2, row.discount_step_3, row.discount_step_4].some(v => v === undefined)) {
      status = 'error';
      note = 'สเต็ปส่วนลดมีค่าที่ไม่ใช่ตัวเลข';
    } else if (seenInFile.has(row.product_code)) {
      status = 'error';
      note = 'รหัสสินค้าซ้ำกันภายในไฟล์เดียวกัน';
    } else if (existingCodes.has(row.product_code)) {
      status = 'duplicate';
      note = 'มีรหัสนี้อยู่แล้วในระบบ';
    }

    if (row.product_code) seenInFile.add(row.product_code);

    return { rowNum, data: row, status, note };
  });

  importParsedRows = parsed;
  renderImportPreview();
}

function renderImportPreview() {
  $('importStepPick').hidden = true;
  $('importStepPreview').hidden = false;

  const total = importParsedRows.length;
  const errorCount = importParsedRows.filter(r => r.status === 'error').length;
  const dupCount = importParsedRows.filter(r => r.status === 'duplicate').length;
  const okCount = total - errorCount;

  $('importSummaryText').textContent =
    `พบทั้งหมด ${total} แถว — นำเข้าได้ ${okCount} แถว (ซ้ำกับของเดิม ${dupCount} แถว), มีปัญหา ${errorCount} แถว (จะถูกข้าม)`;

  const statusLabel = { new: 'ใหม่', duplicate: 'ซ้ำ', error: 'ผิดพลาด' };
  const statusClass = { new: 'success', duplicate: 'warn', error: 'error' };

  const tbody = $('importPreviewBody');
  tbody.innerHTML = '';
  importParsedRows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="import-status import-status-${statusClass[r.status]}">${statusLabel[r.status]}</span></td>
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
  const duplicateMode = $('importDuplicateMode').value; // 'skip' | 'update'
  setFieldError($('importResultError'), '');

  const toInsert = importParsedRows
    .filter(r => r.status === 'new')
    .map(r => ({ ...r.data, created_by: currentUser.id, updated_by: currentUser.id }));

  const toUpdate = duplicateMode === 'update'
    ? importParsedRows.filter(r => r.status === 'duplicate').map(r => ({ ...r.data, updated_by: currentUser.id }))
    : [];

  if (toInsert.length === 0 && toUpdate.length === 0) {
    setFieldError($('importResultError'), 'ไม่มีแถวที่จะนำเข้า');
    return;
  }

  btn.classList.add('is-loading');
  btn.disabled = true;

  try {
    let insertedCount = 0;
    let updatedCount = 0;

    if (toInsert.length > 0) {
      // bulk insert ทีเดียว แบ่งเป็นชุดละ 500 แถว เผื่อไฟล์ใหญ่
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        const chunk = toInsert.slice(i, i + chunkSize);
        const { error } = await sb.from('products').insert(chunk);
        if (error) throw error;
        insertedCount += chunk.length;
      }
    }

    if (toUpdate.length > 0) {
      // update ต้องทำทีละแถว เพราะแต่ละแถวมีเงื่อนไข product_code ต่างกัน
      for (const row of toUpdate) {
        const { error } = await sb
          .from('products')
          .update(row)
          .eq('product_code', row.product_code);
        if (error) throw error;
        updatedCount++;
      }
    }

    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${insertedCount} รายการ${updatedCount ? `, อัปเดต ${updatedCount} รายการ` : ''}`, 'success');
    closeImportModal();
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
const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB
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
    setFieldError(errorEl, 'ไฟล์ใหญ่เกินไป (สูงสุด 2MB)');
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
let calViewYear = null;   // ปีที่ปฏิทินกำลังแสดง (ค.ศ.)
let calViewMonth = null;  // เดือนที่ปฏิทินกำลังแสดง (0-11)

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function setPrDate(isoDate) {
  $('fPrDate').value = isoDate;
  $('fPrDateLabel').textContent = formatPrDate(isoDate);
  const [y, m] = isoDate.split('-').map(Number);
  calViewYear = y;
  calViewMonth = m - 1;
  renderCalendar();
}

function toggleCalendarPopover() {
  const popover = $('prCalendarPopover');
  if (popover.hidden) {
    openCalendarPopover();
  } else {
    closeCalendarPopover();
  }
}

function openCalendarPopover() {
  const current = $('fPrDate').value || todayIso();
  const [y, m] = current.split('-').map(Number);
  calViewYear = y;
  calViewMonth = m - 1;
  renderCalendar();
  $('prCalendarPopover').hidden = false;
  $('fPrDateTrigger').classList.add('is-open');
  $('fPrDateTrigger').setAttribute('aria-expanded', 'true');
}

function closeCalendarPopover() {
  $('prCalendarPopover').hidden = true;
  $('fPrDateTrigger').classList.remove('is-open');
  $('fPrDateTrigger').setAttribute('aria-expanded', 'false');
}

function shiftCalendarMonth(delta) {
  calViewMonth += delta;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderCalendar();
}

function renderCalendar() {
  $('calMonthLabel').textContent = `${CAL_MONTH_NAMES_TH[calViewMonth]} ${calViewYear + 543}`;

  const calEl = $('calendar');
  calEl.innerHTML = '';

  const headerFrag = document.createDocumentFragment();
  CAL_DAY_HEADERS.forEach(d => {
    const li = document.createElement('li');
    li.className = 'day';
    li.textContent = d;
    headerFrag.appendChild(li);
  });
  calEl.appendChild(headerFrag);

  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  // แปลง getDay() (0=อาทิตย์) ให้เริ่มสัปดาห์ที่จันทร์ (0=จันทร์ ... 6=อาทิตย์)
  const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calViewYear, calViewMonth, 0).getDate();

  const selectedIso = $('fPrDate').value;
  const todayIsoStr = todayIso();
  const bodyFrag = document.createDocumentFragment();

  // วันจากเดือนก่อนหน้า (แสดงจางๆ ให้ grid เต็มแถว)
  for (let i = leadingBlanks - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    bodyFrag.appendChild(buildCalendarDay(dayNum, calViewMonth - 1, true, selectedIso, todayIsoStr));
  }
  // วันในเดือนนี้
  for (let d = 1; d <= daysInMonth; d++) {
    bodyFrag.appendChild(buildCalendarDay(d, calViewMonth, false, selectedIso, todayIsoStr));
  }
  // วันจากเดือนถัดไป (เติมให้ครบแถวสุดท้าย)
  const totalCells = leadingBlanks + daysInMonth;
  const trailingBlanks = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= trailingBlanks; d++) {
    bodyFrag.appendChild(buildCalendarDay(d, calViewMonth + 1, true, selectedIso, todayIsoStr));
  }

  calEl.appendChild(bodyFrag);
}

function buildCalendarDay(dayNum, monthIndex, isOutside, selectedIso, todayIsoStr) {
  // จัดการ monthIndex ที่ล้นขอบ (-1 หรือ 12) ให้คำนวณปี/เดือนจริงถูกต้อง
  const realDate = new Date(calViewYear, monthIndex, dayNum);
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
    setPrDate(iso);
    closeCalendarPopover();
  });

  li.appendChild(btn);
  return li;
}

function bindPriceRequestEvents() {
  $('addPriceRequestBtn').addEventListener('click', () => openPrModal(null));

  $('fPrDateTrigger').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCalendarPopover();
  });
  $('calPrevMonth').addEventListener('click', () => shiftCalendarMonth(-1));
  $('calNextMonth').addEventListener('click', () => shiftCalendarMonth(1));
  $('calTodayBtn').addEventListener('click', () => {
    setPrDate(todayIso());
    closeCalendarPopover();
  });
  document.addEventListener('click', (e) => {
    const popover = $('prCalendarPopover');
    if (!popover.hidden && !popover.contains(e.target) && e.target !== $('fPrDateTrigger') && !$('fPrDateTrigger').contains(e.target)) {
      closeCalendarPopover();
    }
  });

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
  const filtered = currentPrFilter === 'all'
    ? allPriceRequests
    : allPriceRequests.filter(r => r.status === currentPrFilter);

  const list = $('priceRequestList');
  list.innerHTML = '';

  updatePrTabBadge();

  if (filtered.length === 0) {
    $('prEmptyState').hidden = false;
    $('prEmptyStateText').textContent = currentPrFilter === 'all'
      ? 'ยังไม่มีงานขอราคา — เริ่มเพิ่มงานแรก'
      : `ไม่มีงานสถานะ "${PR_STATUS_LABEL[currentPrFilter]}"`;
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
