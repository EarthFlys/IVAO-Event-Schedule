/* ═══════════════════════════════════════════════════════════════
   utils.js — Shared utility helpers
   ═══════════════════════════════════════════════════════════════ */

// ── Toast Notifications ────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const iconMap = {
        success: 'check',
        error: 'x',
        info: 'info',
        warning: 'alert-triangle'
    };

    toast.innerHTML = `
        <span class="toast-icon"><i data-lucide="${iconMap[type] || 'info'}"></i></span>
        <span class="toast-msg">${message}</span>
        <button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>
    `;

    container.appendChild(toast);

    // Re-render lucide icons for the new toast
    if (window.lucide) lucide.createIcons();

    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Date Formatting ────────────────────────────────────────────
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
    });
}

function formatTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC'
    }) + 'z';
}

function formatDateTime(dateStr) {
    return `${formatDate(dateStr)} ${formatTime(dateStr)}`;
}

function formatDateRange(startStr, endStr) {
    const start = new Date(startStr);
    const end = new Date(endStr);

    const sameDay = start.toDateString() === end.toDateString();
    if (sameDay) {
        return `${formatDate(startStr)} • ${formatTime(startStr)} – ${formatTime(endStr)}`;
    }
    return `${formatDateTime(startStr)} – ${formatDateTime(endStr)}`;
}

function timeUntil(dateStr) {
    const now = new Date();
    const target = new Date(dateStr);
    const diff = target - now;

    if (diff <= 0) return 'Started';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
}

// ── Event Status ───────────────────────────────────────────────
function getEventStatus(event) {
    const now = new Date();
    const start = new Date(event.dateStart);
    const end = new Date(event.dateEnd);

    if (end < now) return 'completed';
    if (start <= now && end >= now) return 'live';
    return 'upcoming';
}

function getStatusLabel(status) {
    const map = { upcoming: 'Upcoming', live: '● Live Now', completed: 'Completed' };
    return map[status] || status;
}

// ── Debounce ───────────────────────────────────────────────────
function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// ── Escape HTML ────────────────────────────────────────────────
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Modal Helpers ──────────────────────────────────────────────
function openModal(contentHtml) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    if (!overlay || !content) return;

    content.innerHTML = contentHtml;
    overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    if (window.lucide) lucide.createIcons();
}

function closeModal(e) {
    if (e && e.target !== e.currentTarget) return;
    const overlay = document.getElementById('modal-overlay');
    if (overlay) {
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }
}

// ── Mobile Menu ────────────────────────────────────────────────
function toggleMobileMenu() {
    const navLinks = document.getElementById('nav-links');
    if (navLinks) navLinks.classList.toggle('open');
}

// ── Slug / ID helpers ──────────────────────────────────────────
function getSlotStats(slots) {
    if (!slots || !Array.isArray(slots)) return { total: 0, booked: 0, pct: 0 };
    const total = slots.length;
    const booked = slots.filter(s => s.userId).length;
    return { total, booked, pct: total > 0 ? Math.round((booked / total) * 100) : 0 };
}

console.log('✅ utils.js loaded');
