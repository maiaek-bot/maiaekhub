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
  showAuthScreen();
}

// ==================================================
// Post sign-in: load profile, show app
// ==================================================
async function handleSignedIn(user) {
  currentUser = user;

  const { data: profile, error } = await sb
    .from('profiles')
    .select('id, username, role, email')
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
  $('userBadge').innerHTML = `<span class="role-dot"></span>${escapeHtml(currentProfile.username)} · ${roleLabel(currentProfile.role)}`;
  $('historyBtn').hidden = !(currentProfile.role === 'owner' || currentProfile.role === 'admin');
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
      <td class="product-name">${escapeHtml(p.product_name)}</td>
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
