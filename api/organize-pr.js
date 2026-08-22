// Vercel Serverless Function — จัดระเบียบข้อความคำขอราคาด้วย Gemini API
//
// ทำไมต้องมีไฟล์นี้: เว็บนี้เป็น static site ล้วนๆ (ไม่มี backend ของตัวเอง) ถ้าไปเรียก Gemini API
// ตรงจากฝั่งเบราว์เซอร์ (script.js) จะต้องฝัง API key ไว้ในโค้ดหน้าเว็บ ซึ่งใครก็ดู source ดึงคีย์ไปใช้ได้เลย
// ไฟล์นี้ทำหน้าที่เป็นตัวกลาง (proxy) — คีย์จริงถูกเก็บไว้ในฝั่งเซิร์ฟเวอร์ (Environment Variable บน Vercel)
// เท่านั้น ฝั่งเบราว์เซอร์เห็นแค่ endpoint /api/organize-pr ไม่เห็นคีย์เลย
//
// วิธีตั้งค่า (ทำครั้งเดียว):
// 1. ไปที่ Vercel Dashboard -> โปรเจกต์ maiaekhub -> Settings -> Environment Variables
// 2. เพิ่มตัวแปรชื่อ GEMINI_API_KEY ค่าคือ API key ที่ได้จาก https://aistudio.google.com/apikey
// 3. Redeploy โปรเจกต์ 1 ครั้งให้ตัวแปรมีผล

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `คุณเป็นผู้ช่วยจัดระเบียบข้อความ "คำขอราคาสินค้า" ที่พนักงานจัดซื้อพิมพ์แบบภาษาพูดไม่เป็นทางการ (อาจพิมพ์ตกหล่น/พิมพ์ผิดบ้าง เหมือนพิมพ์คุยกันทางไลน์) ให้กลายเป็นสรุปที่มีโครงสร้างชัดเจน สำหรับใช้อ้างอิงหรือส่งต่อให้ผู้ขาย/Vendor

กติกาที่ต้องทำตามอย่างเคร่งครัด:
1. แยกข้อมูลจากข้อความต้นฉบับเป็น "สินค้า" (ชื่อ/ประเภทสินค้าที่ขอราคา), "สเปค" (รายละเอียดเสริม เช่น สี วัสดุ ขนาด แบบ ลาย ถ้าไม่มีข้อมูลให้ใส่ "-"), "จำนวนที่ต้องการ" (ถ้าข้อความไม่ได้ระบุจำนวนไว้เลย ให้ใส่ "1 (ไม่ได้ระบุจำนวนในข้อความ)")
2. มีรายการความต้องการมาตรฐาน 6 อย่าง: ราคา, มีสินค้าพร้อมส่งหรือไม่, รายละเอียดสินค้า, รูปตัวอย่างสินค้า, Lead Time (ระยะเวลาส่งสินค้าหลังสั่งซื้อหรือหลังโอนชำระเงินแล้วกรณีจ่ายเงินสด), สเต็ปราคาตามจำนวนสั่งซื้อ
   - ให้เลือกใส่เฉพาะข้อที่ข้อความต้นฉบับ "ถามถึงจริง" หรือสื่อความหมายชัดเจนเท่านั้น ห้ามเดาเติมเองถ้าข้อความไม่ได้พูดถึง
   - ถ้าข้อความไม่ได้ถามอะไรในหมวดนี้เลย (เช่นพิมพ์แค่ชื่อสินค้ากับจำนวน) ให้ใส่ "ราคา" เป็นค่าเริ่มต้นเพียงข้อเดียว เพราะโดยธรรมชาติของงานนี้คือการขอราคาอยู่แล้ว
3. ถ้าเจอคำขอ/คำถามอื่นที่ไม่เข้าพวกกับ 6 หมวดด้านบน ให้เพิ่มเป็นข้อท้ายๆ ในหัวข้อเดียวกัน ระบุตามที่เจอจริงในข้อความ
4. ห้ามแต่งเติมข้อมูลที่ไม่มีอยู่ในข้อความต้นฉบับโดยเด็ดขาด (ห้าม hallucinate) ถ้าไม่มีข้อมูลส่วนไหนให้ใส่ "-"
5. ตอบกลับเป็นข้อความตามรูปแบบด้านล่างนี้เท่านั้น ห้ามมีคำอธิบาย คำนำ หรือ markdown code block ใดๆ ทั้งสิ้น ห้ามมีข้อความอื่นนอกเหนือจากรูปแบบนี้:

สินค้า: <ค่า>
สเปค: <ค่า>
จำนวนที่ต้องการ: <ค่า>

สิ่งที่ต้องการจากผู้ขาย:
- <ข้อ 1>
- <ข้อ 2>`;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ success: false, error: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY บนเซิร์ฟเวอร์ (ดูวิธีตั้งค่าในคอมเมนต์ต้นไฟล์ api/organize-pr.js)' });
    return;
  }

  let details = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    details = String(body.details || '').trim();
  } catch (err) {
    res.status(400).json({ success: false, error: 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง' });
    return;
  }

  if (!details) {
    res.status(400).json({ success: false, error: 'ไม่มีข้อความรายละเอียดให้ประมวลผล' });
    return;
  }
  if (details.length > 4000) {
    res.status(400).json({ success: false, error: 'ข้อความยาวเกินไป (จำกัดไม่เกิน 4000 ตัวอักษร)' });
    return;
  }

  try {
    const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${SYSTEM_PROMPT}\n\nข้อความต้นฉบับ:\n"""\n${details}\n"""` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 500,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text().catch(() => '');
      console.error('Gemini API error:', geminiRes.status, errBody);
      const status = geminiRes.status === 429 ? 429 : 502;
      const msg = geminiRes.status === 429
        ? 'เรียกใช้ AI ถี่เกินไป (ชน rate limit ของ free tier) กรุณาลองใหม่อีกสักครู่'
        : 'เรียก Gemini API ไม่สำเร็จ';
      res.status(status).json({ success: false, error: msg });
      return;
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (!text) {
      res.status(502).json({ success: false, error: 'AI ไม่ได้ส่งข้อความกลับมา (อาจถูกบล็อกโดยตัวกรองความปลอดภัยของ Gemini)' });
      return;
    }

    res.status(200).json({ success: true, text });
  } catch (err) {
    console.error('organize-pr function error:', err);
    res.status(500).json({ success: false, error: 'เกิดข้อผิดพลาดที่ไม่คาดคิดระหว่างเรียก AI' });
  }
};
