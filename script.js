// script.js

// 1. ตั้งค่าการเชื่อมต่อ Supabase
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

// ตรวจสอบว่าใส่ URL และ KEY แล้วหรือยัง
if (supabaseUrl === 'YOUR_SUPABASE_URL') {
    console.error("กรุณาใส่ Supabase URL และ Key ในไฟล์ script.js ของคุณ");
}

const supabase = supabase.createClient(supabaseUrl, supabaseKey);

// --- ระบบสลับหน้า UI (Toggle) ---
function showLogin() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const buttons = document.querySelectorAll('.tabs button');
    
    if (loginForm && registerForm) {
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
        buttons[0].classList.add('active');
        buttons[1].classList.remove('active');
    }
}

function showRegister() {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const buttons = document.querySelectorAll('.tabs button');
    
    if (loginForm && registerForm) {
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        buttons[0].classList.remove('active');
        buttons[1].classList.add('active');
    }
}

// --- ระบบ Auth ---
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const dashboard = document.getElementById('dashboard-section');
const authSection = document.getElementById('auth-section');

// ฟังก์ชันสมัครสมาชิก
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) alert('สมัครไม่สำเร็จ: ' + error.message);
        else alert('สมัครสมาชิกสำเร็จ! โปรดเช็คอีเมลเพื่อยืนยันตัวตน');
    });
}

// ฟังก์ชันเข้าสู่ระบบ
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) alert('เข้าสู่ระบบไม่สำเร็จ: ' + error.message);
        else {
            alert('เข้าสู่ระบบสำเร็จ!');
            checkUser();
        }
    });
}

// ฟังก์ชันตรวจสถานะ Login (Auto-refresh)
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

// เริ่มต้นเช็คสถานะ
checkUser();
