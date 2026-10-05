/* Rendering and session checks are separate from the in-memory data cache. */
const sampleMode = Boolean(document.body.dataset.apiPrefix);
const viewCache = new ViewDataCache(authenticatedFetch, { onSessionChanged: () => endSession() });
const viewSlots = new Map();
let sessionCheck;
let sessionInitialized = false;
let sessionEnded = false;
let sessionDeadline = Infinity;
let sessionExpiryTimer;
let sessionCheckTimer;
let visibleRefreshTimer;
let resumeCheckRequired = false;

function clearPrivateViews() {
    viewCache.clear();
    viewSlots.clear();
    clearTimeout(visibleRefreshTimer);
    clearTimeout(sessionCheckTimer);
    clearTimeout(sessionExpiryTimer);
    for (const id of ['calendarContainer', 'searchResults', 'payResults', 'modalBody',
        'staffDetailBody', 'modalTitle', 'modalDateSub', 'staffDetailName',
        'staffDetailCode', 'staffDetailBirthday', 'mobileShiftSummary']) {
        document.getElementById(id).replaceChildren();
    }
    document.querySelectorAll('.data-update-status').forEach(status => status.remove());
    modalHistory = [];
    currentStaffData = null;
    staffSelection = null;
    shiftSelection = null;
    modalRequestId++;
}

function endSession(redirect = true) {
    sessionEnded = true;
    clearPrivateViews();
    document.body.classList.add('session-checking');
    if (redirect) window.location.replace('/login');
}

async function ensureSession(force = false) {
    if (sessionEnded) throw new Error('Session ended');
    if (Date.now() >= sessionDeadline) {
        endSession();
        throw new Error('Session expired');
    }
    if (sessionCheck) return sessionCheck;
    if (sessionInitialized && !force && !resumeCheckRequired) return;
    const started = Date.now();
    const epoch = viewCache.epoch;
    sessionCheck = (async () => {
        const response = await authenticatedFetch('/api/session', { cache: 'no-store' });
        if (!response.ok) throw new Error('認証状態を確認できませんでした');
        const info = await response.json();
        if (sessionEnded || epoch !== viewCache.epoch) throw new Error('Session ended');
        if (viewCache.scope && viewCache.scope !== info.scope) {
            endSession();
            throw new Error('Session changed');
        }
        viewCache.scope = info.scope;
        if (!sessionInitialized) {
            payUserId = info.user_id;
            try {
                const saved = JSON.parse(localStorage.getItem(paySettingsKey()));
                if (saved) {
                    document.getElementById('hourlyWage').value = saved.hourly_wage || '';
                    document.getElementById('nightBonus').value = saved.night_bonus_percent ?? 25;
                }
            } catch (error) { /* Keep the default settings. */ }
        }
        sessionInitialized = true;
        resumeCheckRequired = false;
        if (info.expires_in !== null) {
            sessionDeadline = started + Math.max(0, info.expires_in * 1000);
            clearTimeout(sessionExpiryTimer);
            sessionExpiryTimer = setTimeout(() => endSession(), Math.max(0, sessionDeadline - Date.now()));
        }
        document.body.classList.remove('session-checking');
        scheduleSessionCheck();
    })();
    try {
        return await sessionCheck;
    } finally {
        sessionCheck = null;
    }
}

function scheduleSessionCheck(delay = 60000) {
    clearTimeout(sessionCheckTimer);
    if (sampleMode || document.hidden || sessionEnded) return;
    sessionCheckTimer = setTimeout(async () => {
        try { await ensureSession(true); }
        catch (error) { if (!sessionEnded) scheduleSessionCheck(30000); }
    }, delay);
}

function statusFor(target) {
    let status = document.getElementById(`${target.id}Status`);
    if (!status) {
        status = document.createElement('p');
        status.id = `${target.id}Status`;
        status.className = 'data-update-status';
        status.setAttribute('role', 'status');
        target.before(status);
    }
    return status;
}

function updateStatus(target, text) {
    const status = statusFor(target);
    status.textContent = text;
    status.hidden = !text || target.hidden;
}

function paintView(target, entry, render) {
    const slot = viewSlots.get(target.id);
    if (slot?.painted === entry) {
        restorePageScroll(target);
        return;
    }
    const scrollTop = target.scrollTop;
    const windowScroll = window.scrollY;
    const focused = document.activeElement;
    const controls = Array.from(target.querySelectorAll('button, input, a'));
    const focusIndex = controls.indexOf(focused);
    const focusKey = focused?.dataset.focusKey || focused?.dataset.date || focused?.getAttribute('aria-label');
    render(entry.data);
    if (slot) slot.painted = entry;
    if (focusIndex >= 0) {
        const nextControls = Array.from(target.querySelectorAll('button, input, a'));
        const next = nextControls.find(control => focusKey &&
            (control.dataset.focusKey || control.dataset.date || control.getAttribute('aria-label')) === focusKey)
            || nextControls[focusIndex];
        next?.focus({ preventScroll: true });
    }
    target.scrollTop = scrollTop;
    window.scrollTo({ top: windowScroll, behavior: 'instant' });
    restorePageScroll(target);
}

function restorePageScroll(target) {
    if (pendingPageScroll !== null && !modalView && target.id ===
        ({ calendar: 'calendarContainer', search: 'searchResults', pay: 'payResults' })[activePage]) {
        window.scrollTo({ top: pendingPageScroll, behavior: 'instant' });
        pendingPageScroll = null;
    }
}

async function loadView(target, descriptor, render, isCurrent, loadingText = '読み込み中…') {
    if (!isCurrent() || sessionEnded) return;
    const previous = viewSlots.get(target.id);
    const slot = previous?.descriptor.key === descriptor.key ? previous
        : { descriptor, painted: null, failures: 0, retryAt: 0 };
    slot.descriptor = descriptor;
    slot.isCurrent = isCurrent;
    slot.refresh = () => loadView(target, descriptor, render, isCurrent, loadingText);
    viewSlots.set(target.id, slot);
    if (!previous || previous.descriptor.key !== descriptor.key) {
        // Do not leave another month/condition visible while awaiting a session check.
        target.textContent = loadingText;
        updateStatus(target, '');
        if (target.id === 'staffDetailBody') addStaffMonthSwitcher();
    }
    try {
        await ensureSession();
        if (!isCurrent() || sessionEnded || viewSlots.get(target.id) !== slot) return;
        const cached = viewCache.peek(descriptor.key);
        if (!cached || previous?.descriptor.key !== descriptor.key) updateStatus(target, '');
        if (cached) paintView(target, cached, render);
        else if (slot.retryAt <= Date.now() || !target.textContent) {
            target.textContent = loadingText;
            slot.painted = null;
            if (target.id === 'staffDetailBody') addStaffMonthSwitcher();
        }
        if (viewCache.fresh(cached)) {
            updateStatus(target, '');
            scheduleVisibleRefresh();
            return;
        }
        if (slot.retryAt > Date.now()) {
            scheduleVisibleRefresh();
            return;
        }
        updateStatus(target, cached ? '更新中…' : '');
        const entry = await viewCache.get(descriptor);
        if (!isCurrent() || sessionEnded || viewSlots.get(target.id) !== slot) return;
        paintView(target, entry, render);
        slot.failures = 0;
        slot.retryAt = 0;
        slot.requiresInput = false;
        updateStatus(target, '');
    } catch (error) {
        if (!isCurrent() || sessionEnded || viewSlots.get(target.id) !== slot) return;
        const cached = viewCache.peek(descriptor.key);
        if (error.status === 404) {
            target.textContent = 'このスタッフは現在の表示対象に含まれていません';
            if (target.id === 'staffDetailBody') {
                currentStaffData = null;
                document.getElementById('staffDetailName').textContent = 'スタッフ詳細';
                document.getElementById('staffDetailCode').textContent = '—';
                document.getElementById('staffDetailBirthday').textContent = '—';
                addStaffMonthSwitcher();
            }
        } else if (!cached) {
            target.textContent = error.message || 'データを取得できませんでした';
            if (target.id === 'calendarContainer') {
                document.getElementById('mobileShiftSummary').textContent = '自分の勤務日を取得できませんでした';
            }
        }
        const fetched = cached ? ` 最終取得：${new Date(cached.fetchedAt).toLocaleString('ja-JP')}` : '';
        updateStatus(target, `更新できませんでした。${fetched}`);
        if (error.status === 400) {
            slot.requiresInput = true;
            return;
        }
        slot.failures++;
        slot.retryAt = Date.now() + Math.min(120000, 30000 * 2 ** (slot.failures - 1));
    } finally {
        scheduleVisibleRefresh();
    }
}

function visibleSlot() {
    const id = modalView ? (modalView === 'staff' ? 'staffDetailBody' : 'modalBody')
        : !calendarPage.hidden ? 'calendarContainer' : !searchPage.hidden ? 'searchResults' : 'payResults';
    return viewSlots.get(id);
}

function scheduleVisibleRefresh() {
    clearTimeout(visibleRefreshTimer);
    if (document.hidden || sessionEnded) return;
    const slot = visibleSlot();
    if (!slot || !slot.isCurrent() || slot.requiresInput) return;
    const entry = viewCache.peek(slot.descriptor.key);
    const due = slot.retryAt || (entry?.invalid ? Date.now() : entry?.expiresAt);
    if (!due) return;
    visibleRefreshTimer = setTimeout(() => slot.refresh(), Math.max(1000, due - Date.now()));
}

document.addEventListener('visibilitychange', async () => {
    clearTimeout(visibleRefreshTimer);
    clearTimeout(sessionCheckTimer);
    if (document.hidden) {
        resumeCheckRequired = !sampleMode;
        return;
    }
    if (sessionEnded) return;
    if (!sampleMode) document.body.classList.add('session-checking');
    try {
        await ensureSession(!sampleMode);
        visibleSlot()?.refresh();
    } catch (error) {
        if (!sessionEnded) {
            // Keep private content concealed until the current cookie is checked.
            setTimeout(() => document.dispatchEvent(new Event('visibilitychange')), 30000);
        }
    }
});

if (!sampleMode) {
    window.shiftSessionEvents.subscribe(() => endSession());
    document.querySelector('form[action="/logout"]')?.addEventListener('submit', () => {
        window.shiftSessionEvents.publish();
        endSession(false);
    });
}
window.addEventListener('pagehide', () => endSession(false));
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });

renderCalendar();
