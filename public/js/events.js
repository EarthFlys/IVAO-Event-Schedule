/* ═══════════════════════════════════════════════════════════════
   events.js — Events API Client
   ═══════════════════════════════════════════════════════════════ */

const EventsAPI = (() => {
    const BASE = '/api';

    // ── Fetch helpers ──────────────────────────────────────────
    async function request(url, options = {}) {
        try {
            const token = IVAOAuth.getToken();
            const res = await fetch(url, {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                    ...options.headers
                }
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || `Request failed (${res.status})`);
            }

            return data;
        } catch (err) {
            console.error(`API Error [${url}]:`, err);
            throw err;
        }
    }

    // ── Events CRUD ────────────────────────────────────────────

    async function getAll(filters = {}) {
        const params = new URLSearchParams();
        if (filters.type && filters.type !== 'all') params.set('type', filters.type);
        if (filters.status && filters.status !== 'all') params.set('status', filters.status);
        if (filters.search) params.set('search', filters.search);

        const qs = params.toString();
        return request(`${BASE}/events${qs ? '?' + qs : ''}`);
    }

    async function getById(id) {
        return request(`${BASE}/events/${id}`);
    }

    async function create(eventData) {
        const user = IVAOAuth.getUser();
        return request(`${BASE}/events`, {
            method: 'POST',
            body: JSON.stringify({
                ...eventData,
                createdBy: user?.vid || 'unknown',
                createdByName: user ? `${user.firstName} ${user.lastName}` : 'Unknown'
            })
        });
    }

    async function update(id, eventData) {
        return request(`${BASE}/events/${id}`, {
            method: 'PUT',
            body: JSON.stringify(eventData)
        });
    }

    async function remove(id) {
        return request(`${BASE}/events/${id}`, {
            method: 'DELETE'
        });
    }

    // ── Slot Booking ───────────────────────────────────────────

    async function bookSlot(eventId, slotIndex) {
        const user = IVAOAuth.getUser();
        if (!user) throw new Error('You must be logged in to book a slot');

        return request(`${BASE}/events/${eventId}/book`, {
            method: 'POST',
            body: JSON.stringify({
                slotIndex,
                userId: String(user.vid),
                userName: `${user.firstName} ${user.lastName}`
            })
        });
    }

    async function unbookSlot(eventId, slotIndex) {
        const user = IVAOAuth.getUser();
        if (!user) throw new Error('You must be logged in');

        return request(`${BASE}/events/${eventId}/unbook`, {
            method: 'POST',
            body: JSON.stringify({
                slotIndex,
                userId: String(user.vid)
            })
        });
    }

    // ── Stats ──────────────────────────────────────────────────
    async function getStats() {
        return request(`${BASE}/stats`);
    }

    // ── ATC Booking (from atc.ivao.aero) ─────────────────────────

    async function getATCBookings(params = {}) {
        const token = IVAOAuth.getToken();
        const qs = new URLSearchParams(params).toString();
        return request(`${BASE}/atc/bookings${qs ? '?' + qs : ''}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
    }

    async function getMyATCBookings() {
        const token = IVAOAuth.getToken();
        if (!token) throw new Error('Not authenticated');
        return request(`${BASE}/atc/bookings/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
    }

    async function createATCBooking(bookingData) {
        const token = IVAOAuth.getToken();
        if (!token) throw new Error('Not authenticated');
        return request(`${BASE}/atc/bookings`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: JSON.stringify(bookingData)
        });
    }

    async function deleteATCBooking(bookingId) {
        const token = IVAOAuth.getToken();
        if (!token) throw new Error('Not authenticated');
        return request(`${BASE}/atc/bookings/${bookingId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        getAll,
        getById,
        create,
        update,
        remove,
        bookSlot,
        unbookSlot,
        getStats,
        getATCBookings,
        getMyATCBookings,
        createATCBooking,
        deleteATCBooking
    };
})();

window.EventsAPI = EventsAPI;

console.log('✅ events.js loaded');
