/**
 * server.test.js — Jest + Supertest
 * ครอบคลุม: Events CRUD, Slot booking/unbook, Stats, Health, Security gaps
 *
 * ติดตั้ง: npm install --save-dev jest supertest
 * รัน:    npx jest server.test.js
 */

const request = require('supertest');

// ─── Mock Firebase Admin ────────────────────────────────────────
// ต้อง mock ก่อน require app เพื่อกัน Firebase จริงโดน init
const mockDoc = {
    exists: true,
    id: 'event-123',
    data: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
};

const mockCollection = {
    doc: jest.fn(() => mockDoc),
    get: jest.fn(),
    where: jest.fn(),
};

mockCollection.where.mockReturnValue({
    get: jest.fn(),
});

jest.mock('firebase-admin/app', () => ({
    initializeApp: jest.fn(),
    cert: jest.fn(),
}));

jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => ({
        collection: jest.fn(() => mockCollection),
    })),
}));

// ─── Mock fetch (สำหรับ OAuth proxy และ ATC proxy) ─────────────
global.fetch = jest.fn();

// ─── Set env vars ปลอม ─────────────────────────────────────────
process.env.FIREBASE_PROJECT_ID = 'test-project';
process.env.FIREBASE_CLIENT_EMAIL = 'test@test.com';
process.env.FIREBASE_PRIVATE_KEY = 'fake-key';
process.env.IVAO_CLIENT_ID = 'test-client-id';
process.env.IVAO_CLIENT_SECRET = 'test-client-secret';

const app = require('./server');

// ─── Helper: สร้าง event mock ──────────────────────────────────
function makeEvent(overrides = {}) {
    return {
        id: 'event-123',
        title: 'Bangkok FIR Event',
        type: 'Division Event',
        description: 'Test event',
        departureIcao: 'VTBS',
        arrivalIcao: 'VTBD',
        dateStart: new Date(Date.now() + 3600_000).toISOString(), // 1 ชม. ข้างหน้า
        dateEnd: new Date(Date.now() + 7200_000).toISOString(),
        imageUrl: '',
        slots: [
            { position: 'VTBD_TWR', type: 'ATC', userId: null, userName: null },
            { position: 'VTBS_APP', type: 'ATC', userId: '800001', userName: 'John Doe' },
        ],
        createdBy: '800001',
        createdAt: new Date().toISOString(),
        ...overrides,
    };
}

// ═══════════════════════════════════════════════════════════════
// 1. Health Check
// ═══════════════════════════════════════════════════════════════
describe('GET /api/health', () => {
    it('ต้องคืน status ok', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body.time).toBeDefined();
    });
});

// ═══════════════════════════════════════════════════════════════
// 2. GET /api/events
// ═══════════════════════════════════════════════════════════════
describe('GET /api/events', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('happy path — คืน array ของ events เรียงตาม dateStart', async () => {
        const ev1 = makeEvent({ id: 'ev1', dateStart: new Date(Date.now() + 7200_000).toISOString() });
        const ev2 = makeEvent({ id: 'ev2', dateStart: new Date(Date.now() + 3600_000).toISOString() });

        mockCollection.get.mockResolvedValueOnce({
            docs: [
                { id: ev1.id, data: () => ev1 },
                { id: ev2.id, data: () => ev2 },
            ],
        });

        const res = await request(app).get('/api/events');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        // ต้องเรียง ev2 (เร็วกว่า) มาก่อน
        expect(res.body[0].id).toBe('ev2');
    });

    it('กรอง status=upcoming ต้องคืนแค่ event ที่ยังไม่เริ่ม', async () => {
        const past = makeEvent({ id: 'past', dateStart: '2020-01-01T00:00:00Z', dateEnd: '2020-01-01T02:00:00Z' });
        const future = makeEvent({ id: 'future' });

        mockCollection.get.mockResolvedValueOnce({
            docs: [
                { id: past.id, data: () => past },
                { id: future.id, data: () => future },
            ],
        });

        const res = await request(app).get('/api/events?status=upcoming');
        expect(res.status).toBe(200);
        expect(res.body.every(e => e.id !== 'past')).toBe(true);
    });

    it('กรอง search ต้องหา title/ICAO ได้', async () => {
        const ev = makeEvent({ title: 'VTBS Night Ops' });
        mockCollection.get.mockResolvedValueOnce({
            docs: [{ id: ev.id, data: () => ev }],
        });

        const res = await request(app).get('/api/events?search=night');
        expect(res.status).toBe(200);
        expect(res.body[0].title).toMatch(/night/i);
    });

    it('Firestore error → 500', async () => {
        mockCollection.get.mockRejectedValueOnce(new Error('DB down'));
        const res = await request(app).get('/api/events');
        expect(res.status).toBe(500);
        expect(res.body.error).toBeDefined();
    });
});

// ═══════════════════════════════════════════════════════════════
// 3. GET /api/events/:id
// ═══════════════════════════════════════════════════════════════
describe('GET /api/events/:id', () => {
    it('happy path — คืน event ที่หาเจอ', async () => {
        const ev = makeEvent();
        const fakeRef = {
            get: jest.fn().mockResolvedValue({ exists: true, id: ev.id, data: () => ev }),
        };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app).get('/api/events/event-123');
        expect(res.status).toBe(200);
        expect(res.body.title).toBe(ev.title);
    });

    it('event ไม่มีใน DB → 404', async () => {
        mockDoc.exists = false;
        mockCollection.doc.mockReturnValue(mockDoc);

        // ต้อง mock doc.get() ให้คืน mockDoc ตัวเดิม
        mockDoc.get = jest.fn().mockResolvedValue({ exists: false });
        // แต่ server เรียก eventsCol().doc(id).get() ดังนั้น mock chain:
        const fakeRef = { get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }) };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app).get('/api/events/not-exist');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Event not found');
    });
});

// ═══════════════════════════════════════════════════════════════
// 4. POST /api/events — ⚠️ SECURITY: ไม่มี Auth ตรงนี้!
// ═══════════════════════════════════════════════════════════════
describe('POST /api/events', () => {
    const newEvent = {
        title: 'Intl Fly-in',
        type: 'HQ Event',
        departureIcao: 'VTBS',
        arrivalIcao: 'VVTS',
        dateStart: '2025-12-01T10:00:00Z',
        dateEnd: '2025-12-01T14:00:00Z',
        slots: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockCollection.doc.mockReturnValue({
            set: jest.fn().mockResolvedValue({}),
        });
    });

    it('happy path — สร้าง event ได้, คืน 201 พร้อม id', async () => {
        const res = await request(app)
            .post('/api/events')
            .set('Authorization', 'Bearer fake-token')
            .send(newEvent);
        expect(res.status).toBe(201);
        expect(res.body.id).toBeDefined();
        expect(res.body.title).toBe(newEvent.title);
        expect(res.body.createdAt).toBeDefined();
    });

    it('✅ SECURITY FIXED: สร้าง event โดยไม่มี token → 401', async () => {
        const res = await request(app)
            .post('/api/events')
            .send(newEvent);
        expect(res.status).toBe(401);
    });

    it('Firestore error → 500', async () => {
        mockCollection.doc.mockReturnValue({
            set: jest.fn().mockRejectedValue(new Error('Firestore write fail')),
        });
        const res = await request(app)
            .post('/api/events')
            .set('Authorization', 'Bearer fake-token')
            .send(newEvent);
        expect(res.status).toBe(500);
    });
});

// ═══════════════════════════════════════════════════════════════
// 5. PUT /api/events/:id — ⚠️ SECURITY: ไม่มี Auth ตรงนี้!
// ═══════════════════════════════════════════════════════════════
describe('PUT /api/events/:id', () => {
    it('happy path — อัปเดต event ได้', async () => {
        const ev = makeEvent();
        const fakeRef = {
            get: jest.fn()
                .mockResolvedValueOnce({ exists: true, data: () => ev })
                .mockResolvedValueOnce({ exists: true, id: ev.id, data: () => ({ ...ev, title: 'Updated' }) }),
            set: jest.fn().mockResolvedValue({}),
        };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .put('/api/events/event-123')
            .set('Authorization', 'Bearer fake-token')
            .send({ title: 'Updated' });

        expect(res.status).toBe(200);
        expect(res.body.title).toBe('Updated');
    });

    it('✅ SECURITY FIXED: แก้ event โดยไม่มี token → 401', async () => {
        const res = await request(app)
            .put('/api/events/event-123')
            .send({ title: 'Hacked!' });
        expect(res.status).toBe(401);
    });

    it('event ไม่มี → 404', async () => {
        const fakeRef = { get: jest.fn().mockResolvedValue({ exists: false }) };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .put('/api/events/ghost')
            .set('Authorization', 'Bearer fake-token')
            .send({ title: 'x' });
        expect(res.status).toBe(404);
    });
});

// ═══════════════════════════════════════════════════════════════
// 6. DELETE /api/events/:id — ⚠️ SECURITY: ไม่มี Auth ตรงนี้!
// ═══════════════════════════════════════════════════════════════
describe('DELETE /api/events/:id', () => {
    it('happy path — ลบ event ได้', async () => {
        const fakeRef = {
            get: jest.fn().mockResolvedValue({ exists: true }),
            delete: jest.fn().mockResolvedValue({}),
        };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .delete('/api/events/event-123')
            .set('Authorization', 'Bearer fake-token');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('✅ SECURITY FIXED: ลบ event โดยไม่มี token → 401', async () => {
        const res = await request(app).delete('/api/events/event-123');
        expect(res.status).toBe(401);
    });

    it('event ไม่มี → 404', async () => {
        const fakeRef = { get: jest.fn().mockResolvedValue({ exists: false }) };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .delete('/api/events/ghost')
            .set('Authorization', 'Bearer fake-token');
        expect(res.status).toBe(404);
    });
});

// ═══════════════════════════════════════════════════════════════
// 7. POST /api/events/:id/book
// ═══════════════════════════════════════════════════════════════
describe('POST /api/events/:id/book', () => {
    function makeDocWithEvent(ev) {
        return {
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ev }),
            update: jest.fn().mockResolvedValue({}),
        };
    }

    it('happy path — จอง slot ว่างได้', async () => {
        const ev = makeEvent();
        mockCollection.doc.mockReturnValue(makeDocWithEvent(ev));

        const res = await request(app)
            .post('/api/events/event-123/book')
            .send({ slotIndex: 0, userId: '999999', userName: 'New Pilot' });

        expect(res.status).toBe(200);
    });

    it('slot ที่จองไปแล้ว → 400 Slot already booked', async () => {
        const ev = makeEvent();
        mockCollection.doc.mockReturnValue(makeDocWithEvent(ev));

        const res = await request(app)
            .post('/api/events/event-123/book')
            .send({ slotIndex: 1, userId: '999999', userName: 'Someone' }); // slot 1 มี userId แล้ว

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Slot already booked');
    });

    it('slotIndex เกินขอบเขต → 400 Invalid slot index', async () => {
        const ev = makeEvent();
        mockCollection.doc.mockReturnValue(makeDocWithEvent(ev));

        const res = await request(app)
            .post('/api/events/event-123/book')
            .send({ slotIndex: 99, userId: '111', userName: 'Ghost' });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid slot index');
    });

    it('slotIndex ติดลบ → 400', async () => {
        const ev = makeEvent();
        mockCollection.doc.mockReturnValue(makeDocWithEvent(ev));

        const res = await request(app)
            .post('/api/events/event-123/book')
            .send({ slotIndex: -1, userId: '111', userName: 'Ghost' });

        expect(res.status).toBe(400);
    });

    it('event ไม่มี → 404', async () => {
        mockCollection.doc.mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
        });

        const res = await request(app)
            .post('/api/events/ghost/book')
            .send({ slotIndex: 0, userId: '111', userName: 'x' });

        expect(res.status).toBe(404);
    });
});

// ═══════════════════════════════════════════════════════════════
// 8. POST /api/events/:id/unbook
// ═══════════════════════════════════════════════════════════════
describe('POST /api/events/:id/unbook', () => {
    it('happy path — ยกเลิก slot ของตัวเองได้', async () => {
        const ev = makeEvent();
        const fakeRef = {
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ev }),
            update: jest.fn().mockResolvedValue({}),
        };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .post('/api/events/event-123/unbook')
            .send({ slotIndex: 1, userId: '800001' }); // slot 1 เป็นของ 800001

        expect(res.status).toBe(200);
    });

    it('ยกเลิก slot ของคนอื่น → 403 Not your booking', async () => {
        const ev = makeEvent();
        const fakeRef = {
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ev }),
            update: jest.fn().mockResolvedValue({}),
        };
        mockCollection.doc.mockReturnValue(fakeRef);

        const res = await request(app)
            .post('/api/events/event-123/unbook')
            .send({ slotIndex: 1, userId: '999999' }); // slot 1 เป็นของ 800001

        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Not your booking');
    });

    it('slotIndex เกิน → 400', async () => {
        const ev = makeEvent();
        mockCollection.doc.mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ev }),
        });

        const res = await request(app)
            .post('/api/events/event-123/unbook')
            .send({ slotIndex: 50, userId: '800001' });

        expect(res.status).toBe(400);
    });
});

// ═══════════════════════════════════════════════════════════════
// 9. GET /api/stats
// ═══════════════════════════════════════════════════════════════
describe('GET /api/stats', () => {
    it('happy path — นับ total/upcoming/live/completed ถูกต้อง', async () => {
        const now = new Date();
        const past = makeEvent({
            id: 'past',
            dateStart: new Date(now - 7200_000).toISOString(),
            dateEnd: new Date(now - 3600_000).toISOString(),
            slots: [{ userId: '111' }, { userId: null }],
        });
        const future = makeEvent({ id: 'future', slots: [] });

        mockCollection.get.mockResolvedValueOnce({
            docs: [
                { id: past.id, data: () => past },
                { id: future.id, data: () => future },
            ],
        });

        const res = await request(app).get('/api/stats');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        expect(res.body.completed).toBe(1);
        expect(res.body.upcoming).toBe(1);
        expect(res.body.bookedSlots).toBe(1);
        expect(res.body.totalSlots).toBe(2);
    });

    it('DB error → 500', async () => {
        mockCollection.get.mockRejectedValueOnce(new Error('fail'));
        const res = await request(app).get('/api/stats');
        expect(res.status).toBe(500);
    });
});

// ═══════════════════════════════════════════════════════════════
// 10. POST /api/auth/token
// ═══════════════════════════════════════════════════════════════
describe('POST /api/auth/token', () => {
    it('happy path — แลก token ได้', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ access_token: 'abc', refresh_token: 'xyz' }),
        });

        const res = await request(app).post('/api/auth/token').send({
            code: 'auth-code',
            code_verifier: 'verifier',
            redirect_uri: 'http://localhost',
        });

        expect(res.status).toBe(200);
        expect(res.body.access_token).toBe('abc');
    });

    it('IVAO คืน error → ส่ง status เดิมกลับ', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid_grant' }),
        });

        const res = await request(app).post('/api/auth/token').send({
            code: 'bad-code',
            code_verifier: 'v',
            redirect_uri: 'http://localhost',
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('invalid_grant');
    });

    it('fetch ล้ม (network) → 500', async () => {
        global.fetch.mockRejectedValueOnce(new Error('Network error'));

        const res = await request(app).post('/api/auth/token').send({
            code: 'x',
            code_verifier: 'y',
            redirect_uri: 'http://localhost',
        });

        expect(res.status).toBe(500);
    });
});

// ═══════════════════════════════════════════════════════════════
// 11. ATC Booking Proxy — auth check
// ═══════════════════════════════════════════════════════════════
describe('ATC Booking Proxy auth checks', () => {
    it('GET /api/atc/bookings/me ไม่มี token → 401', async () => {
        const res = await request(app).get('/api/atc/bookings/me');
        expect(res.status).toBe(401);
    });

    it('POST /api/atc/bookings ไม่มี token → 401', async () => {
        const res = await request(app).post('/api/atc/bookings').send({});
        expect(res.status).toBe(401);
    });

    it('DELETE /api/atc/bookings/:id ไม่มี token → 401', async () => {
        const res = await request(app).delete('/api/atc/bookings/booking-999');
        expect(res.status).toBe(401);
    });

    it('GET /api/atc/bookings (public) — ส่ง proxy ต่อได้', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ items: [] }),
        });
        const res = await request(app).get('/api/atc/bookings');
        expect(res.status).toBe(200);
    });
});