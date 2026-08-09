-- ==================================================
-- MaiaekHub — โครงสร้างฐานข้อมูลอ้างอิง (Supabase / Postgres)
-- ==================================================
-- ⚠️ ไฟล์นี้เป็น "เอกสารอ้างอิง" สำหรับดูโครงสร้างที่ระบบต้องใช้เท่านั้น
-- ฐานข้อมูลจริงของคุณมีข้อมูล (สินค้า, ผู้ใช้) อยู่แล้ว — ห้ามรันไฟล์นี้ทับ
-- ยกเว้นต้องการตั้งค่าโปรเจกต์ Supabase ใหม่ตั้งแต่ศูนย์เท่านั้น
-- ==================================================

-- ---------- ตาราง profiles ----------
-- เก็บข้อมูลผู้ใช้เพิ่มเติมนอกเหนือจาก auth.users (username, role)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  role text not null default 'general_user' check (role in ('owner', 'admin', 'general_user')),
  created_at timestamptz not null default now()
);

-- ---------- ตาราง products ----------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text unique not null,
  product_name text not null,
  price numeric(12,2) not null default 0,
  discount_step_1 text,
  discount_step_2 text,
  discount_step_3 text,
  discount_step_4 text,
  order_condition text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  price_updated_at date not null default current_date
);

-- ---------- Migration: เพิ่มคอลัมน์ price_updated_at ให้ตาราง products ที่มีอยู่แล้ว ----------
-- รันบรรทัดนี้ถ้าตาราง products มีอยู่แล้วในระบบก่อนหน้านี้ (ไม่ต้องรันถ้าเพิ่งสร้างตารางใหม่ด้วย script ด้านบน)
alter table public.products add column if not exists price_updated_at date not null default current_date;

-- ---------- Migration: เปลี่ยนสเต็ปส่วนลด 1-4 จากตัวเลขเป็นข้อความอิสระ ----------
-- รันชุดนี้ถ้าตาราง products มีอยู่แล้วและคอลัมน์ discount_step_1-4 ยังเป็น numeric อยู่
-- (แปลงข้อมูลเดิมเป็นข้อความอัตโนมัติ ไม่มีข้อมูลสูญหาย)
alter table public.products alter column discount_step_1 type text using discount_step_1::text;
alter table public.products alter column discount_step_2 type text using discount_step_2::text;
alter table public.products alter column discount_step_3 type text using discount_step_3::text;
alter table public.products alter column discount_step_4 type text using discount_step_4::text;

-- ---------- ตาราง audit_logs (ประวัติการแก้ไข/ลบ) ----------
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  username text not null,
  action text not null check (action in ('edit', 'delete')),
  product_id uuid,
  product_code text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Trigger: สร้าง profile อัตโนมัติเมื่อมีการสมัครสมาชิกใหม่ ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    'general_user'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Trigger: อัปเดต updated_at อัตโนมัติของ products ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_products_updated_at on public.products;
create trigger set_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ==================================================
-- Row Level Security (RLS)
-- ==================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.audit_logs enable row level security;

-- profiles: ทุกคนที่ login แล้วอ่านได้ (เพื่อเช็ค role/username), แก้ไขได้เฉพาะแถวตัวเอง
create policy "profiles_select_authenticated" on public.profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- products: ทุกคนที่ login แล้วอ่าน/เพิ่ม/แก้ไขได้ แต่ลบได้เฉพาะ owner/admin
create policy "products_select_authenticated" on public.products
  for select using (auth.role() = 'authenticated');

create policy "products_insert_authenticated" on public.products
  for insert with check (auth.role() = 'authenticated');

create policy "products_update_authenticated" on public.products
  for update using (auth.role() = 'authenticated');

create policy "products_delete_owner_admin" on public.products
  for delete using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );

-- audit_logs: ทุกคน insert ได้ (เขียน log ตอนแก้/ลบ), อ่านได้เฉพาะ owner/admin
create policy "audit_logs_insert_authenticated" on public.audit_logs
  for insert with check (auth.role() = 'authenticated');

create policy "audit_logs_select_owner_admin" on public.audit_logs
  for select using (
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('owner', 'admin')
    )
  );
