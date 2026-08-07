// script.js
// 1. ตั้งค่าการเชื่อมต่อ (เปลี่ยนค่าด้านล่างเป็นข้อมูลของคุณจาก Supabase Dashboard)
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- ระบบ Auth ---
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const dashboard = document.getElementById('dashboard-section');
const authSection = document.getElementById('auth-section');

// ฟังก์ชันสมัครสมาชิก
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) alert(error.message);
    else alert('สมัครสมาชิกสำเร็จ! โปรดยืนยันอีเมลของคุณ');
});

// ฟังก์ชันเข้าสู่ระบบ
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
    else {
        alert('เข้าสู่ระบบสำเร็จ!');
        checkUser();
    }
});

// ฟังก์ชันตรวจสถานะ Login
async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        authSection.style.display = 'none';
        dashboard.style.display = 'block';
        fetchItems(); // ดึงข้อมูลเมื่อ Login แล้ว
    } else {
        authSection.style.display = 'block';
        dashboard.style.display = 'none';
    }
}

// --- ระบบจัดการข้อมูล (CRUD) ---
const productForm = document.getElementById('product-form');

// เพิ่มสินค้า
productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemNo = document.getElementById('item-no').value;
    const description = document.getElementById('description').value;
    const uom = document.getElementById('uom').value;

    const { error } = await supabase.from('items').insert([{ item_no: itemNo, description, uom }]);
    if (error) alert('Error: ' + error.message);
    else {
        alert('บันทึกข้อมูลสำเร็จ!');
        productForm.reset();
        fetchItems();
    }
});

// ดึงข้อมูลแสดงในตาราง
async function fetchItems() {
    const { data, error } = await supabase.from('items').select('*');
    if (error) console.error(error);
    else {
        const tbody = document.getElementById('product-list');
        tbody.innerHTML = '';
        data.forEach(item => {
            tbody.innerHTML += `<tr>
                <td>${item.item_no}</td>
                <td>${item.description}</td>
                <td>${item.uom}</td>
                <td><button onclick="deleteItem('${item.id}')" class="btn-danger">ลบ</button></td>
            </tr>`;
        });
    }
}

// ลบสินค้า
async function deleteItem(id) {
    if (!confirm('ยืนยันการลบข้อมูล?')) return;
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) alert('คุณไม่มีสิทธิ์ลบข้อมูลนี้!');
    else fetchItems();
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
});

// เริ่มการทำงาน
checkUser();

// UI Toggles
function showLogin() { /* ...ฟังก์ชันสลับหน้าเดิม... */ }
function showRegister() { /* ...ฟังก์ชันสลับหน้าเดิม... */ }
