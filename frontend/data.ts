import { QueryClient, queryOptions } from '@tanstack/react-query';
import '../static/data-cache.js';
import type { DataCache, Descriptor, Entry, Month, Session, Settings } from './types';

export class ApiError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}

export const monthKey = ({ year, month }: Month) => `${year}-${month}`;
export const monthLabel = ({ year, month }: Month) => `${year}年${month}月`;
export function moveMonth(value: Month, delta: number): Month {
  const index = value.year * 12 + value.month - 1 + delta;
  return { year: Math.floor(index / 12), month: index % 12 + 1 };
}
export function validMonth(value: Month) { return value.year >= 1 && value.year <= 9999 && value.month >= 1 && value.month <= 12; }
export function dateParts(value: string): Month { return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }; }
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month } = dateParts(value), day = Number(value.slice(8));
  return validMonth({ year, month }) && day >= 1 && day <= new Date(year, month, 0).getDate();
}
export function duration(minutes: number) { return `${Math.floor(Math.max(0, minutes) / 60)}時間${String(Math.max(0, minutes) % 60).padStart(2, '0')}分`; }
export const calendarDescriptor = (m: Month): Descriptor => ({ key: `calendar:${monthKey(m)}`, month: monthKey(m), url: `/api/calendar?year=${m.year}&month=${m.month}` });
export const searchDescriptor = (m: Month, q: string): Descriptor => ({ key: `search:${monthKey(m)}:${q}`, month: monthKey(m), url: `/api/staff?year=${m.year}&month=${m.month}&q=${encodeURIComponent(q)}` });
export const staffDescriptor = (m: Month, id: number): Descriptor => ({ key: `staff:${monthKey(m)}:${id}`, month: monthKey(m), url: `/api/staff/${id}?year=${m.year}&month=${m.month}` });
export const dayDescriptor = (date: string): Descriptor => ({ key: `day:${date}`, month: monthKey(dateParts(date)), url: `/api/shifts?date=${date}` });
export const payDescriptor = (m: Month, settings: Settings): Descriptor => ({ key: `pay:${monthKey(m)}:${settings.hourly_wage}:${settings.night_bonus_percent}`, month: monthKey(m), url: '/api/pay/estimate', options: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...m, ...settings, hourly_wage: settings.hourly_wage || '0' }) } });
export const defaultSettings: Settings = { hourly_wage: '', night_bonus_percent: '25' };
export function validSettings(s: Settings) {
  return [s.hourly_wage || '0', s.night_bonus_percent].every(v => v.trim() !== '' && Number.isFinite(Number(v))) && Number(s.hourly_wage) >= 0 && Number(s.hourly_wage) <= 100000 && Number(s.night_bonus_percent) >= 0 && Number(s.night_bonus_percent) <= 500;
}
export function loadSettings(storage: Pick<Storage, 'getItem'>, key: string): Settings {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value && typeof value === 'object') {
      const s = { hourly_wage: String(value.hourly_wage ?? ''), night_bonus_percent: String(value.night_bonus_percent ?? '25') };
      if (validSettings(s)) return s;
    }
  } catch { /* Storage is optional. */ }
  return { ...defaultSettings };
}

/** The existing, regression-tested cache owns scope, revision, freshness and LRU limits.
 * TanStack Query observes the same entries to drive React views and deduplicate prefetches. */
export class AppData {
  readonly client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, gcTime: 300000 } } });
  readonly cache: DataCache;
  readonly failures = new Map<string, number>();
  info: Session | null = null;
  ended = false;
  deadline = Infinity;
  private check: Promise<Session> | null = null;
  private sessionController: AbortController | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly prefix: string, private onEnd: (redirect: boolean) => void, private fetcher: typeof fetch = (...args) => fetch(...args)) {
    this.cache = new globalThis.ViewDataCache((url, options) => this.request(url, options), { onSessionChanged: () => this.end() });
    this.client.getQueryCache().subscribe(event => {
      if (event.type === 'removed') this.failures.delete(String(event.query.queryKey[1]));
    });
  }
  private async request(url: string, options?: RequestInit) {
    if (this.ended || Date.now() >= this.deadline) { this.end(); throw new ApiError('ログインの有効期限が切れました', 401); }
    const response = await this.fetcher(this.prefix + url, { ...options, cache: 'no-store', credentials: 'same-origin' });
    if (response.status === 401) { this.end(); throw new ApiError('ログインが必要です', 401); }
    return response;
  }
  async ensureSession(force = false): Promise<Session> {
    if (this.ended || Date.now() >= this.deadline) { this.end(); throw new ApiError('ログインの有効期限が切れました', 401); }
    if (this.check) return this.check;
    if (this.info && !force) return this.info;
    const epoch = this.cache.epoch, started = Date.now();
    this.sessionController = new AbortController();
    this.check = (async () => {
      const response = await this.request('/api/session', { signal: this.sessionController!.signal });
      if (!response.ok) throw new ApiError('認証状態を確認できませんでした', response.status);
      const info: Session = await response.json();
      if (this.ended || epoch !== this.cache.epoch) throw new ApiError('Session ended');
      if (typeof info.scope !== 'string' || !info.scope || !Number.isSafeInteger(info.user_id) || !(info.expires_in === null || Number.isFinite(info.expires_in))) throw new ApiError('認証情報の形式が不正です');
      if (this.info && info.scope !== this.info.scope) { this.end(); throw new ApiError('Session changed'); }
      this.info = info;
      this.cache.scope = info.scope;
      if (info.expires_in !== null) {
        this.deadline = started + Math.max(0, info.expires_in * 1000);
        clearTimeout(this.expiryTimer);
        this.expiryTimer = setTimeout(() => this.end(), Math.min(2147483647, Math.max(0, this.deadline - Date.now())));
      }
      return info;
    })();
    try { return await this.check; } finally { this.check = null; }
  }
  settingsKey() { return `${this.prefix ? 'sample-' : ''}pay-settings-${this.info!.user_id}`; }
  end(redirect = true) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.expiryTimer);
    this.sessionController?.abort();
    this.cache.clear();
    this.failures.clear();
    this.client.clear();
    this.info = null;
    this.onEnd(redirect);
  }
  options<T>(descriptor: Descriptor) {
    return queryOptions({
      queryKey: [this.info?.scope ?? 'pending', descriptor.key],
      queryFn: async () => {
        await this.ensureSession();
        let entry: Entry;
        try {
          entry = await this.cache.get(descriptor);
          this.failures.delete(descriptor.key);
        } catch (error) {
          if (!this.ended) this.failures.set(descriptor.key, (this.failures.get(descriptor.key) ?? 0) + 1);
          throw error;
        }
        if (this.ended) throw new ApiError('Session ended');
        for (const query of this.client.getQueryCache().getAll()) {
          const saved = query.state.data as Entry | undefined;
          if (saved?.invalid) void this.client.invalidateQueries({ queryKey: query.queryKey, exact: true, refetchType: 'none' });
          if (saved && query.state.fetchStatus !== 'fetching' && query.queryKey[1] !== descriptor.key && !this.cache.entries.has(String(query.queryKey[1]))) this.client.removeQueries({ queryKey: query.queryKey, exact: true });
        }
        return entry as Entry<T>;
      },
      staleTime: query => {
        const entry = query.state.data;
        return entry && !entry.invalid ? Math.max(0, entry.expiresAt - query.state.dataUpdatedAt) : 0;
      },
    });
  }
  prefetch<T>(descriptor: Descriptor) {
    if (this.ended || !this.info) return Promise.resolve();
    return this.client.prefetchQuery(this.options<T>(descriptor));
  }
}
