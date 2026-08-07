// 1. ตั้งค่า Supabase (ใส่ Key ของคุณ)
const supabaseUrl = 'https://vcbugctmyqubqvabrric.supabase.co/rest/v1/';
const supabaseKey = 'sb_publishable_SceKfh95c5dbx9hAK3Hhng_9Api0Ynj';
const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// ฟังก์ชันแปลง Username เป็น Email
const formatUser = (username) => `${username.toLowerCase()}@myapp.local`;

// DOM Elements
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const dashboard = document.getElementById('dashboard-section');
const authSection = document.getElementById('auth-section');
const productForm = document.getElementById('product-form');

// --- Auth Logic ---

// สมัครสมาชิก
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    const { data, error } = await supabase.auth.signUp({ 
        email: formatUser(username), 
        password: password 
    });
    
    if (error) alert('Error: ' + error.message);
    else alert('สมัครสมาชิกสำเร็จ!');
});

// เข้าสู่ระบบ
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    const { data, error } = await supabase.auth.signInWithPassword({ 
        email: formatUser(username), 
        password: password 
    });
    
    if (error) alert('เข้าสู่ระบบไม่สำเร็จ');
    else {
        alert('เข้าสู่ระบบสำเร็จ!');
        checkUser();
    }
});

// ตรวจสอบสถานะ
async function checkUser() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        authSection.style.display = 'none';
        dashboard.style.display = 'block';
        fetchItems();
    } else {
        authSection.style.display = 'block';
        dashboard.style.display = 'none';
    }
}

// --- CRUD Logic ---

// เพิ่มข้อมูล
productForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemNo = document.getElementById('item-no').value;
    const description = document.getElementById('description').value;
    const uom = document.getElementById('uom').value;

    const { error } = await supabase.from('items').insert([{ item_no: itemNo, description, uom }]);
    if (error) alert('Error: ' + error.message);
    else {
        productForm.reset();
        fetchItems();
    }
});

// ดึงข้อมูล
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

// ลบข้อมูล
async function deleteItem(id) {
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) alert('คุณไม่มีสิทธิ์ลบ!');
    else fetchItems();
}

// Logout
document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.reload();
});

// Toggle UI
function showLogin() {
    loginForm.style.display = 'block';
    registerForm.style.display = 'none';
}
function showRegister() {
    loginForm.style.display = 'none';
    registerForm.style.display = 'block';
}

// เริ่มต้นเช็คสถานะทันที
checkUser();
