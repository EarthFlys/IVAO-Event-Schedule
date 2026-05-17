/* ═══════════════════════════════════════════════════════════════
   auth.js — IVAO OAuth 2.0 + PKCE Authentication + Role Detection
   ═══════════════════════════════════════════════════════════════ */

// ── Staff Configuration ────────────────────────────────────────
// Divisions whose staff members can manage events
const STAFF_DIVISIONS = ['TH', 'XE', 'IN'];

const IVAOAuth = (() => {
    // auth.js บรรทัด 6-7
    const CLIENT_ID = '69a4c5c9-6472-45d0-8f41-6d3f0ed4a3f1'; // ← ใช้ตัวนี้ถ้านี่คือแอปจริงบน Vercel
    const REDIRECT_URI = window.location.origin;
    const AUTH_URL = 'https://sso.ivao.aero/authorize';
    const USER_URL = 'https://api.ivao.aero/v2/users/me';

    let currentUser = null;

    // ── PKCE Helpers ───────────────────────────────────────────
    function generateCodeVerifier() {
        const arr = new Uint8Array(32);
        crypto.getRandomValues(arr);
        return base64UrlEncode(arr);
    }

    async function generateCodeChallenge(verifier) {
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return base64UrlEncode(new Uint8Array(digest));
    }

    function base64UrlEncode(buffer) {
        let str = '';
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.length; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    // ── Login ──────────────────────────────────────────────────
    async function login() {
        const verifier = generateCodeVerifier();
        const challenge = await generateCodeChallenge(verifier);

        sessionStorage.setItem('pkce_verifier', verifier);

        const params = new URLSearchParams({
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            scope: 'profile email'   // ← ต้องเป็นแค่นี้
        });

        window.location.href = `${AUTH_URL}?${params.toString()}`;
    }

    // ── Handle OAuth Callback ──────────────────────────────────
    async function handleCallback() {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');

        if (!code) return false;

        const verifier = sessionStorage.getItem('pkce_verifier');
        if (!verifier) {
            console.error('No PKCE verifier found');
            showToast('Authentication failed — missing verifier', 'error');
            return false;
        }

        try {
            const res = await fetch('/api/auth/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    code,
                    code_verifier: verifier,
                    redirect_uri: REDIRECT_URI
                })
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Token exchange failed');

            localStorage.setItem('ivao_token', data.access_token);
            if (data.refresh_token) {
                localStorage.setItem('ivao_refresh', data.refresh_token);
            }
            sessionStorage.removeItem('pkce_verifier');

            // Clean URL
            window.history.replaceState({}, '', '/');

            await fetchUser();
            showToast(`Welcome back, ${currentUser?.firstName || 'Pilot'}!`, 'success');
            return true;

        } catch (err) {
            console.error('OAuth callback error:', err);
            showToast('Login failed: ' + err.message, 'error');
            sessionStorage.removeItem('pkce_verifier');
            return false;
        }
    }

    // ── Fetch User Profile ─────────────────────────────────────
    async function fetchUser() {
        const token = localStorage.getItem('ivao_token');
        if (!token) return null;

        try {
            const res = await fetch(USER_URL, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                if (res.status === 401) {
                    logout();
                    return null;
                }
                throw new Error('Failed to fetch user');
            }

            const data = await res.json();

            // ── Detect Staff Role ─────────────────────────────
            // IVAO API can return staff info in several ways:
            //   data.staff           — single staff object { divisionId, positionId, ... }
            //   data.staffPositions   — array of staff positions
            //   data.userStaffPositions — alternative key
            const staffPositions = data.staffPositions || data.userStaffPositions || [];
            const singleStaff = data.staff || null;

            // Build a normalised list of all staff positions
            const allPositions = [...staffPositions];
            if (singleStaff && singleStaff.divisionId) {
                allPositions.push(singleStaff);
            }

            // Check if user holds a staff position in an allowed division
            const staffInAllowedDiv = allPositions.find(pos => {
                const div = (pos.divisionId || pos.division || '').toUpperCase();
                return STAFF_DIVISIONS.includes(div);
            });

            const isStaffMember = !!staffInAllowedDiv || data.isStaff === true;

            // Determine the staff role label for UI display
            let staffRole = null;
            if (staffInAllowedDiv) {
                const posId = staffInAllowedDiv.staffPositionId || staffInAllowedDiv.positionId || staffInAllowedDiv.position || '';
                const div = (staffInAllowedDiv.divisionId || staffInAllowedDiv.division || '').toUpperCase();
                staffRole = posId ? `${div}-${posId}` : `${div} Staff`;
            }

            currentUser = {
                id: data.id,
                vid: data.id,
                firstName: data.firstName || '',
                lastName: data.lastName || '',
                division: (data.divisionId || '').toUpperCase(),
                rating: data.rating || {},
                staff: singleStaff,
                staffPositions: allPositions,
                isStaff: isStaffMember,
                staffRole: staffRole,
                isAdmin: isStaffMember   // alias for backward compat
            };

            console.log(`✅ User loaded: VID ${currentUser.vid}, Staff: ${isStaffMember}${staffRole ? ' (' + staffRole + ')' : ''}`);
            updateAuthUI();
            return currentUser;

        } catch (err) {
            console.error('Fetch user error:', err);
            return null;
        }
    }

    // ── Logout ─────────────────────────────────────────────────
    function logout() {
        localStorage.removeItem('ivao_token');
        localStorage.removeItem('ivao_refresh');
        currentUser = null;
        updateAuthUI();
        showToast('Logged out successfully', 'info');
        if (typeof window.navigateTo === 'function') {
            window.navigateTo('/');
        }
    }

    // ── Update Auth UI ─────────────────────────────────────────
    function updateAuthUI() {
        const authArea = document.getElementById('auth-area');
        const createLink = document.getElementById('nav-create');

        if (!authArea) return;

        if (currentUser) {
            const initials = (currentUser.firstName[0] || '') + (currentUser.lastName[0] || '');
            const staffBadge = currentUser.isStaff
                ? `<span class="staff-badge" title="Event Staff — ${escapeHtml(currentUser.staffRole || 'Staff')}">
                     <i data-lucide="shield-check" style="width:12px;height:12px;"></i>
                     ${escapeHtml(currentUser.staffRole || 'Staff')}
                   </span>`
                : `<span class="member-badge" title="IVAO Member">
                     <i data-lucide="user" style="width:12px;height:12px;"></i>
                     Member
                   </span>`;

            authArea.innerHTML = `
                <div class="user-menu" onclick="document.getElementById('user-dropdown')?.classList.toggle('hidden')" title="${escapeHtml(currentUser.firstName)} ${escapeHtml(currentUser.lastName)} (${currentUser.vid})">
                    <div class="user-avatar${currentUser.isStaff ? ' staff' : ''}">${escapeHtml(initials.toUpperCase())}</div>
                    <div class="user-info">
                        <span class="user-name">${escapeHtml(currentUser.firstName)}</span>
                        ${staffBadge}
                    </div>
                </div>
                <button class="nav-btn nav-btn-ghost" onclick="IVAOAuth.logout()" title="Logout">
                    <i data-lucide="log-out"></i>
                </button>
            `;

            // Show create link only for staff members
            if (createLink) {
                createLink.style.display = currentUser.isStaff ? 'flex' : 'none';
            }
        } else {
            authArea.innerHTML = `
                <button id="login-btn" class="nav-btn nav-btn-primary" onclick="IVAOAuth.login()">
                    <i data-lucide="log-in"></i>
                    <span>Login with IVAO</span>
                </button>
            `;
            if (createLink) createLink.style.display = 'none';
        }

        if (window.lucide) lucide.createIcons();
    }

    // ── Init ───────────────────────────────────────────────────
    async function init() {
        // First try callback
        const wasCallback = await handleCallback();

        // If not a callback, try restoring session
        if (!wasCallback) {
            const token = localStorage.getItem('ivao_token');
            if (token) {
                await fetchUser();
            } else {
                updateAuthUI();
            }
        }
    }

    // ── Public API ─────────────────────────────────────────────
    return {
        login,
        logout,
        init,
        getUser: () => currentUser,
        isLoggedIn: () => !!currentUser,
        isStaff: () => currentUser?.isStaff || false,
        isAdmin: () => currentUser?.isAdmin || false, // alias
        getToken: () => localStorage.getItem('ivao_token')
    };
})();

// Make globally accessible
window.IVAOAuth = IVAOAuth;

console.log('✅ auth.js loaded');
