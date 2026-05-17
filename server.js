const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Firebase Admin Init ───────────────────────────────────────
let db;

function getDB() {
    if (db) return db;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Missing Firebase environment variables (FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)');
    }

    initializeApp({
        credential: cert({ projectId, clientEmail, privateKey })
    });

    db = getFirestore();
    console.log('✅ Connected to Firebase Firestore');
    return db;
}

function eventsCol() {
    return getDB().collection('events');
}

// ─── Middleware / Security ─────────────────────────────────────
const DEFAULT_ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://ivao-event-schedule.vercel.app',
    'https://ivao-th-event.vercel.app'
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        // Allow same-origin, curl, mobile app, and server-to-server requests with no Origin header.
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS blocked'));
    }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/image', express.static(path.join(__dirname, 'image')));

function getBearerToken(req) {
    const header = req.headers.authorization;
    if (!header) return null;
    return header.startsWith('Bearer ') ? header : `Bearer ${header}`;
}

async function requireAuth(req, res, next) {
    const token = getBearerToken(req);

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const response = await fetch('https://api.ivao.aero/v2/users/me', {
            headers: { Authorization: token }
        });

        const data = await response.json().catch(() => null);

        if (!response.ok) {
            return res.status(401).json({ error: 'Invalid IVAO token' });
        }

        req.ivaoToken = token;
        req.user = data;
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

function getUserId(user) {
    return String(user?.id || user?.vid || user?.userId || user?.data?.id || '');
}

function getUserName(user) {
    const first = user?.firstName || user?.firstname || user?.data?.firstName || '';
    const last = user?.lastName || user?.lastname || user?.data?.lastName || '';
    const fullName = `${first} ${last}`.trim();
    return fullName || user?.name || user?.username || user?.data?.name || 'Unknown';
}

function validateEventPayload(req, res, next) {
    const { title, dateStart, dateEnd } = req.body;

    if (!title || !dateStart || !dateEnd) {
        return res.status(400).json({ error: 'Missing required fields: title, dateStart, dateEnd' });
    }

    const start = new Date(dateStart);
    const end = new Date(dateEnd);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: 'dateStart and dateEnd must be valid dates' });
    }

    if (end <= start) {
        return res.status(400).json({ error: 'dateEnd must be after dateStart' });
    }

    next();
}

function docToEvent(doc) {
    return { id: doc.id, ...doc.data() };
}

// ─── Health Check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── OAuth Proxy ───────────────────────────────────────────────
app.post('/api/auth/token', async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;
    const CLIENT_ID = process.env.IVAO_CLIENT_ID;
    const CLIENT_SECRET = process.env.IVAO_CLIENT_SECRET;

    if (!CLIENT_ID || !CLIENT_SECRET) {
        return res.status(500).json({ error: 'OAuth credentials not configured' });
    }

    try {
        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            redirect_uri,
            code_verifier
        });

        const response = await fetch('https://api.ivao.aero/v2/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });

        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        console.error('Token exchange error:', err);
        res.status(500).json({ error: 'Token exchange failed' });
    }
});

// ─── ATC Booking Proxy ─────────────────────────────────────────
app.get('/api/atc/bookings', async (req, res) => {
    const token = req.headers.authorization;
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    try {
        const headers = {};
        if (token) headers['Authorization'] = token;
        if (apiKey) headers['apiKey'] = apiKey;
        const params = new URLSearchParams(req.query);
        const response = await fetch(`https://api.ivao.aero/v2/atc/bookings?${params}`, { headers });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch ATC bookings' });
    }
});

app.get('/api/atc/bookings/me', requireAuth, async (req, res) => {
    try {
        const response = await fetch('https://api.ivao.aero/v2/users/me/atc/bookings', {
            headers: { Authorization: req.ivaoToken }
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch your bookings' });
    }
});

app.post('/api/atc/bookings', requireAuth, async (req, res) => {
    try {
        const response = await fetch('https://api.ivao.aero/v2/atc/bookings', {
            method: 'POST',
            headers: { Authorization: req.ivaoToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create ATC booking' });
    }
});

app.delete('/api/atc/bookings/:id', requireAuth, async (req, res) => {
    try {
        const response = await fetch(`https://api.ivao.aero/v2/atc/bookings/${req.params.id}`, {
            method: 'DELETE',
            headers: { Authorization: req.ivaoToken }
        });
        if (response.status === 204) return res.json({ success: true });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete ATC booking' });
    }
});

// ─── Events API ────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
    try {
        const { type, status, search } = req.query;
        let snapshot;

        if (type && type !== 'all') {
            snapshot = await eventsCol().where('type', '==', type).get();
        } else {
            snapshot = await eventsCol().get();
        }

        let events = snapshot.docs.map(docToEvent);

        if (search) {
            const q = String(search).toLowerCase();
            events = events.filter(e =>
                (e.title || '').toLowerCase().includes(q) ||
                (e.departureIcao || '').toLowerCase().includes(q) ||
                (e.arrivalIcao || '').toLowerCase().includes(q) ||
                (e.description || '').toLowerCase().includes(q)
            );
        }

        if (status && status !== 'all') {
            const now = new Date();
            events = events.filter(e => {
                const start = new Date(e.dateStart);
                const end = new Date(e.dateEnd);
                if (status === 'upcoming') return start > now;
                if (status === 'live') return start <= now && end >= now;
                if (status === 'completed') return end < now;
                return true;
            });
        }

        events.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart));
        res.json(events);
    } catch (err) {
        console.error('GET /api/events error:', err);
        res.status(500).json({ error: 'Failed to fetch events', detail: err.message });
    }
});

app.get('/api/events/:id', async (req, res) => {
    try {
        const doc = await eventsCol().doc(req.params.id).get();
        if (!doc.exists) return res.status(404).json({ error: 'Event not found' });
        res.json(docToEvent(doc));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch event' });
    }
});

app.post('/api/events', requireAuth, validateEventPayload, async (req, res) => {
    try {
        const id = uuidv4();
        const newEvent = {
            ...req.body,
            createdAt: new Date().toISOString(),
            createdBy: {
                id: getUserId(req.user),
                name: getUserName(req.user)
            }
        };
        await eventsCol().doc(id).set(newEvent);
        res.status(201).json({ id, ...newEvent });
    } catch (err) {
        console.error('POST /api/events error:', err);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

app.put('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const ref = eventsCol().doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'Event not found' });

        await ref.set({
            ...req.body,
            updatedAt: new Date().toISOString(),
            updatedBy: {
                id: getUserId(req.user),
                name: getUserName(req.user)
            }
        }, { merge: true });

        const updated = await ref.get();
        res.json(docToEvent(updated));
    } catch (err) {
        res.status(500).json({ error: 'Failed to update event' });
    }
});

app.delete('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const ref = eventsCol().doc(req.params.id);
        const doc = await ref.get();
        if (!doc.exists) return res.status(404).json({ error: 'Event not found' });
        await ref.delete();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

app.post('/api/events/:id/book', requireAuth, async (req, res) => {
    try {
        const { slotIndex } = req.body;
        const userId = getUserId(req.user);
        const userName = getUserName(req.user);
        const ref = eventsCol().doc(req.params.id);

        const updatedEvent = await getDB().runTransaction(async transaction => {
            const doc = await transaction.get(ref);
            if (!doc.exists) throw new Error('Event not found');

            const event = doc.data();
            if (!Array.isArray(event.slots)) throw new Error('Event has no slots');
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= event.slots.length) {
                throw new Error('Invalid slot index');
            }
            if (event.slots[slotIndex].userId) throw new Error('Slot already booked');

            const slots = [...event.slots];
            slots[slotIndex] = {
                ...slots[slotIndex],
                userId,
                userName
            };

            const update = { slots, updatedAt: FieldValue.serverTimestamp() };
            transaction.update(ref, update);
            return { id: doc.id, ...event, slots };
        });

        res.json(updatedEvent);
    } catch (err) {
        res.status(400).json({ error: err.message || 'Failed to book slot' });
    }
});

app.post('/api/events/:id/unbook', requireAuth, async (req, res) => {
    try {
        const { slotIndex } = req.body;
        const userId = getUserId(req.user);
        const ref = eventsCol().doc(req.params.id);

        const updatedEvent = await getDB().runTransaction(async transaction => {
            const doc = await transaction.get(ref);
            if (!doc.exists) throw new Error('Event not found');

            const event = doc.data();
            if (!Array.isArray(event.slots)) throw new Error('Event has no slots');
            if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= event.slots.length) {
                throw new Error('Invalid slot index');
            }
            if (String(event.slots[slotIndex].userId) !== String(userId)) {
                throw new Error('Not your booking');
            }

            const slots = [...event.slots];
            slots[slotIndex] = {
                ...slots[slotIndex],
                userId: null,
                userName: null
            };

            const update = { slots, updatedAt: FieldValue.serverTimestamp() };
            transaction.update(ref, update);
            return { id: doc.id, ...event, slots };
        });

        res.json(updatedEvent);
    } catch (err) {
        const status = err.message === 'Not your booking' ? 403 : 400;
        res.status(status).json({ error: err.message || 'Failed to unbook slot' });
    }
});

// ─── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    try {
        const snapshot = await eventsCol().get();
        const events = snapshot.docs.map(docToEvent);
        const now = new Date();

        res.json({
            total: events.length,
            upcoming: events.filter(e => new Date(e.dateStart) > now).length,
            live: events.filter(e => new Date(e.dateStart) <= now && new Date(e.dateEnd) >= now).length,
            completed: events.filter(e => new Date(e.dateEnd) < now).length,
            totalSlots: events.reduce((sum, e) => sum + (e.slots?.length || 0), 0),
            bookedSlots: events.reduce((sum, e) => sum + (e.slots?.filter(s => s.userId)?.length || 0), 0)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ─── SPA Fallback ──────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ─────────────────────────────────────────────────────
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`
  ╔══════════════════════════════════════════════╗
  ║   ✈️  IVAO Event Scheduler                   ║
  ║   🌐 http://localhost:${PORT}                   ║
  ║   📦 Backend API ready (Firebase)            ║
  ╚══════════════════════════════════════════════╝
        `);
    });
}

module.exports = app;
