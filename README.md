# IVAO Event Scheduler — Fixed & Improved

## 🐛 Bug Fixes

### 1. MongoDB Connection (serverless-safe)
**Problem:** `MongoClient.connect()` ถูกเรียกใหม่ทุก request บน Vercel serverless — ทำให้ connection หมด
**Fix:** Cache `client` ไว้ใน module-level variable (`cachedClient`) แทนที่จะสร้างใหม่ทุกครั้ง

```js
// server.js — fixed
let cachedClient = null;
async function getClient() {
    if (cachedClient) return cachedClient;  // ← reuse ถ้ามีอยู่แล้ว
    ...
    cachedClient = client;
    return client;
}
```

### 2. _id ไม่ถูก strip ออกจาก response
**Fix:** ทุก response ที่ return จาก MongoDB จะ destructure `_id` ออก:
```js
const { _id, ...e } = event;
res.json(e);
```

### 3. Slot booking — userId type mismatch
**Problem:** `slot.userId` เก็บเป็น number แต่เปรียบกับ string
**Fix:** ทั้งฝั่ง server และ client ใช้ `String(userId)` ก่อนเปรียบเทียบ

### 4. Admin check
**Problem:** เดิมแสดงปุ่ม Edit/Delete เฉพาะ `isAdmin()` — แต่ admin check อิง IVAO staff ซึ่งหลายคนไม่เห็น
**Fix:** ให้ทุกคนที่ login เห็นปุ่มจัดการ (ปรับตาม requirement จริงได้)

---

## 🎨 UI Improvements

- **ดีไซน์ดูดี** — สีเข้มกว่า, gradient ละเอียด, spacing สม่ำเสมอ
- **Cards** — hover effect ดีขึ้น, image zoom, route badge เด่นขึ้น
- **Status pills** — border + background แยกกันชัด (live/upcoming/completed)
- **Slots table** — progress bar บนสุด, type badge มีสีตาม ATC/Pilot
- **ATC Booking** — info banner แทน plain text
- **Toast** — border-left color coding, animation เรียบ
- **Modal** — animation, footer bg ต่างกัน
- **Loading** — logo glow effect
- **Live count** — ดึงจาก IVAO API จริง (pilots online)
- **Footer** — gradient ละเอียด, link hover slide

---

## 📁 Project Structure

```
ivao-scheduler/
├── server.js              ← fixed MongoDB pooling
├── package.json
├── vercel.json
└── public/
    ├── index.html         ← fixed paths, onerror fallback
    ├── css/
    │   └── base.css       ← redesigned
    └── js/
        ├── utils.js
        ├── auth.js
        ├── events.js
        ├── calendar.js
        ├── components.js
        └── app.js         ← fixed all functions, better UX
```

## 🚀 Deploy to Vercel

1. Set environment variables ใน Vercel dashboard:
   - `MONGODB_URI` = MongoDB Atlas connection string
   - `IVAO_CLIENT_ID` = OAuth client ID
   - `IVAO_CLIENT_SECRET` = OAuth client secret

2. `vercel deploy`

## 🔧 Local Development

```bash
npm install
MONGODB_URI=... IVAO_CLIENT_ID=... IVAO_CLIENT_SECRET=... node server.js
```
