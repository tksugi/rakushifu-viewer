// React migration of the former DOM-script refresh regressions.
// All responses, identities and settings here are synthetic.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { AppData, calendarDescriptor, payDescriptor, searchDescriptor, staffDescriptor, defaultSettings, loadSettings, moveMonth, validSettings, validDate } from '../frontend/data';
import { useView } from '../frontend/hooks';
import { PayPage, SearchPage } from '../frontend/pages';
import { SessionGate } from '../frontend/SessionGate';
import { App } from '../frontend/App';
import { readFileSync } from 'node:fs';

const month = { year: 2026, month: 11 };
const instances: AppData[] = [];
const pay = { user_id: 1, estimated_yen: 1300, shift_count: 1, scheduled_minutes: 90, break_minutes: 30, worked_minutes: 60, night_minutes: 0 };
beforeAll(() => { const style = document.createElement('style'); style.textContent = readFileSync('frontend/style.css', 'utf8'); document.head.appendChild(style); });
function fixture(initialSessionStatus = 200, prefix = '') {
  const state = { sessionStatus: initialSessionStatus, status: 200, scope: 'synthetic-session', remaining: 120, revision: 'r1', fetched: Date.now() / 1000, expires: 3600 as number | null };
  const requests: { url: string; options?: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ url: String(url), options });
    const session = String(url).endsWith('/api/session');
    const status = session ? state.sessionStatus : state.status;
    const data = session ? { scope: state.scope, user_id: 1, expires_in: state.expires } : String(url).includes('/staff') ? [] : String(url).includes('/shifts') ? { workers: [], has_my_shift: false, count: 0 } : pay;
    return new Response(JSON.stringify(status >= 400 ? { error: '架空の通信エラー' } : data), { status, headers: { 'Content-Type': 'application/json', 'X-App-Scope': state.scope, 'X-Shift-Revision': state.revision, 'X-Shift-Fetched-At': String(state.fetched), 'X-Shift-Remaining-Seconds': String(state.remaining) } });
  });
  const end = vi.fn();
  const app = new AppData(prefix, end, fetcher as typeof fetch);
  instances.push(app);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={app.client}>{children}</QueryClientProvider>;
  return { app, state, requests, fetcher, end, wrapper, count: (part: string) => requests.filter(r => r.url.includes(part)).length };
}
async function advance(time = 10) { await act(async () => { await vi.advanceTimersByTimeAsync(time); }); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T12:00:00+09:00'));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  localStorage.clear();
});
afterEach(() => { cleanup(); instances.splice(0).forEach(app => app.end(false)); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('React refresh and cache integration', () => {
  it('keeps a 30-day session past the browser timer limit and clears it at the fixed deadline', async () => {
    const f = fixture();
    const lifetime = 30 * 24 * 60 * 60 * 1000;
    f.state.expires = lifetime / 1000;
    await f.app.ensureSession();
    await advance(2147483647);
    expect(f.app.ended).toBe(false);
    await advance(lifetime - 2147483647 - 1);
    expect(f.app.ended).toBe(false);
    await advance(1);
    expect(f.app.ended).toBe(true);
    expect(f.end).toHaveBeenCalledOnce();
    expect(f.app.info).toBeNull();
  });
  it('keeps scheduled refresh when the active calendar is selected again', async () => {
    const f = fixture(); await f.app.ensureSession();
    const hook = renderHook(() => useView(f.app, calendarDescriptor(month), true), { wrapper: f.wrapper });
    await advance(); expect(f.count('/api/calendar')).toBe(1);
    hook.rerender(); await advance(120010);
    expect(f.count('/api/calendar')).toBe(2);
  });
  it('keeps stale data on transient failure and retries even after rerender', async () => {
    const f = fixture(); await f.app.ensureSession();
    const hook = renderHook(() => useView(f.app, calendarDescriptor(month), true), { wrapper: f.wrapper });
    await advance(); f.state.status = 503;
    await advance(120010); expect(hook.result.current.value).toEqual(pay); expect(hook.result.current.error).toBeTruthy();
    hook.rerender(); f.state.status = 200; await advance(30010);
    expect(f.count('/api/calendar')).toBe(3); expect(hook.result.current.error).toBeNull();
  });
  it('backs off repeated refresh failures from 30 to 60 to 120 seconds', async () => {
    const f = fixture(); await f.app.ensureSession();
    renderHook(() => useView(f.app, calendarDescriptor(month), true), { wrapper: f.wrapper });
    await advance(); f.state.status = 503;
    await advance(120001); expect(f.count('/api/calendar')).toBe(2);
    await advance(30010); expect(f.count('/api/calendar')).toBe(3);
    await advance(30000); expect(f.count('/api/calendar')).toBe(3);
    await advance(30010); expect(f.count('/api/calendar')).toBe(4);
    await advance(60000); expect(f.count('/api/calendar')).toBe(4);
    await advance(60010); expect(f.count('/api/calendar')).toBe(5);
  });
  it('recovers from initial session failure and restores settings before pay is requested', async () => {
    const f = fixture(503);
    localStorage.setItem('pay-settings-1', JSON.stringify({ hourly_wage: '1300', night_bonus_percent: '30' }));
    render(<SessionGate app={f.app} />, { wrapper: f.wrapper }); await advance();
    expect(screen.getByRole('alert').textContent).toContain('認証状態'); expect(f.count('/api/pay/estimate')).toBe(0);
    f.state.sessionStatus = 200; await advance(31000); await advance(1000);
    const request = f.requests.find(r => r.url.endsWith('/api/pay/estimate'));
    expect(JSON.parse(String(request?.options?.body))).toMatchObject({ hourly_wage: '1300', night_bonus_percent: '30' });
  });
  it('401 clears private queries, aborts initialization, and never retries', async () => {
    const f = fixture(401);
    render(<SessionGate app={f.app} />, { wrapper: f.wrapper }); await advance();
    expect(f.app.ended).toBe(true); expect(f.end).toHaveBeenCalledOnce();
    expect(f.app.client.getQueryCache().getAll()).toHaveLength(0);
    await advance(120010); expect(f.count('/api/pay/estimate')).toBe(0); expect(f.count('/api/session')).toBe(1);
  });
  it('reuses fresh pay across tabs and keys changed settings separately', async () => {
    const f = fixture(); await f.app.ensureSession();
    const options = f.app.options(payDescriptor(month, defaultSettings));
    await f.app.client.fetchQuery(options); await f.app.client.fetchQuery(options);
    expect(f.count('/api/pay/estimate')).toBe(1);
    await f.app.client.fetchQuery(f.app.options(payDescriptor(month, { ...defaultSettings, hourly_wage: '1500' })));
    expect(f.count('/api/pay/estimate')).toBe(2);
  });
  it('prefetch deduplicates and makes the first tab visit synchronous', async () => {
    const f = fixture(); await f.app.ensureSession();
    await Promise.all([f.app.prefetch(searchDescriptor(month, '')), f.app.prefetch(searchDescriptor(month, ''))]);
    const hook = renderHook(() => useView(f.app, searchDescriptor(month, ''), true), { wrapper: f.wrapper });
    expect(hook.result.current.value).toEqual([]); await advance(); expect(f.count('/api/staff')).toBe(1);
  });
  it('does not evict a different query while its request is still in flight', async () => {
    const f = fixture(); await f.app.ensureSession();
    let finish!: (response: Response) => void;
    f.fetcher.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const options = f.app.options(searchDescriptor(month, ''));
    const pending = f.app.client.fetchQuery(options);
    await advance();
    await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)));
    expect(f.app.client.getQueryState(options.queryKey)?.fetchStatus).toBe('fetching');
    finish(new Response('[]', { headers: { 'X-App-Scope': f.state.scope, 'X-Shift-Revision': 'r1', 'X-Shift-Fetched-At': String(f.state.fetched), 'X-Shift-Remaining-Seconds': '120' } }));
    expect((await pending).data).toEqual([]);
  });
  it('does not carry data from another month or search condition while loading', async () => {
    const f = fixture(); await f.app.ensureSession();
    const hook = renderHook(({ q }) => useView(f.app, searchDescriptor(month, q), true), { wrapper: f.wrapper, initialProps: { q: '' } });
    await advance(); expect(hook.result.current.value).toEqual([]);
    f.fetcher.mockImplementationOnce(() => new Promise(() => {}));
    hook.rerender({ q: '架空' }); expect(hook.result.current.value).toBeUndefined();
  });
  it('removes a revoked staff record from the displayed result', async () => {
    const f = fixture(); await f.app.ensureSession();
    const hook = renderHook(() => useView(f.app, staffDescriptor(month, 2), true), { wrapper: f.wrapper });
    await advance(); f.state.status = 404;
    await advance(120010); expect(hook.result.current.revoked).toBe(true); expect(hook.result.current.value).toBeUndefined();
  });
  it('does not refresh a hidden tab', async () => {
    const f = fixture(); await f.app.ensureSession();
    const hook = renderHook(({ enabled }) => useView(f.app, calendarDescriptor(month), enabled), { wrapper: f.wrapper, initialProps: { enabled: true } });
    await advance(); hook.rerender({ enabled: false }); await advance(120010);
    expect(f.count('/api/calendar')).toBe(1);
  });
  it('uses upstream remaining freshness rather than extending it on a cache hit', async () => {
    const f = fixture(); f.state.remaining = 30; await f.app.ensureSession();
    const first = await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)));
    await advance(20000);
    expect(await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)))).toBe(first);
    await advance(10001); await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)));
    expect(f.count('/api/calendar')).toBe(2);
  });
  it('invalidates derived views when the monthly revision changes', async () => {
    const f = fixture(); await f.app.ensureSession();
    const old = await f.app.client.fetchQuery(f.app.options(payDescriptor(month, defaultSettings)));
    await advance(120001); f.state.revision = 'r2'; f.state.fetched = Date.now() / 1000;
    await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)));
    expect(old.invalid).toBe(true);
    expect(f.app.client.getQueryState(f.app.options(payDescriptor(month, defaultSettings)).queryKey)?.isInvalidated).toBe(true);
  });
  it('bounds both cache layers when browsing many months', async () => {
    const f = fixture(); await f.app.ensureSession();
    for (let n = 1; n <= 8; n++) await f.app.client.fetchQuery(f.app.options(calendarDescriptor({ year: 2026, month: n })));
    expect(f.app.cache.entries.size).toBeLessThanOrEqual(3);
    expect(f.app.client.getQueryCache().getAll().length).toBeLessThanOrEqual(3);
  });
});

describe('session and input boundaries', () => {
  it('clears private caches before submitting the existing POST logout', async () => {
    const f = fixture(); await f.app.ensureSession();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    render(<App app={f.app} />, { wrapper: f.wrapper }); await advance();
    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }));
    expect(f.app.ended).toBe(true); expect(f.end).toHaveBeenCalledWith(false);
    expect(f.app.cache.entries.size).toBe(0); expect(submit).toHaveBeenCalledOnce();
    const form = submit.mock.instances[0] as HTMLFormElement;
    expect(form.method).toBe('post'); expect(new URL(form.action).pathname).toBe('/logout'); form.remove();
  });
  it('blocks late responses even if the transport ignores abort', async () => {
    const f = fixture(); await f.app.ensureSession();
    let finish!: (r: Response) => void;
    let signal: AbortSignal | null | undefined;
    f.fetcher.mockImplementationOnce((_url, options) => { signal = options?.signal; return new Promise(done => { finish = done; }); });
    const pending = f.app.client.fetchQuery(f.app.options(calendarDescriptor(month))).catch(e => e);
    await advance(); f.app.end(false); expect(signal?.aborted).toBe(true);
    finish(new Response(JSON.stringify({ private: 'synthetic' }))); await pending;
    expect(f.app.cache.entries.size).toBe(0); expect(f.app.client.getQueryCache().getAll()).toHaveLength(0);
  });
  it('clears data if the cookie now identifies another session', async () => {
    const f = fixture(); await f.app.ensureSession();
    await f.app.client.fetchQuery(f.app.options(calendarDescriptor(month)));
    f.state.scope = 'another-synthetic-session';
    await expect(f.app.ensureSession(true)).rejects.toThrow('Session changed');
    expect(f.app.cache.entries.size).toBe(0); expect(f.app.ended).toBe(true);
  });
  it('clears at the local expiry deadline without waiting for another API request', async () => {
    const f = fixture(); f.state.expires = 1; await f.app.ensureSession();
    await advance(1001); expect(f.app.ended).toBe(true); expect(f.end).toHaveBeenCalledOnce();
  });
  it('conceals private UI while a return-to-tab session check is failing', async () => {
    const f = fixture(); render(<SessionGate app={f.app} />, { wrapper: f.wrapper }); await advance();
    expect(screen.getByRole('region', { name: '2026年11月のカレンダー' })).toBeTruthy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange')); await advance();
    f.state.sessionStatus = 503;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange')); await advance();
    expect(screen.queryByRole('region', { name: '2026年11月のカレンダー' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('認証状態');
    f.state.sessionStatus = 200; await advance(30010);
    expect(screen.getByRole('region', { name: '2026年11月のカレンダー' })).toBeTruthy();
  });
  it('conceals portaled detail dialogs too and restores them only after session verification', async () => {
    const f = fixture(); render(<SessionGate app={f.app} />, { wrapper: f.wrapper }); await advance();
    await advance(100);
    fireEvent.click(screen.getByRole('button', { name: '11月1日 出勤0人' })); await advance(300);
    expect(screen.getByRole('dialog')).toBeTruthy();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(document.body.classList.contains('session-checking')).toBe(true);
    await advance(300); expect(screen.queryByRole('dialog')).toBeNull();
    f.state.sessionStatus = 503;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    fireEvent(document, new Event('visibilitychange')); await advance(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    f.state.sessionStatus = 200; await advance(30010);
    expect(document.body.classList.contains('session-checking')).toBe(false);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
  it('rejects invalid settings and keeps sample storage separate', async () => {
    expect(validSettings({ hourly_wage: '-1', night_bonus_percent: '25' })).toBe(false);
    expect(validSettings({ hourly_wage: '1200', night_bonus_percent: '' })).toBe(false);
    expect(validSettings({ hourly_wage: 'Infinity', night_bonus_percent: '25' })).toBe(false);
    expect(validSettings({ hourly_wage: '100000', night_bonus_percent: '500' })).toBe(true);
    const f = fixture(200, '/sample'); await f.app.ensureSession();
    expect(f.app.settingsKey()).toBe('sample-pay-settings-1');
    expect(loadSettings({ getItem: () => '{broken' }, 'x')).toEqual(defaultSettings);
  });
  it('does not request a pay estimate for an invalid input or show an old amount', async () => {
    const f = fixture(); await f.app.ensureSession();
    const view = render(<PayPage app={f.app} month={month} active settings={{ hourly_wage: '1300', night_bonus_percent: '25' }} setSettings={() => {}} />, { wrapper: f.wrapper });
    await advance(); expect(screen.getByText('1,300円')).toBeTruthy();
    view.rerender(<PayPage app={f.app} month={month} active settings={{ hourly_wage: '-1', night_bonus_percent: '25' }} setSettings={() => {}} />);
    await advance(300); expect(screen.queryByText('1,300円')).toBeNull(); expect(f.count('/api/pay/estimate')).toBe(1);
  });
  it('does not show a previous staff search while input is being debounced', async () => {
    const f = fixture(); await f.app.ensureSession();
    const view = render(<SearchPage app={f.app} month={month} active search="" setSearch={() => {}} onStaff={() => {}} />, { wrapper: f.wrapper }); await advance();
    view.rerender(<SearchPage app={f.app} month={month} active search="架空" setSearch={() => {}} onStaff={() => {}} />);
    expect(screen.getByRole('status', { name: '検索中' }).textContent).toBe('');
    await advance(260); expect(f.requests.at(-1)?.url).toContain('q=%E6%9E%B6%E7%A9%BA');
  });
  it('handles year and date boundaries without local timezone shifts', () => {
    expect(moveMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(moveMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(validDate('2028-02-29')).toBe(true); expect(validDate('2026-02-29')).toBe(false); expect(validDate('<script>')).toBe(false);
  });
});
