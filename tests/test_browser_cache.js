// Run with: node --test tests/test_browser_cache.js (no external dependencies).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ViewDataCache } = require('../static/data-cache.js');

function response(data, { revision = 'r1', fetched = 1000, remaining = 120,
    scope = 'fixture-session', status = 200 } = {}) {
    return {
        ok: status === 200, status,
        headers: new Map([
            ['X-Shift-Revision', revision], ['X-Shift-Fetched-At', String(fetched)],
            ['X-Shift-Remaining-Seconds', String(remaining)], ['X-App-Scope', scope],
        ]),
        json: async () => data,
    };
}

function descriptor(key, month = '2026-10') {
    return { key, month, url: `/fixture/${key}` };
}

function cache(fetcher, options) {
    const value = new ViewDataCache(fetcher, options);
    value.scope = 'fixture-session';
    return value;
}

test('tab revisits reuse data without renewing its deadline', async () => {
    let now = 1000000;
    let calls = 0;
    const value = cache(async () => { calls++; return response({ count: 2 }); }, { now: () => now });
    const first = await value.get(descriptor('calendar'));
    now += 30000;
    assert.equal(await value.get(descriptor('calendar')), first);
    assert.equal(first.expiresAt, 1120000);
    assert.equal(calls, 1);
    now = 1120001;
    await value.get(descriptor('calendar'));
    assert.equal(calls, 2);
});

test('searches, pay settings, staff IDs and months use distinct keys', async () => {
    let calls = 0;
    const value = cache(async url => { calls++; return response(url); }, { now: () => 1000000 });
    for (const key of ['calendar', 'search:alice', 'search:bob', 'pay:1200:25',
        'pay:1300:25', 'staff:2', 'staff:3']) await value.get(descriptor(key));
    await value.get(descriptor('calendar:next', '2026-11'));
    assert.equal(calls, 8);
    assert.equal((await value.get(descriptor('search:bob'))).data, '/fixture/search:bob');
    assert.equal(calls, 8);
});

test('simultaneous requests for the same result share a fetch', async () => {
    let resolve;
    let calls = 0;
    const value = cache(() => { calls++; return new Promise(done => { resolve = done; }); });
    const first = value.get(descriptor('calendar'));
    const second = value.get(descriptor('calendar'));
    resolve(response({ count: 3 }));
    assert.equal(await first, await second);
    assert.equal(calls, 1);
});

test('original remaining freshness subtracts request time', async () => {
    let now = 1000000;
    const value = cache(async () => {
        now += 1500;
        return response({}, { remaining: 10 });
    }, { now: () => now });
    assert.equal((await value.get(descriptor('calendar'))).expiresAt, 1010000);
});

test('a newer monthly snapshot invalidates all derived results for that month', async () => {
    let now = 1000000;
    let revision = 'r1';
    const value = cache(async () => response({}, { revision, fetched: now / 1000 }), { now: () => now });
    await value.get(descriptor('calendar'));
    await value.get(descriptor('pay'));
    await value.get(descriptor('search'));
    await value.get(descriptor('other-month', '2026-11'));
    now += 120001;
    revision = 'r2';
    await value.get(descriptor('calendar'));
    assert.equal(value.peek('pay').invalid, true);
    assert.equal(value.peek('search').invalid, true);
    assert.equal(value.peek('calendar').invalid, false);
    assert.equal(value.peek('other-month').invalid, false);
});

test('late older monthly responses cannot replace a newer snapshot', async () => {
    let resolve;
    const value = cache(url => url.endsWith('old') ? new Promise(done => { resolve = done; })
        : Promise.resolve(response({}, { revision: 'new', fetched: 2000 })));
    const old = value.get(descriptor('old'));
    await value.get(descriptor('new'));
    resolve(response({}, { revision: 'old', fetched: 1000 }));
    await assert.rejects(old, /older month/);
    assert.equal(value.peek('old'), undefined);
    assert.equal(value.peek('new').invalid, false);
});

test('transient failure keeps previous data available and allows retry', async () => {
    let fail = false;
    let now = 1000000;
    const value = cache(async () => {
        if (fail) throw new Error('offline');
        return response({ count: 4 });
    }, { now: () => now });
    const first = await value.get(descriptor('calendar'));
    now += 120001;
    fail = true;
    await assert.rejects(value.get(descriptor('calendar')), /offline/);
    assert.equal(value.peek('calendar'), first);
    fail = false;
    assert.equal((await value.get(descriptor('calendar'))).data.count, 4);
});

test('a revoked staff detail is removed rather than retained as stale data', async () => {
    let now = 1000000;
    const value = cache(async () => response({}, { status: now > 1000000 ? 404 : 200 }), { now: () => now });
    await value.get(descriptor('staff:2'));
    now += 120001;
    await assert.rejects(value.get(descriptor('staff:2')), error => error.status === 404);
    assert.equal(value.peek('staff:2'), undefined);
});

test('logout aborts requests and discards a result even if fetch ignores abort', async () => {
    let resolve;
    let signal;
    const value = cache((url, options) => {
        signal = options.signal;
        return new Promise(done => { resolve = done; });
    });
    const pending = value.get(descriptor('calendar'));
    value.clear();
    assert.equal(signal.aborted, true);
    resolve(response({ private: 'synthetic' }));
    await assert.rejects(pending, /Discarded response/);
    assert.equal(value.entries.size, 0);
});

test('a cookie switch clears data instead of mixing users', async () => {
    let changed = false;
    const value = cache(async () => response({}, { scope: 'another-fixture-session' }),
        { onSessionChanged: () => { changed = true; } });
    await assert.rejects(value.get(descriptor('calendar')), /Session changed/);
    assert.equal(changed, true);
    assert.equal(value.entries.size, 0);
});

test('memory is bounded by month count and total entry count', async () => {
    const value = cache(async () => response({}), { maxMonths: 3, maxEntries: 4 });
    for (let month = 1; month <= 4; month++) await value.get(descriptor(`m${month}`, `2026-${month}`));
    assert.equal(value.peek('m1'), undefined);
    for (let i = 0; i < 8; i++) await value.get(descriptor(`q${i}`, '2026-4'));
    assert.equal(value.entries.size, 4);
});
