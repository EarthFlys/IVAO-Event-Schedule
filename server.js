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
        throw new Error('Missing Firebase environment variables');
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

// ─── Security / Middleware ─────────────────────────────────────
const allowedOrigins = [
    'http://localhost:3000',
    'https://ivao-th-event.vercel.app'
];

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        return callback(new Error('CORS blocked'));
    }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/image', express.static(path.join(__dirname, 'image')));

async function requireAuth(req, res, next) {
    const token = req.headers.authorization;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const response = await fetch('https://api.ivao.aero/v2/users/me', {
            headers: { Authorization: token }
        });

        if (!response.ok) {
            return res.status(401).json({ error: 'Invalid IVAO token' });
        }

        const user = await response.json();
        req.user = user;
        next();
    } catch (err) {
        console.error('Auth middleware error:', err);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

function validateEventPayload(req, res, next) {
    const { title, dateStart, dateEnd } = req.body;

    if (!title || !dateStart || !dateEnd) {
        return res.status(400).json({
            error: 'Missing required fields: title, dateStart, dateEnd'
        });
    }

    next();
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

// ─── Events API ────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
    try {
        const snapshot = await eventsCol().get();
        const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        events.sort((a, b) => new Date(a.dateStart) - new Date(b.dateStart));
        res.json(events);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

app.post('/api/events', requireAuth, validateEventPayload, async (req, res) => {
    try {
        const id = uuidv4();

        const newEvent = {
            ...req.body,
            createdAt: new Date().toISOString(),
            createdBy: {
                id: req.user?.id || null,
                name: req.user?.firstName || 'Unknown'
            }
        };

        await eventsCol().doc(id).set(newEvent);
        res.status(201).json({ id, ...newEvent });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

app.put('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const ref = eventsCol().doc(req.params.id);
        const doc = await ref.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Event not found' });
        }

        await ref.set({
            ...req.body,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        const updated = await ref.get();
        res.json({ id: updated.id, ...updated.data() });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to update event' });
    }
});

app.delete('/api/events/:id', requireAuth, async (req, res) => {
    try {
        const ref = eventsCol().doc(req.params.id);
        const doc = await ref.get();

        if (!doc.exists) {
            return res.status(404).json({ error: 'Event not found' });
        }

        await ref.delete();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

app.post('/api/events/:id/book', requireAuth, async (req, res) => {
    try {
        const ref = eventsCol().doc(req.params.id);
        const { slotIndex } = req.body;

        await getDB().runTransaction(async transaction => {
            const doc = await transaction.get(ref);

            if (!doc.exists) {
                throw new Error('Event not found');
            }

            const event = doc.data();

            if (!event.slots || slotIndex < 0 || slotIndex >= event.slots.length) {
                throw new Error('Invalid slot index');
            }

            if (event.slots[slotIndex].userId) {
                throw new Error('Slot already booked');
            }

            event.slots[slotIndex].userId = String(req.user.id);
            event.slots[slotIndex].userName = req.user.firstName || 'Unknown';

            transaction.update(ref, {
                slots: event.slots,
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(400).json({ error: err.message || 'Booking failed' });
    }
});

// ─── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    try {
        const snapshot = await eventsCol().get();
        const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        res.json({
            total: events.length,
            totalSlots: events.reduce((sum, e) => sum + (e.slots?.length || 0), 0)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ─── SPA Fallback ──────────────────────────────────────────────
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server running on ${PORT}`);
    });
}

module.exports = app;
