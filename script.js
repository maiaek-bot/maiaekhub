// script.js
// Initialize Supabase (Will need your Supabase URL and Anon Key later)
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
// const supabase = supabase.createClient(supabaseUrl, supabaseKey); // Uncomment when ready

// UI Toggles
function showLogin() {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.querySelectorAll('.tabs button')[0].classList.add('active');
    document.querySelectorAll('.tabs button')[1].classList.remove('active');
}

function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    document.querySelectorAll('.tabs button')[0].classList.remove('active');
    document.querySelectorAll('.tabs button')[1].classList.add('active');
}

// TODO: Implement Supabase Auth and Database functions in Phase 2
console.log("App initialized. Waiting for Supabase integration.");
