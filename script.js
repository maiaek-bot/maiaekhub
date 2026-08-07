const SUPABASE_URL = 'https://vcbugctmyqubqvabrric.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SceKfh95c5dbx9hAK3Hhng_9Api0Ynj';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const loginBox = document.getElementById('loginBox');
const registerBox = document.getElementById('registerBox');
const linkToRegister = document.getElementById('linkToRegister');
const linkToLogin = document.getElementById('linkToLogin');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const errorMessage = document.getElementById('errorMessage');

// สลับหน้า Login / Register
linkToRegister.addEventListener('click', (e) => {
    e.preventDefault();
    loginBox.style.display = 'none';
    registerBox.style.display = 'block';
    errorMessage.textContent = '';
});

linkToLogin.addEventListener('click', (e) => {
    e.preventDefault();
    registerBox.style.display = 'none';
    loginBox.style.display = 'block';
    errorMessage.textContent = '';
});

// ฟังก์ชันเข้าสู่ระบบ
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawUsername = document.getElementById('username').value.trim();
    const systemEmail = `${rawUsername}@maiaekhub.system`;
    const password = document.getElementById('password').value;
    
    errorMessage.style.color = 'blue';
    errorMessage.textContent = 'กำลังตรวจสอบข้อมูล...';

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: systemEmail,
            password: password,
        });

        if (error) {
            errorMessage.style.color = 'var(--error-color)';
            errorMessage.textContent = 'เข้าสู่ระบบไม่สำเร็จ: ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
            console.error('Login Error:', error.message);
        } else {
            errorMessage.style.color = 'green';
            errorMessage.textContent = 'เข้าสู่ระบบสำเร็จ! กำลังพาท่านไปยังหน้าหลัก...';
            
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1000);
        }
    } catch (err) {
        errorMessage.style.color = 'var(--error-color)';
        errorMessage.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ';
        console.error('System Error:', err);
    }
});

// ฟังก์ชันสมัครสมาชิก
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const rawUsername = document.getElementById('regUsername').value.trim();
    const systemEmail = `${rawUsername}@maiaekhub.system`;
    const password = document.getElementById('regPassword').value;

    errorMessage.style.color = 'blue';
    errorMessage.textContent = 'กำลังลงทะเบียน...';

    try {
        // 1. สร้าง User ใน Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: systemEmail,
            password: password,
        });

        if (authError) throw authError;

        if (authData.user) {
            // 2. บันทึกข้อมูลลงตาราง user_profiles กำหนด role เป็น user
            const { error: profileError } = await supabase
                .from('user_profiles')
                .insert([
                    {
                        id: authData.user.id,
                        email: systemEmail,
                        role: 'user'
                    }
                ]);

            if (profileError) throw profileError;

            errorMessage.style.color = 'green';
            errorMessage.textContent = 'สมัครสมาชิกสำเร็จ! กำลังเข้าสู่ระบบ...';

            // 3. เข้าสู่ระบบอัตโนมัติหลังสมัครเสร็จ
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1200);
        }

    } catch (err) {
        errorMessage.style.color = 'var(--error-color)';
        errorMessage.textContent = 'การสมัครสมาชิกล้มเหลว: ' + (err.message || 'โปรดลองใหม่อีกครั้ง');
        console.error('Register Error:', err);
    }
});
