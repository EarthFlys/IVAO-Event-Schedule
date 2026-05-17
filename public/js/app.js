/* ═══════════════════════════════════════════════════════════════
   app.js — Main Application, Router & Controller
   ═══════════════════════════════════════════════════════════════ */

const App = (() => {
    let filters = { type: 'all', status: 'all', search: '' };
    const searchDebounced = debounce(() => loadDashboard(), 300);

    // ── Router ─────────────────────────────────────────────────
    async function route() {
        const hash = window.location.hash.slice(1) || '/';
        const app = document.getElementById('app');
        if (!app) return;

        // Close mobile menu
        const navLinks = document.getElementById('nav-links');
        if (navLinks) navLinks.classList.remove('open');

        // Update active nav link
        document.querySelectorAll('.nav-link').forEach(link => {
            const page = link.dataset.page;
            link.classList.toggle('active',
                (page === 'dashboard' && (hash === '/' || hash === '')) ||
                (page === 'calendar' && hash === '/calendar') ||
                (page === 'atc-booking' && hash === '/atc-booking') ||
                (page === 'create' && hash === '/create')
            );
        });

        // Route matching
        if (hash === '/' || hash === '') {
            app.innerHTML = await renderDashboard();
        } else if (hash === '/calendar') {
            app.innerHTML = await CalendarView.render();
        } else if (hash === '/atc-booking') {
            app.innerHTML = await renderATCBooking();
        } else if (hash === '/create') {
            if (!IVAOAuth.isStaff()) {
                showToast('Only Event Staff can create events', 'warning');
                navigateTo('/');
                return;
            }
            app.innerHTML = renderCreateForm();
        } else if (hash.startsWith('/edit/')) {
            if (!IVAOAuth.isStaff()) {
                showToast('Only Event Staff can edit events', 'warning');
                navigateTo('/');
                return;
            }
            const id = hash.replace('/edit/', '');
            app.innerHTML = await renderEditForm(id);
        } else if (hash.startsWith('/event/')) {
            const id = hash.replace('/event/', '');
            app.innerHTML = await renderEventDetail(id);
        } else {
            app.innerHTML = Components.emptyState('Page Not Found', 'The page you are looking for does not exist.');
        }

        if (window.lucide) lucide.createIcons();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ── Dashboard ──────────────────────────────────────────────
    async function renderDashboard() {
        let statsHtml = '';
        let eventsHtml = Components.skeletonCards(3);

        try {
            const stats = await EventsAPI.getStats();
            statsHtml = Components.statsBar(stats);
        } catch (e) {
            statsHtml = '';
        }

        try {
            const events = await EventsAPI.getAll(filters);
            eventsHtml = events.length === 0
                ? Components.emptyState('No events found', 'Check back later for upcoming events.')
                : '<div class="events-grid">' + events.map((ev, i) => Components.eventCard(ev, i)).join('') + '</div>';
        } catch (e) {
            eventsHtml = Components.emptyState('Error loading events', e.message);
        }

        return `
            <section class="page-hero">
                <div class="container">
                    <h1 class="page-hero-title">Event Dashboard</h1>
                    <p class="page-hero-sub">Browse and manage upcoming IVAO Thailand events</p>
                </div>
            </section>
            <div class="container page-wrapper">
                ${statsHtml}
                ${Components.filterBar(filters.type, filters.status)}
                <div id="events-container">${eventsHtml}</div>
            </div>`;
    }

    async function loadDashboard() {
        const container = document.getElementById('events-container');
        if (!container) return;
        container.innerHTML = Components.skeletonCards(3);
        try {
            const events = await EventsAPI.getAll(filters);
            container.innerHTML = events.length === 0
                ? Components.emptyState()
                : '<div class="events-grid">' + events.map((ev, i) => Components.eventCard(ev, i)).join('') + '</div>';
        } catch (e) {
            container.innerHTML = Components.emptyState('Error', e.message);
        }
        if (window.lucide) lucide.createIcons();
    }

    // ── Event Detail ───────────────────────────────────────────
    async function renderEventDetail(id) {
        try {
            const event = await EventsAPI.getById(id);
            return renderDetailHtml(event);
        } catch (e) {
            return Components.emptyState('Event not found', 'This event may have been deleted.');
        }
    }

    function renderDetailHtml(event) {
        const status = getEventStatus(event);
        const stats = getSlotStats(event.slots);
        const user = IVAOAuth.getUser();

        const slotsRows = event.slots.map((slot, i) => {
            const isMySlot = user && String(slot.userId) === String(user.vid);
            const isBooked = !!slot.userId;
            let actionHtml = '';

            if (user) {
                if (isMySlot) {
                    actionHtml = `<button class="btn btn-danger btn-sm" onclick="App.unbookSlot('${event.id}',${i})">
                        <i data-lucide="x"></i> Cancel</button>`;
                } else if (!isBooked) {
                    actionHtml = `<button class="btn btn-success btn-sm" onclick="App.bookSlot('${event.id}',${i})">
                        <i data-lucide="check"></i> Book</button>`;
                }
            } else if (!isBooked) {
                actionHtml = '<span class="text-muted" style="font-size:.78rem;">Login to book</span>';
            }

            const assignedHtml = isBooked
                ? `<div class="slot-user">
                     <div class="slot-avatar">${escapeHtml((slot.userName || '??')[0])}</div>
                     <span class="slot-name">${escapeHtml(slot.userName)}</span>
                   </div>`
                : '<span class="slot-empty">Available</span>';
            const typeClass = slot.type.toLowerCase() === 'atc' ? 'atc' : 'pilot';

            return `<tr>
                <td style="color:var(--text-muted);font-size:.78rem;">${i + 1}</td>
                <td><span class="slot-position">${escapeHtml(slot.position)}</span></td>
                <td><span class="slot-type-${typeClass}">${escapeHtml(slot.type)}</span></td>
                <td>${assignedHtml}</td>
                <td>${actionHtml}</td>
            </tr>`;
        }).join('');

        const adminHtml = IVAOAuth.isStaff() ? `
            <div class="detail-card">
                <div class="detail-card-title"><i data-lucide="settings"></i> Staff Actions</div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    <button class="btn btn-secondary btn-full" onclick="navigateTo('/edit/${event.id}')">
                        <i data-lucide="pencil"></i> Edit Event
                    </button>
                    <button class="btn btn-danger btn-full" onclick="App.deleteEvent('${event.id}')">
                        <i data-lucide="trash-2"></i> Delete Event
                    </button>
                </div>
            </div>` : '';

        return `
            <div class="event-detail-hero">
                <img src="${escapeHtml(event.imageUrl || '/image/hero_banner.png')}"
                     alt="${escapeHtml(event.title)}"
                     onerror="this.src='/image/hero_banner.png'">
                <div class="event-detail-hero-overlay"></div>
                <div class="event-detail-hero-content">
                    <div class="container">
                        <div class="event-card-meta" style="margin-bottom:10px;">
                            <span class="status-pill ${status}"><span class="dot"></span>${getStatusLabel(status)}</span>
                            <span class="type-badge">${escapeHtml(event.type)}</span>
                        </div>
                        <h1 class="event-detail-title">${escapeHtml(event.title)}</h1>
                        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
                            <span class="event-card-info-row" style="color:rgba(255,255,255,.65);">
                                <i data-lucide="calendar"></i>${formatDateRange(event.dateStart, event.dateEnd)}
                            </span>
                            <span class="event-card-info-row" style="color:rgba(255,255,255,.65);">
                                <i data-lucide="plane"></i>${escapeHtml(event.departureIcao)} → ${escapeHtml(event.arrivalIcao)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            <div class="container">
                <div class="event-detail-layout">
                    <div>
                        <div class="detail-card">
                            <div class="detail-card-title"><i data-lucide="file-text"></i> Description</div>
                            <p style="font-size:.9rem;color:var(--text-secondary);line-height:1.75;">${escapeHtml(event.description)}</p>
                        </div>
                        <div class="detail-card">
                            <div class="detail-card-title">
                                <i data-lucide="users"></i> Slots
                                <span style="margin-left:auto;font-size:.75rem;background:var(--blue-bg);color:var(--ivao-accent);border:1px solid var(--border-blue);padding:2px 9px;border-radius:99px;font-weight:600;">
                                    ${stats.booked}/${stats.total} booked
                                </span>
                            </div>
                            <div style="margin-bottom:14px;">
                                <div class="slots-mini-bar" style="height:6px;">
                                    <div class="slots-mini-fill" style="width:${stats.pct}%"></div>
                                </div>
                            </div>
                            <table class="slots-table">
                                <thead>
                                    <tr>
                                        <th>#</th>
                                        <th>Position</th>
                                        <th>Type</th>
                                        <th>Assigned</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>${slotsRows}</tbody>
                            </table>
                        </div>
                    </div>
                    <div>
                        <div class="detail-card">
                            <div class="detail-card-title"><i data-lucide="info"></i> Event Info</div>
                            <div class="info-grid">
                                <div class="info-item">
                                    <span class="info-label">Type</span>
                                    <span class="info-value">${escapeHtml(event.type)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Status</span>
                                    <span class="info-value">${getStatusLabel(status)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Departure</span>
                                    <span class="info-value font-mono">${escapeHtml(event.departureIcao)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Arrival</span>
                                    <span class="info-value font-mono">${escapeHtml(event.arrivalIcao)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">Start (UTC)</span>
                                    <span class="info-value">${formatDateTime(event.dateStart)}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">End (UTC)</span>
                                    <span class="info-value">${formatDateTime(event.dateEnd)}</span>
                                </div>
                                <div class="info-item" style="grid-column:1/-1;">
                                    <span class="info-label">Created By</span>
                                    <span class="info-value">${escapeHtml(event.createdByName || 'Unknown')}</span>
                                </div>
                            </div>
                        </div>
                        ${adminHtml}
                        <button class="btn btn-ghost btn-full" onclick="navigateTo('/')" style="margin-top:4px;">
                            <i data-lucide="arrow-left"></i> Back to Dashboard
                        </button>
                    </div>
                </div>
            </div>`;
    }

    // ── Create / Edit Form ─────────────────────────────────────
    function renderCreateForm() { return renderFormHtml(null); }

    async function renderEditForm(id) {
        try {
            const event = await EventsAPI.getById(id);
            return renderFormHtml(event);
        } catch (e) {
            return Components.emptyState('Event not found');
        }
    }

    function renderFormHtml(event) {
        const isEdit = !!event;
        const title = isEdit ? 'Edit Event' : 'Create New Event';
        const slots = event ? event.slots : [{ position: '', type: 'ATC' }, { position: '', type: 'Pilot' }];
        const slotsHtml = slots.map((s, i) => Components.slotRow(s, i)).join('');

        return `
            <section class="page-hero">
                <div class="container">
                    <h1 class="page-hero-title">${title}</h1>
                    <p class="page-hero-sub">${isEdit ? 'Update event details' : 'Fill in the details to create a new event'}</p>
                </div>
            </section>
            <div class="container page-wrapper">
                <form id="event-form" onsubmit="App.handleFormSubmit(event, ${isEdit ? "'" + event.id + "'" : 'null'})">
                    <div class="form-card">
                        <div class="form-card-title"><i data-lucide="file-text"></i> Event Details</div>
                        <div class="form-grid">
                            <div class="form-group full">
                                <label class="form-label">Title <span class="required">*</span></label>
                                <input type="text" class="form-input" name="title" required
                                    placeholder="e.g. Thailand Division RFE"
                                    value="${escapeHtml(event?.title || '')}">
                            </div>
                            <div class="form-group full">
                                <label class="form-label">Description <span class="required">*</span></label>
                                <textarea class="form-input" name="description" required
                                    placeholder="Event description...">${escapeHtml(event?.description || '')}</textarea>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Type <span class="required">*</span></label>
                                <select class="form-input" name="type" required>
                                    <option value="Division Event" ${event?.type === 'Division Event' ? 'selected' : ''}>Division Event</option>
                                    <option value="HQ Event" ${event?.type === 'HQ Event' ? 'selected' : ''}>HQ Event</option>
                                    <option value="International Event" ${event?.type === 'International Event' ? 'selected' : ''}>International Event</option>
                                    <option value="Special Operation" ${event?.type === 'Special Operation' ? 'selected' : ''}>Special Operation</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Image URL</label>
                                <input type="text" class="form-input" name="imageUrl"
                                    placeholder="/image/hero_banner.png"
                                    value="${escapeHtml(event?.imageUrl || '/image/hero_banner.png')}">
                                <span class="form-hint">URL for event banner image</span>
                            </div>
                        </div>
                    </div>
                    <div class="form-card">
                        <div class="form-card-title"><i data-lucide="plane"></i> Route & Schedule</div>
                        <div class="form-grid">
                            <div class="form-group">
                                <label class="form-label">Departure ICAO <span class="required">*</span></label>
                                <input type="text" class="form-input font-mono" name="departureIcao" required
                                    placeholder="VTBD" maxlength="4" style="text-transform:uppercase;"
                                    value="${escapeHtml(event?.departureIcao || '')}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Arrival ICAO <span class="required">*</span></label>
                                <input type="text" class="form-input font-mono" name="arrivalIcao" required
                                    placeholder="VTBS" maxlength="4" style="text-transform:uppercase;"
                                    value="${escapeHtml(event?.arrivalIcao || '')}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Start Date/Time (UTC) <span class="required">*</span></label>
                                <input type="datetime-local" class="form-input" name="dateStart" required
                                    value="${event ? event.dateStart.slice(0, 16) : ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">End Date/Time (UTC) <span class="required">*</span></label>
                                <input type="datetime-local" class="form-input" name="dateEnd" required
                                    value="${event ? event.dateEnd.slice(0, 16) : ''}">
                            </div>
                        </div>
                    </div>
                    <div class="form-card">
                        <div class="form-card-title"><i data-lucide="users"></i> Slots</div>
                        <div class="slot-builder" id="slot-builder">${slotsHtml}</div>
                        <button type="button" class="add-slot-btn" onclick="App.addSlotRow()" style="margin-top:10px;">
                            <i data-lucide="plus"></i> Add Slot
                        </button>
                    </div>
                    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px;">
                        <button type="button" class="btn btn-ghost" onclick="navigateTo('/')">Cancel</button>
                        <button type="submit" class="btn btn-primary btn-lg">
                            <i data-lucide="${isEdit ? 'save' : 'plus-circle'}"></i>
                            ${isEdit ? 'Save Changes' : 'Create Event'}
                        </button>
                    </div>
                </form>
            </div>`;
    }

    // ── Filter ─────────────────────────────────────────────────
    function setFilter(key, value) {
        filters[key] = value;
        if (key === 'search') {
            searchDebounced();
        } else {
            loadDashboard();
            if (key === 'type') {
                document.querySelectorAll('.filter-btn').forEach(btn => {
                    const btnText = btn.textContent.trim();
                    const btnType = btnText === 'All Types' ? 'all' : btnText;
                    btn.classList.toggle('active', btnType === value);
                });
            }
        }
    }

    // ── Slot Booking ───────────────────────────────────────────
    async function bookSlot(eventId, slotIndex) {
        try {
            await EventsAPI.bookSlot(eventId, slotIndex);
            showToast('Slot booked!', 'success');
            route();
        } catch (e) {
            showToast('Failed to book: ' + e.message, 'error');
        }
    }

    async function unbookSlot(eventId, slotIndex) {
        try {
            await EventsAPI.unbookSlot(eventId, slotIndex);
            showToast('Booking cancelled', 'info');
            route();
        } catch (e) {
            showToast('Failed to cancel: ' + e.message, 'error');
        }
    }

    // ── Delete Event ───────────────────────────────────────────
    function deleteEvent(id) {
        openModal(`
            <div class="modal-header">
                <h3 class="modal-title">Delete Event</h3>
                <button class="modal-close" onclick="closeModal(event)"><i data-lucide="x"></i></button>
            </div>
            <div class="modal-body">
                <p style="color:var(--text-secondary);font-size:.9rem;line-height:1.6;">
                    Are you sure you want to delete this event? This action cannot be undone.
                </p>
            </div>
            <div class="modal-footer">
                <button class="btn btn-ghost" onclick="closeModal(event)">Cancel</button>
                <button class="btn btn-danger" onclick="App.confirmDelete('${id}')">
                    <i data-lucide="trash-2"></i> Delete
                </button>
            </div>
        `);
    }

    async function confirmDelete(id) {
        try {
            await EventsAPI.remove(id);
            const overlay = document.getElementById('modal-overlay');
            if (overlay) { overlay.classList.remove('active'); document.body.style.overflow = ''; }
            showToast('Event deleted', 'success');
            navigateTo('/');
        } catch (e) {
            showToast('Delete failed: ' + e.message, 'error');
        }
    }

    // ── Form Submit ────────────────────────────────────────────
    async function handleFormSubmit(e, editId) {
        e.preventDefault();
        const form = document.getElementById('event-form');
        if (!form) return;

        const formData = new FormData(form);
        const slotRows = document.querySelectorAll('.slot-row');
        const slots = [];

        slotRows.forEach(row => {
            const pos = row.querySelector('input[name^="slot_position"]')?.value?.trim();
            const type = row.querySelector('select[name^="slot_type"]')?.value || 'ATC';
            if (pos) slots.push({ position: pos, type, userId: null, userName: null });
        });

        if (slots.length === 0) {
            showToast('Please add at least one slot', 'warning');
            return;
        }

        const eventData = {
            title: formData.get('title'),
            description: formData.get('description'),
            type: formData.get('type'),
            imageUrl: formData.get('imageUrl') || '/image/hero_banner.png',
            departureIcao: (formData.get('departureIcao') || '').toUpperCase(),
            arrivalIcao: (formData.get('arrivalIcao') || '').toUpperCase(),
            dateStart: new Date(formData.get('dateStart')).toISOString(),
            dateEnd: new Date(formData.get('dateEnd')).toISOString(),
            slots
        };

        const btn = form.querySelector('[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

        try {
            if (editId) {
                await EventsAPI.update(editId, eventData);
                showToast('Event updated!', 'success');
                navigateTo('/event/' + editId);
            } else {
                const created = await EventsAPI.create(eventData);
                showToast('Event created!', 'success');
                navigateTo('/event/' + created.id);
            }
        } catch (e) {
            showToast('Failed: ' + e.message, 'error');
            if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="${editId ? 'save' : 'plus-circle'}"></i> ${editId ? 'Save Changes' : 'Create Event'}`; }
            if (window.lucide) lucide.createIcons();
        }
    }

    // ── Add Slot Row ───────────────────────────────────────────
    function addSlotRow() {
        const builder = document.getElementById('slot-builder');
        if (!builder) return;
        const idx = builder.querySelectorAll('.slot-row').length;
        builder.insertAdjacentHTML('beforeend', Components.slotRow({ position: '', type: 'ATC' }, idx));
        if (window.lucide) lucide.createIcons();
    }

    // ── ATC Booking Page ───────────────────────────────────────
    async function renderATCBooking() {
        const user = IVAOAuth.getUser();
        let myBookingsHtml = '';

        if (user) {
            try {
                const myBookings = await EventsAPI.getMyATCBookings();
                if (Array.isArray(myBookings) && myBookings.length > 0) {
                    myBookingsHtml = `
                        <div class="detail-card section-gap">
                            <div class="detail-card-title"><i data-lucide="user"></i> My Bookings</div>
                            <table class="slots-table">
                                <thead>
                                    <tr><th>Position</th><th>Date</th><th>Time (UTC)</th><th>Type</th><th>Action</th></tr>
                                </thead>
                                <tbody>
                                    ${myBookings.map(b => `
                                        <tr>
                                            <td><span class="slot-position">${escapeHtml(b.atcCallsign || b.position || 'N/A')}</span></td>
                                            <td style="font-size:.82rem;">${b.start ? formatDate(b.start) : 'N/A'}</td>
                                            <td style="font-size:.82rem;">${b.start ? formatTime(b.start) : ''} – ${b.end ? formatTime(b.end) : ''}</td>
                                            <td><span class="tag blue">${escapeHtml(b.type || 'Standard')}</span></td>
                                            <td><button class="btn btn-danger btn-sm" onclick="App.cancelATCBooking('${b.id}')">
                                                <i data-lucide="x"></i> Cancel
                                            </button></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>`;
                } else {
                    myBookingsHtml = `<div class="detail-card section-gap">
                        <div class="detail-card-title"><i data-lucide="user"></i> My Bookings</div>
                        <p style="color:var(--text-muted);font-size:.88rem;">You have no active ATC bookings.</p>
                    </div>`;
                }
            } catch (e) {
                myBookingsHtml = `<div class="detail-card section-gap">
                    <div class="detail-card-title"><i data-lucide="user"></i> My Bookings</div>
                    <p style="color:var(--text-muted);font-size:.88rem;">Could not load bookings: ${escapeHtml(e.message)}</p>
                </div>`;
            }
        }

        const formHtml = user ? `
            <div class="form-card section-gap">
                <div class="form-card-title"><i data-lucide="plus-circle"></i> Create ATC Booking</div>
                <form id="atc-booking-form" onsubmit="App.submitATCBooking(event)">
                    <div class="form-grid">
                        <div class="form-group">
                            <label class="form-label">ATC Position (Callsign) <span class="required">*</span></label>
                            <input type="text" class="form-input font-mono" name="atcCallsign" required
                                placeholder="e.g. VTBS_TWR" style="text-transform:uppercase;">
                            <span class="form-hint">ICAO format — e.g. VTBD_GND, VTBS_APP</span>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Booking Type</label>
                            <select class="form-input" name="type">
                                <option value="standard">Standard</option>
                                <option value="training">Training</option>
                                <option value="exam">Examination</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Start Date/Time (UTC) <span class="required">*</span></label>
                            <input type="datetime-local" class="form-input" name="start" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">End Date/Time (UTC) <span class="required">*</span></label>
                            <input type="datetime-local" class="form-input" name="end" required>
                        </div>
                    </div>
                    <div style="margin-top:16px;display:flex;justify-content:flex-end;">
                        <button type="submit" class="btn btn-primary">
                            <i data-lucide="radio-tower"></i> Book Position
                        </button>
                    </div>
                </form>
            </div>` : `
            <div class="detail-card section-gap" style="text-align:center;padding:48px 24px;">
                <i data-lucide="lock" style="width:40px;height:40px;color:var(--text-muted);margin:0 auto 14px;display:block;"></i>
                <h3 style="margin-bottom:6px;">Login Required</h3>
                <p style="color:var(--text-muted);font-size:.88rem;margin-bottom:18px;">
                    You need to log in with your IVAO account to manage ATC bookings.
                </p>
                <button class="btn btn-primary" onclick="IVAOAuth.login()">
                    <i data-lucide="log-in"></i> Login with IVAO
                </button>
            </div>`;

        return `
            <section class="page-hero">
                <div class="container">
                    <h1 class="page-hero-title">ATC Booking</h1>
                    <p class="page-hero-sub">Manage your ATC positions via IVAO ATC Service Center</p>
                </div>
            </section>
            <div class="container page-wrapper">
                <div class="atc-info-banner">
                    <i data-lucide="info"></i>
                    <span>Bookings are synced with the official IVAO ATC Service Center.
                        <a href="https://atc.ivao.aero" target="_blank" style="color:var(--ivao-accent);text-decoration:underline;">
                            Open atc.ivao.aero
                        </a> for full management.
                    </span>
                </div>
                ${myBookingsHtml}
                ${formHtml}
            </div>`;
    }

    async function submitATCBooking(e) {
        e.preventDefault();
        const form = document.getElementById('atc-booking-form');
        if (!form) return;
        const formData = new FormData(form);
        const bookingData = {
            atcCallsign: formData.get('atcCallsign').toUpperCase(),
            type: formData.get('type') || 'standard',
            start: new Date(formData.get('start')).toISOString(),
            end: new Date(formData.get('end')).toISOString()
        };
        try {
            await EventsAPI.createATCBooking(bookingData);
            showToast('ATC position booked!', 'success');
            route();
        } catch (err) {
            showToast('Booking failed: ' + err.message, 'error');
        }
    }

    async function cancelATCBooking(bookingId) {
        try {
            await EventsAPI.deleteATCBooking(bookingId);
            showToast('ATC booking cancelled', 'info');
            route();
        } catch (err) {
            showToast('Cancel failed: ' + err.message, 'error');
        }
    }

    // ── Navbar Scroll Effect ───────────────────────────────────
    function initNavScroll() {
        const navbar = document.getElementById('navbar');
        window.addEventListener('scroll', () => {
            if (navbar) navbar.classList.toggle('scrolled', window.scrollY > 10);
        }, { passive: true });
    }

    // ── Live Count (IVAO API) ─────────────────────────────────
    async function fetchLiveCount() {
        try {
            const res = await fetch('https://api.ivao.aero/v2/tracker/whazzup', {
                headers: { 'Accept': 'application/json' }
            });
            if (res.ok) {
                const data = await res.json();
                const count = data?.clients?.pilots?.length || 0;
                const el = document.getElementById('live-count');
                if (el) el.textContent = count.toLocaleString();
            }
        } catch (_) { /* silent fail */ }
    }

    // ── Init ───────────────────────────────────────────────────
    async function init() {
        initNavScroll();
        await IVAOAuth.init();
        window.addEventListener('hashchange', route);
        await route();

        const loading = document.getElementById('loading-screen');
        if (loading) setTimeout(() => loading.classList.add('hidden'), 400);

        if (window.lucide) lucide.createIcons();

        // Fetch live count
        fetchLiveCount();
        setInterval(fetchLiveCount, 60_000);
    }

    return {
        init,
        setFilter,
        bookSlot,
        unbookSlot,
        deleteEvent,
        confirmDelete,
        handleFormSubmit,
        addSlotRow,
        submitATCBooking,
        cancelATCBooking
    };
})();

function navigateTo(path) {
    window.location.hash = path;
}
window.navigateTo = navigateTo;

document.addEventListener('DOMContentLoaded', () => App.init());

console.log('✅ app.js loaded');
