import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Users, Banknote, LogOut, ArrowUpRight } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './registry/components/tabs/tabs';
import { CalendarPage, SearchPage, PayPage } from './pages';
import { Details } from './Details';
import type { Selection } from './Details';
import { AppData, calendarDescriptor, searchDescriptor, payDescriptor, loadSettings, moveMonth, validMonth, validSettings } from './data';
import { Badge, Button, MonthSwitcher } from './ui';
import { publishSessionChange } from './session-events';
import type { Month, Settings } from './types';

type Page = 'calendar' | 'search' | 'pay';
export function App({ app, visible = true }: { app: AppData; visible?: boolean }) {
  const [month, setMonth] = useState<Month>(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() + 1 }; });
  const [page, setPage] = useState<Page>('calendar');
  const [search, setSearch] = useState('');
  const [settings, setSettings] = useState<Settings>(() => { try { return loadSettings(localStorage, app.settingsKey()); } catch { return { hourly_wage: '', night_bonus_percent: '25' }; } });
  const [selection, setSelection] = useState<Selection | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const scroll = useRef<Record<Page, number>>({ calendar: 0, search: 0, pay: 0 });
  const pendingScroll = useRef<number | null>(null);
  function select(next: Selection) { returnFocus.current = document.activeElement as HTMLElement; setSelection(next); }
  function changePage(value: string) {
    const next = value as Page;
    if (next === page) return;
    scroll.current[page] = window.scrollY;
    pendingScroll.current = scroll.current[next];
    setPage(next);
  }
  useLayoutEffect(() => {
    if (pendingScroll.current != null) { window.scrollTo({ top: pendingScroll.current, behavior: 'instant' }); pendingScroll.current = null; }
    if (page === 'search' && window.matchMedia('(min-width: 760px)').matches) document.getElementById('staffSearchInput')?.focus({ preventScroll: true });
  }, [page]);
  // Wait for the selected calendar before warming adjacent months and sibling tabs.
  // Limit speculative upstream traffic to the existing three-month cache window.
  useEffect(() => {
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        if (!visible || document.hidden || app.ended) return;
        await app.client.fetchQuery(app.options(calendarDescriptor(month)));
        if (canceled || document.hidden || app.ended) return;
        await app.prefetch(searchDescriptor(month, ''));
        if (canceled || document.hidden || app.ended) return;
        if (validSettings(settings)) await app.prefetch(payDescriptor(month, settings));
        for (const delta of [1, -1]) {
          if (canceled || document.hidden || app.ended) return;
          const adjacent = moveMonth(month, delta);
          if (validMonth(adjacent)) await app.prefetch(calendarDescriptor(adjacent));
        }
      } catch { /* Visible queries present errors; speculative loads are best effort. */ }
    }, 450);
    return () => { canceled = true; clearTimeout(timer); };
    // Settings changes are handled by the pay query, never by a full prefetch sweep.
  }, [app, month, visible]);
  const headings = { calendar: ['カレンダー', '自分の予定と、一緒に働くメンバーを。'], search: ['スタッフ', '同じ店舗で働くメンバーのシフトを確認。'], pay: ['給与', '予定シフトから、今月の給与を見通す。'] };
  return <>
    <header className="app-header"><div className="header-inner"><a href={app.prefix ? '/sample' : '/'} className="brand"><span className="brand-icon"><CalendarDays size={21} aria-hidden="true" /></span><span>シフトビューア<small>RAKUSHIFU VIEWER</small></span></a>{app.prefix ? <a className="exit-link" href="/login">サンプルを終了<ArrowUpRight size={15} aria-hidden="true" /></a> : <form method="post" action="/logout" onSubmit={event => { event.preventDefault(); publishSessionChange(); app.end(false); const form = document.createElement('form'); form.method = 'post'; form.action = '/logout'; form.hidden = true; document.body.appendChild(form); form.submit(); }}><Button type="submit" variant="ghost"><LogOut size={17} aria-hidden="true" /><span>ログアウト</span></Button></form>}</div></header>
    <main className="page-shell">
      {app.prefix && <aside className="sample-notice" role="note"><Badge color="teal" size="sm" pill>DEMO</Badge><div><strong>サンプル表示 · すべて架空のデータです</strong><p>60人のスタッフと月ごとのシフトでお試しください。実際のらくしふへの通信は行いません。</p></div></aside>}
      <div className="page-heading"><div><p className="eyebrow">YOUR WORK, AT A GLANCE</p><h1>{headings[page][0]}</h1><p className="page-description">{headings[page][1]}</p></div><MonthSwitcher value={month} onChange={setMonth} label={page === 'calendar' ? 'カレンダーの表示月' : page === 'search' ? 'スタッフの表示月' : '給与の対象月'} /></div>
      <Tabs value={page} onValueChange={changePage} activationMode="manual">
        <nav className="floating-nav" aria-label="画面の切り替え"><TabsList aria-label="表示する画面"><TabsTrigger value="calendar" aria-label="カレンダーを表示"><CalendarDays size={20} aria-hidden="true" /><span>カレンダー</span></TabsTrigger><TabsTrigger value="search" aria-label="スタッフを表示" onPointerEnter={() => void app.prefetch(searchDescriptor(month, search.trim()))}><Users size={20} aria-hidden="true" /><span>スタッフ</span></TabsTrigger><TabsTrigger value="pay" aria-label="給与の概算を表示" onPointerEnter={() => { if (validSettings(settings)) void app.prefetch(payDescriptor(month, settings)); }}><Banknote size={20} aria-hidden="true" /><span>給与</span></TabsTrigger></TabsList></nav>
        <TabsContent value="calendar" forceMount hidden={page !== 'calendar'} className="page-content"><CalendarPage app={app} month={month} active={visible && page === 'calendar' && !selection} onDay={date => select({ kind: 'day', date })} /></TabsContent>
        <TabsContent value="search" forceMount hidden={page !== 'search'} className="page-content"><SearchPage app={app} month={month} active={visible && page === 'search' && !selection} search={search} setSearch={setSearch} onStaff={(id, staffMonth) => select({ kind: 'staff', id, month: staffMonth })} /></TabsContent>
        <TabsContent value="pay" forceMount hidden={page !== 'pay'} className="page-content"><PayPage app={app} month={month} active={visible && page === 'pay' && !selection} settings={settings} setSettings={setSettings} /></TabsContent>
      </Tabs>
    </main>
    <Details app={app} initial={selection} visible={visible} onClose={() => setSelection(null)} returnFocus={returnFocus.current} />
  </>;
}
