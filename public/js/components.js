/* ═══════════════════════════════════════════════════════════════
   components.js — Reusable UI Components
   ═══════════════════════════════════════════════════════════════ */

const Components = (() => {

    function eventCard(event, index = 0) {
        const status = getEventStatus(event);
        const stats = getSlotStats(event.slots);
        const delay = index * 0.06;

        return `
            <article class="event-card" style="animation-delay:${delay}s">
                <div class="event-card-img-wrap">
                    <img src="${escapeHtml(event.imageUrl || '/image/hero_banner.png')}" 
                         alt="${escapeHtml(event.title)}"
                         onerror="this.src='/image/hero_banner.png'">
                    <div class="event-card-route">
                        <i data-lucide="plane-takeoff"></i>
                        ${escapeHtml(event.departureIcao)} → ${escapeHtml(event.arrivalIcao)}
                    </div>
                </div>
                <div class="event-card-body">
                    <div class="event-card-meta">
                        <span class="status-pill ${status}"><span class="dot"></span>${getStatusLabel(status)}</span>
                        <span class="type-badge">${escapeHtml(event.type)}</span>
                    </div>
                    <h3 class="event-card-title">${escapeHtml(event.title)}</h3>
                    <p class="event-card-desc">${escapeHtml(event.description)}</p>
                    <div class="event-card-info">
                        <div class="event-card-info-row">
                            <i data-lucide="calendar"></i>
                            <span>${formatDateRange(event.dateStart, event.dateEnd)}</span>
                        </div>
                        <div class="event-card-info-row">
                            <i data-lucide="clock"></i>
                            <span>${status === 'upcoming' ? 'Starts in ' + timeUntil(event.dateStart) : status === 'live' ? 'Ends in ' + timeUntil(event.dateEnd) : 'Event ended'}</span>
                        </div>
                    </div>
                    <div class="slots-mini">
                        <div class="slots-mini-bar">
                            <div class="slots-mini-fill" style="width:${stats.pct}%"></div>
                        </div>
                        <span class="slots-mini-label">${stats.booked}/${stats.total} slots</span>
                    </div>
                </div>
                <div class="event-card-footer">
                    <button class="btn btn-primary btn-sm btn-full" onclick="navigateTo('/event/${event.id}')">
                        <i data-lucide="eye"></i> View Details
                    </button>
                    ${window.IVAOAuth && window.IVAOAuth.isStaff() ? `<button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); App.deleteEvent('${event.id}')" title="Delete Event (Staff only)">
                        <i data-lucide="trash-2"></i>
                    </button>` : ''}
                </div>
            </article>`;
    }

    function statsBar(stats) {
        return `
            <div class="stats-bar">
                <div class="stat-card total">
                    <div class="stat-icon-wrap blue"><i data-lucide="calendar-range"></i></div>
                    <div class="stat-body"><div class="stat-value">${stats.total}</div><div class="stat-label">Total Events</div></div>
                </div>
                <div class="stat-card upcoming">
                    <div class="stat-icon-wrap yellow"><i data-lucide="clock"></i></div>
                    <div class="stat-body"><div class="stat-value">${stats.upcoming}</div><div class="stat-label">Upcoming</div></div>
                </div>
                <div class="stat-card live">
                    <div class="stat-icon-wrap green"><i data-lucide="radio"></i></div>
                    <div class="stat-body"><div class="stat-value">${stats.live}</div><div class="stat-label">Live Now</div></div>
                </div>
                <div class="stat-card done">
                    <div class="stat-icon-wrap gray"><i data-lucide="check-circle-2"></i></div>
                    <div class="stat-body"><div class="stat-value">${stats.completed}</div><div class="stat-label">Completed</div></div>
                </div>
            </div>`;
    }

    function filterBar(activeType, activeStatus) {
        activeType = activeType || 'all';
        activeStatus = activeStatus || 'all';
        const types = ['all', 'Division Event', 'HQ Event', 'International Event', 'Special Operation'];
        return `
            <div class="filter-bar">
                <div class="filter-bar-left">
                    ${types.map(t => `<button class="filter-btn ${t === activeType ? 'active' : ''}" onclick="App.setFilter('type', '${t}')">${t === 'all' ? 'All Types' : t}</button>`).join('')}
                </div>
                <div class="filter-bar-right">
                    <select class="select-input" id="filter-status" onchange="App.setFilter('status', this.value)">
                        <option value="all" ${activeStatus === 'all' ? 'selected' : ''}>All Status</option>
                        <option value="upcoming" ${activeStatus === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                        <option value="live" ${activeStatus === 'live' ? 'selected' : ''}>Live</option>
                        <option value="completed" ${activeStatus === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                    <input type="text" class="search-input" id="filter-search" placeholder="Search events..." oninput="App.setFilter('search', this.value)">
                </div>
            </div>`;
    }

    function emptyState(message, desc) {
        message = message || 'No events found';
        desc = desc || 'Check back later for new events.';
        return `
            <div class="empty-state">
                <div class="empty-state-icon"><i data-lucide="calendar-off"></i></div>
                <h3 class="empty-state-title">${message}</h3>
                <p class="empty-state-desc">${desc}</p>
            </div>`;
    }

    function skeletonCards(count) {
        count = count || 3;
        let html = '<div class="events-grid">';
        for (let i = 0; i < count; i++) {
            html += '<div class="event-card"><div class="skeleton" style="height:180px;border-radius:0;"></div><div style="padding:18px;"><div class="skeleton" style="height:14px;width:40%;margin-bottom:10px;"></div><div class="skeleton" style="height:18px;width:80%;margin-bottom:8px;"></div><div class="skeleton" style="height:14px;width:100%;margin-bottom:6px;"></div><div class="skeleton" style="height:36px;width:100%;margin-top:16px;"></div></div></div>';
        }
        html += '</div>';
        return html;
    }

    function slotRow(slot, index) {
        slot = slot || { position: '', type: 'ATC' };
        index = index || 0;
        return `
            <div class="slot-row" data-slot-index="${index}">
                <input type="text" class="form-input slot-row-input" placeholder="Position (e.g. VTBD_TWR)" name="slot_position_${index}" value="${escapeHtml(slot.position || '')}">
                <select class="form-input slot-row-type" name="slot_type_${index}">
                    <option value="ATC" ${slot.type === 'ATC' ? 'selected' : ''}>ATC</option>
                    <option value="Pilot" ${slot.type === 'Pilot' ? 'selected' : ''}>Pilot</option>
                </select>
                <button type="button" class="slot-row-remove" onclick="this.closest('.slot-row').remove()"><i data-lucide="x"></i></button>
            </div>`;
    }

    return {
        eventCard,
        statsBar,
        filterBar,
        emptyState,
        skeletonCards,
        slotRow
    };
})();

window.Components = Components;
console.log('✅ components.js loaded');
