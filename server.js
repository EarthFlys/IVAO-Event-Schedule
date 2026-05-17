const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MongoDB (Serverless-safe connection pooling) ──────────────
const MONGO_URI = process.env.MONGODB_URI;

// Cache client across warm invocations on Vercel
let cachedClient = null;

async function getClient() {
    if (cachedClient) return cachedClient;
    if (!MONGO_URI) throw new Error('MONGODB_URI environment variable is not set');
    const client = new MongoClient(MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        maxPoolSize: 10,
    });
    await client.connect();
    cachedClient = client;
    console.log('✅ Connected to MongoDB');
    return client;
}

async function getCollection() {
    const client = await getClient();
    return client.db('ivao-events').collection('events');
}

// ─── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/image', express.static(path.join(__dirname, 'image')));

// ─── Health Check ──────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── OAuth Proxy ───────────────────────────────────────────────
app.post('/api/auth/token', async (req, res) => {
    const { code, code_verifier, redirect_uri } = req.body;
    const CLIENT_ID = process.env.IVAO_CLIENT_ID || '69a4c5c9-6472-45d0-8f41-6d3f0ed4a3f1';
    const CLIENT_SECRET = process.env.IVAO_CLIENT_SECRET || 'OPP8KbifqyND9tYRBnTqnAEwtmcXD492';

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

app.get('/api/atc/bookings/me', async (req, res) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const response = await fetch('https://api.ivao.aero/v2/users/me/atc/bookings', {
            headers: { 'Authorization': token }
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch your bookings' });
    }
});

app.post('/api/atc/bookings', async (req, res) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const response = await fetch('https://api.ivao.aero/v2/atc/bookings', {
            method: 'POST',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await response.json();
        if (!response.ok) return res.status(response.status).json(data);
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create ATC booking' });
    }
});

app.delete('/api/atc/bookings/:id', async (req, res) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ error: 'Not authenticated' });
    try {
        const response = await fetch(`https://api.ivao.aero/v2/atc/bookings/${req.params.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': token }
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
        const col = await getCollection();
        const { type, status, search } = req.query;

        const query = {};
        if (type && type !== 'all') query.type = type;
        if (search) {
            const q = new RegExp(search, 'i');
            query.$or = [
                { title: q },
                { departureIcao: q },
                { arrivalIcao: q },
                { description: q }
            ];
        }

        let events = await col.find(query).toArray();

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

        // Remove MongoDB _id from response
        events = events.map(({ _id, ...e }) => e);

        res.json(events);
    } catch (err) {
        console.error('GET /api/events error:', err);
        res.status(500).json({ error: 'Failed to fetch events', detail: err.message });
    }
});

app.get('/api/events/:id', async (req, res) => {
    try {
        const col = await getCollection();
        const event = await col.findOne({ id: req.params.id });
        if (!event) return res.status(404).json({ error: 'Event not found' });
        const { _id, ...e } = event;
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch event' });
    }
});

app.post('/api/events', async (req, res) => {
    try {
        const col = await getCollection();
        const newEvent = {
            id: uuidv4(),
            ...req.body,
            createdAt: new Date().toISOString(),
        };
        await col.insertOne(newEvent);
        const { _id, ...e } = newEvent;
        res.status(201).json(e);
    } catch (err) {
        console.error('POST /api/events error:', err);
        res.status(500).json({ error: 'Failed to create event' });
    }
});

app.put('/api/events/:id', async (req, res) => {
    try {
        const col = await getCollection();
        const update = { ...req.body, id: req.params.id };
        delete update._id;

        const result = await col.findOneAndUpdate(
            { id: req.params.id },
            { $set: update },
            { returnDocument: 'after' }
        );

        if (!result) return res.status(404).json({ error: 'Event not found' });
        const { _id, ...e } = result;
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update event' });
    }
});

app.delete('/api/events/:id', async (req, res) => {
    try {
        const col = await getCollection();
        const result = await col.deleteOne({ id: req.params.id });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete event' });
    }
});

app.post('/api/events/:id/book', async (req, res) => {
    try {
        const col = await getCollection();
        const event = await col.findOne({ id: req.params.id });
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const { slotIndex, userId, userName } = req.body;
        if (slotIndex < 0 || slotIndex >= event.slots.length)
            return res.status(400).json({ error: 'Invalid slot index' });
        if (event.slots[slotIndex].userId)
            return res.status(400).json({ error: 'Slot already booked' });

        event.slots[slotIndex].userId = String(userId);
        event.slots[slotIndex].userName = userName;

        await col.updateOne({ id: req.params.id }, { $set: { slots: event.slots } });
        const { _id, ...e } = event;
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: 'Failed to book slot' });
    }
});

app.post('/api/events/:id/unbook', async (req, res) => {
    try {
        const col = await getCollection();
        const event = await col.findOne({ id: req.params.id });
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const { slotIndex, userId } = req.body;
        if (slotIndex < 0 || slotIndex >= event.slots.length)
            return res.status(400).json({ error: 'Invalid slot index' });
        if (String(event.slots[slotIndex].userId) !== String(userId))
            return res.status(403).json({ error: 'Not your booking' });

        event.slots[slotIndex].userId = null;
        event.slots[slotIndex].userName = null;

        await col.updateOne({ id: req.params.id }, { $set: { slots: event.slots } });
        const { _id, ...e } = event;
        res.json(e);
    } catch (err) {
        res.status(500).json({ error: 'Failed to unbook slot' });
    }
});

// ─── Stats ─────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
    try {
        const col = await getCollection();
        const events = await col.find({}).toArray();
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
  ║   📦 Backend API ready                       ║
  ╚══════════════════════════════════════════════╝
        `);
    });
}

module.exports = app;
