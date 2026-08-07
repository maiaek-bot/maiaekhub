const SUPABASE_URL = 'https://vcbugctmyqubqvabrric.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SceKfh95c5dbx9hAK3Hhng_9Api0Ynj';

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorMessage = document.getElementById('errorMessage');

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // ดึงค่า Username และนำมาแปลงเป็นรูปแบบ Dummy Email ของระบบ
    const rawUsername = usernameInput.value.trim();
    const systemEmail = `${rawUsername}@maiaekhub.system`;
    const password = passwordInput.value;
    
    errorMessage.style.color = 'blue';
    errorMessage.textContent = 'กำลังตรวจสอบข้อมูล...';

    try {
        // ส่ง Dummy Email ไปเข้าสู่ระบบ
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
