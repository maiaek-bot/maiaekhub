// ============ MaiaekHub Service Worker ============
// เก้บ static shell (HTML/CSS/JS/font/ไอคอน) ไว้ใช้งานได้แม้เน็ตขาดช่วง
// ข้อมูลจริง (Supabase API) ไม่แคช ต้องออนไลน์เสมอ เพื่อไม่ให้เห็นข้อมูลเก่าโดยไม่รู้ตัว

const CACHE_NAME = 'maiaekhub-shell-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './supabase.js',
  './favicon.svg',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // ไม่แตะ request ที่ไม่ใช่ GET (POST/PATCH/DELETE ของ Supabase เป็นต้น)
  if (event.request.method !== 'GET') return;

  // ไม่แคชข้อมูลจริงจาก Supabase — ต้องดึงสดเสมอ
  if (url.hostname.endsWith('supabase.co')) return;

  // CDN libraries (PapaParse, XLSX, pdf.js, Google Fonts) — cache-first, fallback ไป network
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // static shell ของตัวเว็บเอง — cache-first แล้วอัปเดตแคชเงียบๆ เบื้องหลัง (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request).then((res) => {
        if (res && res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        }
        return res;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
