/* ═══════════════════════════════════════════════════════════════
   calendar.js — Calendar View Renderer
   ═══════════════════════════════════════════════════════════════ */

const CalendarView = (() => {
    let currentYear;
    let currentMonth;
    let events = [];

    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // ── Init ───────────────────────────────────────────────────
    function init() {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
    }

    // ── Render Calendar Page ───────────────────────────────────
    async function render() {
        init();

        try {
            events = await EventsAPI.getAll();
        } catch (err) {
            events = [];
        }

        return `
            <section class="page-hero">
                <div class="container">
                    <h1 class="page-hero-title">Event Calendar</h1>
                    <p class="page-hero-sub">View all scheduled events at a glance</p>
                </div>
            </section>

            <div class="container page-wrapper">
                <div class="calendar-wrapper">
                    <div class="calendar-header">
                        <button class="calendar-nav-btn" onclick="CalendarView.prevMonth()" title="Previous month">
                            <i data-lucide="chevron-left"></i>
                        </button>
                        <h2 class="calendar-title" id="calendar-month-title">${MONTHS[currentMonth]} ${currentYear}</h2>
                        <div class="calendar-nav" style="display:flex;gap:6px;">
                            <button class="calendar-nav-btn" onclick="CalendarView.today()" title="Today" style="font-size:.75rem;width:auto;padding:0 12px;">
                                Today
                            </button>
                            <button class="calendar-nav-btn" onclick="CalendarView.nextMonth()" title="Next month">
                                <i data-lucide="chevron-right"></i>
                            </button>
                        </div>
                    </div>
                    <div class="calendar-grid" id="calendar-grid">
                        ${buildGrid()}
                    </div>
                </div>
            </div>
        `;
    }

    // ── Build Calendar Grid ────────────────────────────────────
    function buildGrid() {
        let html = '';

        // Day names header
        DAYS.forEach(d => {
            html += `<div class="calendar-day-name">${d}</div>`;
        });

        const firstDay = new Date(currentYear, currentMonth, 1).getDay();
        const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
        const prevDays = new Date(currentYear, currentMonth, 0).getDate();

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

        // Previous month filler
        for (let i = firstDay - 1; i >= 0; i--) {
            const day = prevDays - i;
            html += `<div class="calendar-day other-month">
                <div class="day-number">${day}</div>
            </div>`;
        }

        // Current month days
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${currentYear}-${currentMonth}-${d}`;
            const isToday = dateStr === todayStr;
            const dayEvents = getEventsForDay(d);

            html += `<div class="calendar-day${isToday ? ' today' : ''}" data-day="${d}">
                <div class="day-number">${d}</div>
                <div class="day-events">
                    ${dayEvents.map(ev => {
                const status = getEventStatus(ev);
                return `<div class="day-event-chip ${status}" 
                                     onclick="event.stopPropagation(); navigateTo('/event/${ev.id}')" 
                                     title="${escapeHtml(ev.title)}">
                            ${escapeHtml(ev.title)}
                        </div>`;
            }).join('')}
                </div>
            </div>`;
        }

        // Next month filler
        const totalCells = firstDay + daysInMonth;
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let i = 1; i <= remaining; i++) {
            html += `<div class="calendar-day other-month">
                <div class="day-number">${i}</div>
            </div>`;
        }

        return html;
    }

    // ── Get Events for a Day ───────────────────────────────────
    function getEventsForDay(day) {
        return events.filter(ev => {
            const start = new Date(ev.dateStart);
            const end = new Date(ev.dateEnd);
            const dayStart = new Date(currentYear, currentMonth, day, 0, 0, 0);
            const dayEnd = new Date(currentYear, currentMonth, day, 23, 59, 59);

            return start <= dayEnd && end >= dayStart;
        });
    }

    // ── Navigation ─────────────────────────────────────────────
    function prevMonth() {
        currentMonth--;
        if (currentMonth < 0) {
            currentMonth = 11;
            currentYear--;
        }
        refreshGrid();
    }

    function nextMonth() {
        currentMonth++;
        if (currentMonth > 11) {
            currentMonth = 0;
            currentYear++;
        }
        refreshGrid();
    }

    function today() {
        const now = new Date();
        currentYear = now.getFullYear();
        currentMonth = now.getMonth();
        refreshGrid();
    }

    function refreshGrid() {
        const grid = document.getElementById('calendar-grid');
        const title = document.getElementById('calendar-month-title');

        if (grid) grid.innerHTML = buildGrid();
        if (title) title.textContent = `${MONTHS[currentMonth]} ${currentYear}`;

        if (window.lucide) lucide.createIcons();
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        render,
        prevMonth,
        nextMonth,
        today
    };
})();

window.CalendarView = CalendarView;

console.log('✅ calendar.js loaded');
