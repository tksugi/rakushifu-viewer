// Run with: node --test tests/test_view_refresh.js (artificial DOM, clock and API).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initialSessionStatus = 200) {
    let now = 1000000;
    let nextTimer = 0;
    const timers = new Map();
    const elements = new Map();
    const requests = [];
    let sessionStatus = initialSessionStatus;
    let calendarStatus = 200;
    const element = id => {
        if (!elements.has(id)) elements.set(id, {
            id, hidden: ['searchPage', 'payPage'].includes(id), textContent: '',
            value: id === 'nightBonus' ? '25' : '', scrollTop: 0, dataset: {},
            classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
            addEventListener() {}, setAttribute() {}, removeAttribute() {},
            querySelectorAll() { return []; },
            replaceChildren() { this.textContent = ''; },
            before(node) { elements.set(node.id, node); },
        });
        return elements.get(id);
    };
    const document = {
        hidden: false, activeElement: null, body: element('body'),
        getElementById: element, querySelectorAll() { return []; },
        querySelector() { return null; }, addEventListener() {},
        createElement() { return { setAttribute() {} }; },
    };
    const context = vm.createContext({
        document, bootstrap: { Modal: class {} }, AbortController,
        Date: class extends Date { static now() { return now; } },
        setTimeout(callback, delay) {
            const id = ++nextTimer;
            timers.set(id, { callback, due: now + delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        localStorage: {
            getItem() { return JSON.stringify({ hourly_wage: '1300', night_bonus_percent: '30' }); },
            setItem() {},
        },
        scrollY: 0, scrollTo() {}, addEventListener() {},
        shiftSessionEvents: { subscribe() {} },
        location: { replace() {} },
        fetch: async (url, options) => {
            requests.push({ url, options });
            const status = url === '/api/session' ? sessionStatus
                : url.startsWith('/api/calendar') ? calendarStatus : 200;
            return {
                ok: status === 200, status,
                headers: new Map([
                    ['X-App-Scope', 'fake-session'], ['X-Shift-Revision', String(now)],
                    ['X-Shift-Fetched-At', String(now / 1000)],
                    ['X-Shift-Remaining-Seconds', '120'],
                ]),
                json: async () => url === '/api/session'
                    ? { scope: 'fake-session', user_id: 1, expires_in: 3600 }
                    : { error: status === 200 ? undefined : 'fixture error', estimated_yen: 1000,
                        shift_count: 1, scheduled_minutes: 60, break_minutes: 0,
                        worked_minutes: 60, night_minutes: 0 },
            };
        },
    });
    context.window = context;
    for (const filename of ['data-cache.js', 'app.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../static', filename), 'utf8'), context);
    }
    // Drawing calendar cells is outside these timer/authentication regression tests.
    vm.runInContext("drawCalendar = () => { calendarContainer.textContent = 'fixture calendar'; };", context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/view-loader.js'), 'utf8'), context);
    const run = code => vm.runInContext(code, context);
    const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
    return {
        run, flush, element, requests, timers,
        setSessionStatus(status) { sessionStatus = status; },
        setCalendarStatus(status) { calendarStatus = status; },
        async advance(milliseconds) {
            now += milliseconds;
            for (const [id, timer] of [...timers]) {
                if (timer.due <= now) {
                    timers.delete(id);
                    timer.callback();
                }
            }
            await flush();
        },
    };
}

test('clicking the active calendar keeps its scheduled refresh', async () => {
    const app = fixture();
    await app.flush();
    app.run('showCalendarPage(); showCalendarPage();');
    assert.equal(app.requests.filter(request => request.url.startsWith('/api/calendar')).length, 1);
    await app.advance(120001);
    assert.equal(app.requests.filter(request => request.url.startsWith('/api/calendar')).length, 2);
});

test('clicking the active calendar keeps a failed refresh retry', async () => {
    const app = fixture();
    await app.flush();
    app.setCalendarStatus(503);
    await app.advance(120001);
    app.run('showCalendarPage();');
    app.setCalendarStatus(200);
    await app.advance(30001);
    assert.equal(app.requests.filter(request => request.url.startsWith('/api/calendar')).length, 3);
    assert.equal(app.element('calendarContainerStatus').textContent, '');
});

test('pay recovers from initial session failures and uses restored settings', async () => {
    const app = fixture(503);
    // The initial calendar and pay share the unsuccessful session check.
    app.run('showPayPage();');
    await app.flush();
    assert.match(app.element('payResults').textContent, /認証状態/);
    assert.match(app.element('payResultsStatus').textContent, /更新できません/);
    await app.advance(30001);
    assert.equal(app.requests.filter(request => request.url === '/api/pay/estimate').length, 0);
    app.setSessionStatus(200);
    await app.advance(60001);
    const payRequests = app.requests.filter(request => request.url === '/api/pay/estimate');
    assert.equal(payRequests.length, 1);
    assert.equal(JSON.parse(payRequests[0].options.body).hourly_wage, '1300');
    assert.equal(JSON.parse(payRequests[0].options.body).night_bonus_percent, '30');
    assert.match(app.element('payResults').innerHTML, /給与の概算/);
    assert.equal(app.element('payResultsStatus').textContent, '');
});

test('pay session expiry clears the view and never schedules a retry', async () => {
    const app = fixture(401);
    app.run('showPayPage();');
    await app.flush();
    assert.equal(app.run('sessionEnded'), true);
    assert.equal(app.element('payResults').textContent, '');
    assert.equal(app.timers.size, 0);
    await app.advance(120001);
    assert.equal(app.requests.filter(request => request.url === '/api/pay/estimate').length, 0);
});

test('fresh pay revisits keep the cache while edited settings trigger recalculation', async () => {
    const app = fixture();
    await app.flush();
    app.run('showPayPage();');
    await app.flush();
    app.run('showCalendarPage(); showPayPage();');
    await app.flush();
    assert.equal(app.requests.filter(request => request.url === '/api/pay/estimate').length, 1);
    app.element('hourlyWage').value = '1500';
    await app.run('fetchPayEstimate();');
    const payRequests = app.requests.filter(request => request.url === '/api/pay/estimate');
    assert.equal(payRequests.length, 2);
    assert.equal(JSON.parse(payRequests[1].options.body).hourly_wage, '1500');
});
