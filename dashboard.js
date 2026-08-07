const SUPABASE_URL = 'https://vcbugctmyqubqvabrric.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SceKfh95c5dbx9hAK3Hhng_9Api0Ynj';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const userEmailEl = document.getElementById('userEmail');
const userRoleBadgeEl = document.getElementById('userRoleBadge');
const btnLogout = document.getElementById('btnLogout');
const productTableBody = document.getElementById('productTableBody');
const totalItemsText = document.getElementById('totalItemsText');
const searchInput = document.getElementById('searchInput');

const productModal = document.getElementById('productModal');
const btnOpenAddModal = document.getElementById('btnOpenAddModal');
const btnCloseModal = document.getElementById('btnCloseModal');
const btnCancelModal = document.getElementById('btnCancelModal');
const productForm = document.getElementById('productForm');
const modalTitle = document.getElementById('modalTitle');

const productIdInput = document.getElementById('productId');
const itemNoInput = document.getElementById('itemNo');
const descriptionInput = document.getElementById('description');
const uomGroupInput = document.getElementById('uomGroup');
const baseUnitPriceInput = document.getElementById('baseUnitPrice');
const preferredVendorInput = document.getElementById('preferredVendor');
const conditionNoteInput = document.getElementById('conditionNote');

let allProducts = [];

function escapeHTML(str) {
    if (!str && str !== 0) return '-';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function initDashboard() {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
        window.location.href = 'index.html';
        return;
    }

    userEmailEl.textContent = session.user.email;
    fetchUserProfile(session.user.id);
    fetchProducts();
}

async function fetchUserProfile(userId) {
    try {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', userId)
            .single();

        if (data && data.role) {
            userRoleBadgeEl.textContent = data.role.toUpperCase();
        } else {
            userRoleBadgeEl.textContent = 'USER';
        }
    } catch (err) {
        console.error('Error fetching profile:', err);
    }
}

async function fetchProducts() {
    productTableBody.innerHTML = '<tr><td colspan="7" class="text-center">กำลังโหลดข้อมูลสินค้า...</td></tr>';

    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;

        allProducts = data || [];
        renderTable(allProducts);

    } catch (err) {
        console.error('Fetch error:', err);
        productTableBody.innerHTML = '<tr><td colspan="7" class="text-center error-text">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>';
    }
}

function renderTable(products) {
    if (products.length === 0) {
        productTableBody.innerHTML = '<tr><td colspan="7" class="text-center">ไม่พบข้อมูลสินค้า</td></tr>';
        totalItemsText.textContent = 'รวมทั้งหมด 0 รายการ';
        return;
    }

    let html = '';
    products.forEach(item => {
        html += `
            <tr>
                <td><strong>${escapeHTML(item.item_no)}</strong></td>
                <td>${escapeHTML(item.description)}</td>
                <td>${escapeHTML(item.uom_group)}</td>
                <td>${item.base_unit_price ? Number(item.base_unit_price).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'}</td>
                <td>${escapeHTML(item.preferred_vendor)}</td>
                <td>${escapeHTML(item.condition_note)}</td>
                <td>
                    <button class="btn btn-sm btn-edit" onclick="openEditModal(${item.id})">แก้ไข</button>
                </td>
            </tr>
        `;
    });

    productTableBody.innerHTML = html;
    totalItemsText.textContent = `รวมทั้งหมด ${products.length.toLocaleString()} รายการ`;
}

searchInput.addEventListener('input', (e) => {
    const keyword = e.target.value.toLowerCase().trim();
    if (!keyword) {
        renderTable(allProducts);
        return;
    }

    const filtered = allProducts.filter(item => {
        const itemNo = (item.item_no || '').toLowerCase();
        const desc = (item.description || '').toLowerCase();
        const vendor = (item.preferred_vendor || '').toLowerCase();
        return itemNo.includes(keyword) || desc.includes(keyword) || vendor.includes(keyword);
    });

    renderTable(filtered);
});

function openModal(isEdit = false) {
    productModal.style.display = 'flex';
    if (!isEdit) {
        modalTitle.textContent = 'เพิ่มสินค้าใหม่';
        productForm.reset();
        productIdInput.value = '';
    }
}

function closeModal() {
    productModal.style.display = 'none';
    productForm.reset();
}

btnOpenAddModal.addEventListener('click', () => openModal(false));
btnCloseModal.addEventListener('click', closeModal);
btnCancelModal.addEventListener('click', closeModal);

window.openEditModal = function(id) {
    const item = allProducts.find(p => p.id === id);
    if (!item) return;

    productIdInput.value = item.id;
    itemNoInput.value = item.item_no || '';
    descriptionInput.value = item.description || '';
    uomGroupInput.value = item.uom_group || '';
    baseUnitPriceInput.value = item.base_unit_price || '';
    preferredVendorInput.value = item.preferred_vendor || '';
    conditionNoteInput.value = item.condition_note || '';

    modalTitle.textContent = 'แก้ไขข้อมูลสินค้า';
    openModal(true);
};

productForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = productIdInput.value;
    const payload = {
        item_no: itemNoInput.value.trim(),
        description: descriptionInput.value.trim(),
        uom_group: uomGroupInput.value.trim(),
        base_unit_price: baseUnitPriceInput.value ? parseFloat(baseUnitPriceInput.value) : null,
        preferred_vendor: preferredVendorInput.value.trim(),
        condition_note: conditionNoteInput.value.trim()
    };

    try {
        let result;
        if (id) {
            result = await supabase
                .from('products')
                .update(payload)
                .eq('id', id);
        } else {
            result = await supabase
                .from('products')
                .insert([payload]);
        }

        if (result.error) throw result.error;

        closeModal();
        fetchProducts();

    } catch (err) {
        alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message);
        console.error('Save error:', err);
    }
});

btnLogout.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
});

initDashboard();
