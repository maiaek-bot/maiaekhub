# MaiaekHub

ฐานข้อมูลสินค้า–เวนเดอร์–ราคา สำหรับทีมจัดซื้อ ย้ายจาก Google Sheet "Daily work 2026"
มาเป็นเว็บแอป พร้อม sync สองทางกลับไปที่ชีตเดิม

**Stack:** Next.js (static export) · Supabase (Postgres + Auth + RLS) · GitHub Pages · Google Apps Script

---

## 1. ตั้งค่า Supabase

1. ไปที่โปรเจกต์ Supabase ของคุณ → **SQL Editor**
2. รันไฟล์ `supabase/migrations/0001_init.sql` ทั้งไฟล์ (สร้างตาราง `profiles`, `vendors`, `items`, `sync_log` พร้อม RLS)
3. ไปที่ **Project Settings → API** คัดลอกค่า 2 ตัวเก็บไว้:
   - `Project URL` → จะใช้เป็น `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → จะใช้เป็น `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → ใช้เฉพาะใน Google Apps Script เท่านั้น (**ห้ามใส่ในเว็บ/GitHub เด็ดขาด** เพราะ key นี้ข้าม RLS ได้ทั้งหมด)
4. เข้าเว็บแอป กด "สร้างบัญชี" ด้วยอีเมลของคุณ 1 ครั้ง (จะได้สิทธิ์ "พนักงาน" โดยอัตโนมัติ)
5. กลับไปที่ SQL Editor รันคำสั่งนี้ (แก้อีเมล) เพื่อตั้งให้ตัวเองเป็นแอดมิน:
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   หลังจากนั้นคุณจะเห็นเมนู "ผู้ใช้งาน" ในเว็บ และสามารถตั้งสิทธิ์คนอื่นได้จากในเว็บเลย ไม่ต้องมาที่ SQL Editor อีก

## 2. รันในเครื่องตัวเอง (ไม่บังคับ ถ้าจะแก้โค้ดก่อน deploy)

```bash
cp .env.local.example .env.local   # แล้วใส่ค่า Supabase URL / anon key
npm install
npm run dev
```

## 3. Deploy ขึ้น GitHub Pages

1. Push โฟลเดอร์นี้ทั้งหมดขึ้น repo GitHub ของคุณ (branch `main`)
2. ไปที่ repo → **Settings → Pages** → Source เลือก **GitHub Actions**
3. ไปที่ **Settings → Secrets and variables → Actions**:
   - แท็บ **Secrets** เพิ่ม `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - แท็บ **Variables** เพิ่ม `NEXT_PUBLIC_BASE_PATH` = `/ชื่อ-repo-ของคุณ`
     (ข้ามขั้นตอนนี้ได้ถ้า repo ชื่อ `<username>.github.io` หรือใช้ custom domain)
4. Push ขึ้น `main` อีกครั้ง (หรือรัน workflow ด้วยมือที่แท็บ Actions) — GitHub Actions
   (`.github/workflows/deploy.yml`) จะ build แล้ว deploy ให้อัตโนมัติ
5. เว็บจะขึ้นที่ `https://<username>.github.io/<repo>/`

## 4. เชื่อม Google Sheet แบบ sync สองทาง

1. เปิด Google Sheet "Daily work 2026" (ไฟล์จริง ไม่ใช่ไฟล์ทดสอบ) → **Extensions → Apps Script**
2. สร้างไฟล์ `Code.gs` แล้ววางเนื้อหาจาก `apps-script/Code.gs` ของโปรเจกต์นี้
3. เปิดไฟล์ `appsscript.json` ในตัวแก้ไข (ต้องเปิด "Show manifest file" ใน Project Settings ก่อน) แล้ววางเนื้อหาจาก `apps-script/appsscript.json`
4. **ตรวจสอบ `COLUMN_MAP` ที่ด้านบนของ `Code.gs`** ให้ตรงกับคอลัมน์จริงในแท็บ "DATA" ของคุณ (ชีตต้นฉบับมีบางจุดที่ merge/ไม่เป็นระเบียบ ให้เช็คให้ตรงก่อนรันจริง)
5. กด ▶ รันฟังก์ชัน `setup()` ครั้งเดียว (จะขอ authorize และให้ใส่ Supabase URL + **service_role key**)
6. รีโหลดสเปรดชีต จะเห็นเมนู **MaiaekHub** ขึ้นมาบนแถบเมนู พร้อม 2 คำสั่ง:
   - **⬆️ Push การเปลี่ยนแปลงไปยัง Supabase** — ส่งข้อมูลจากชีตเข้าเว็บ
   - **⬇️ ดึงข้อมูลล่าสุดจาก Supabase มาที่ชีต** — ดึงข้อมูลจากเว็บ (รวมที่แก้ในเว็บ) กลับมาที่ชีต
7. (ไม่บังคับ) ตั้ง time-driven trigger ให้รันอัตโนมัติทุกกี่ชั่วโมง: ในตัวแก้ไข Apps Script ไปที่ **Triggers** (นาฬิกา) → Add Trigger → เลือกฟังก์ชัน `pushToSupabase` หรือ `pullFromSupabase` ตามที่ต้องการ
8. ทุกครั้งที่ sync จะมีบันทึกไว้ทั้งในตาราง `sync_log` บน Supabase และแท็บ "Sync Log" ที่จะถูกสร้างขึ้นในสเปรดชีตอัตโนมัติ

> ⚠️ Sync สองทางแบบนี้คือ "ล่าสุดเขียนทับ" (last write wins) ไม่มีการ merge conflict อัตโนมัติ
> ถ้าแก้ไอเทมเดียวกันพร้อมกันทั้งในชีตและในเว็บก่อน sync ข้อมูลฝั่งที่ sync ทีหลังจะทับฝั่งแรก
> แนะนำให้ตกลงกันในทีมว่าใครแก้ที่ไหนเป็นหลัก แล้วอีกฝั่ง sync เข้าเป็นระยะ

## โครงสร้างสิทธิ์ผู้ใช้งาน (Roles)

| Role | ดูข้อมูล | เพิ่ม/แก้ไข | ลบ | จัดการสิทธิ์ผู้ใช้ |
|---|---|---|---|---|
| พนักงาน (`staff`) | ✅ | ❌ | ❌ | ❌ |
| หัวหน้าจัดซื้อ (`purchasing_lead`) | ✅ | ✅ | ❌ | ❌ |
| แอดมิน (`admin`) | ✅ | ✅ | ✅ | ✅ |

สิทธิ์ทั้งหมดบังคับที่ระดับฐานข้อมูล (Postgres Row Level Security) ไม่ใช่แค่ที่หน้าเว็บ
ดังนั้นแม้จะเรียก Supabase ตรงๆ ก็ยังโดนกฎเดียวกัน

## โครงสร้างโปรเจกต์

```
app/                  หน้าเว็บ (Next.js App Router)
  page.tsx             หน้าแรก = รายการสินค้า (Master Data)
  vendors/page.tsx      รายการเวนเดอร์
  users/page.tsx        จัดการสิทธิ์ผู้ใช้งาน (แอดมินเท่านั้น)
  login/page.tsx         เข้าสู่ระบบ / สร้างบัญชี
components/            ฟอร์ม modal, sidebar, auth guard
contexts/AuthContext.tsx  session + role ของผู้ใช้ปัจจุบัน
lib/supabase/client.ts    Supabase browser client
lib/types.ts               TypeScript types ตรงกับ schema
supabase/migrations/       SQL schema + RLS policies
apps-script/                Google Apps Script สำหรับ sync สองทาง
.github/workflows/deploy.yml  build + deploy อัตโนมัติขึ้น GitHub Pages
```

## โมดูลที่ยังไม่ได้ทำ (นอกสโคป MVP รอบนี้)

จากการวิเคราะห์ชีตต้นฉบับ ยังมีอีก 3 โมดูลที่ไม่ได้รวมไว้ในรอบนี้ตามที่เลือกไว้:
Task Tracker งานจัดซื้อรายวัน, ระบบควบคุมสต๊อก/สถานะสั่งซื้อ, และ sync ราคา-สต๊อกกับ Shopee/Lazada
โครงสร้างตาราง (`items`, `vendors`) ออกแบบให้ขยายเพิ่มตารางใหม่ต่อได้ทันทีถ้าต้องการทำโมดูลถัดไป
