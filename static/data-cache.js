/* Private data lives only in this page's memory. HTTP caching remains disabled. */
(function (root) {
    'use strict';

    class ViewDataCache {
        constructor(fetcher, { now = () => Date.now(), maxMonths = 3, maxEntries = 100,
            onSessionChanged = () => {} } = {}) {
            this.fetcher = fetcher;
            this.now = now;
            this.maxMonths = maxMonths;
            this.maxEntries = maxEntries;
            this.onSessionChanged = onSessionChanged;
            this.entries = new Map();
            this.pending = new Map();
            this.revisions = new Map();
            this.months = new Map();
            this.epoch = 0;
            this.scope = null;
        }

        clear() {
            this.epoch++;
            for (const { controller } of this.pending.values()) controller.abort();
            this.pending.clear();
            this.entries.clear();
            this.revisions.clear();
            this.months.clear();
            this.scope = null;
        }

        peek(key) {
            const entry = this.entries.get(key);
            if (entry) {
                this.entries.delete(key);
                this.entries.set(key, entry);
                this.months.delete(entry.month);
                this.months.set(entry.month, true);
            }
            return entry;
        }

        fresh(entry) {
            return entry && !entry.invalid && entry.expiresAt > this.now();
        }

        async get({ key, month, url, options }) {
            const entry = this.peek(key);
            if (this.fresh(entry)) return entry;
            if (this.pending.has(key)) return this.pending.get(key).promise;
            const controller = new AbortController();
            const epoch = this.epoch;
            const scope = this.scope;
            const started = this.now();
            const promise = (async () => {
                const response = await this.fetcher(url, { ...options, signal: controller.signal });
                if (epoch !== this.epoch) throw new Error('Discarded response');
                const responseScope = response.headers.get('X-App-Scope');
                if (responseScope && responseScope !== scope) {
                    this.clear();
                    this.onSessionChanged();
                    throw new Error('Session changed');
                }
                const data = await response.json();
                if (epoch !== this.epoch) throw new Error('Discarded response');
                if (!response.ok) {
                    const error = new Error(data.error || 'データを取得できませんでした');
                    error.status = response.status;
                    if (response.status === 404) this.entries.delete(key);
                    throw error;
                }
                const revision = response.headers.get('X-Shift-Revision');
                const fetchedAt = Number(response.headers.get('X-Shift-Fetched-At')) * 1000;
                const remaining = Number(response.headers.get('X-Shift-Remaining-Seconds'));
                const previous = this.revisions.get(month);
                if (previous && previous.revision !== revision && previous.fetchedAt > fetchedAt) {
                    throw new Error('Discarded older month response');
                }
                if (previous && previous.revision !== revision) {
                    for (const cached of this.entries.values()) {
                        if (cached.month === month) cached.invalid = true;
                    }
                }
                const saved = { data, month, revision, fetchedAt,
                    // Subtract the whole request time to avoid extending upstream freshness.
                    expiresAt: this.now() + Math.max(0, remaining * 1000 - (this.now() - started)),
                    invalid: false };
                this.revisions.set(month, { revision, fetchedAt });
                this.entries.delete(key);
                this.entries.set(key, saved);
                this.months.delete(month);
                this.months.set(month, true);
                while (this.months.size > this.maxMonths) {
                    const oldest = this.months.keys().next().value;
                    for (const [oldKey, value] of this.entries) {
                        if (value.month === oldest) this.entries.delete(oldKey);
                    }
                    this.months.delete(oldest);
                    this.revisions.delete(oldest);
                }
                while (this.entries.size > this.maxEntries) {
                    this.entries.delete(this.entries.keys().next().value);
                }
                return saved;
            })();
            this.pending.set(key, { promise, controller });
            try {
                return await promise;
            } finally {
                if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
            }
        }
    }

    root.ViewDataCache = ViewDataCache;
    if (typeof module !== 'undefined') module.exports = { ViewDataCache };
})(typeof window !== 'undefined' ? window : globalThis);
