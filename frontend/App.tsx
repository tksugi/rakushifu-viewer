import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarPage, SearchPage, PayPage } from './pages';
import { Details } from './Details';
import type { Selection } from './Details';
import { AppData, calendarDescriptor, searchDescriptor, payDescriptor, loadSettings, moveMonth, validMonth, validSettings } from './data';
import { Icon } from './ui';
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
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update(); window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <>
    <header className={`app-header${scrolled ? ' scrolled' : ''}`} id="appHeader">
      <div className="header-inner">
        <div className="brand-lockup"><span className="brand-icon" aria-hidden="true"><Icon name="calendar2-week" /></span><span>シフトビューア</span></div>
        {app.prefix ? <a className="logout-link" href="/login">サンプルを終了</a> : <form method="post" action="/logout" onSubmit={event => {
          event.preventDefault(); publishSessionChange(); app.end(false);
          const form = document.createElement('form'); form.method = 'post'; form.action = '/logout'; form.hidden = true; document.body.appendChild(form); form.submit();
        }}><button className="logout-link" type="submit" aria-label="ログアウト"><Icon name="box-arrow-right" /><span>ログアウト</span></button></form>}
      </div>
    </header>
    <main className="page-shell">
      {app.prefix && <aside className="sample-notice" role="note"><strong>サンプル表示 · すべて架空のデータです</strong><span>60人のスタッフと月ごとのシフトで、カレンダー・検索・給与概算をお試しください。実際のらくしふへの通信は行いません。</span></aside>}
      <div hidden={page !== 'calendar'}><CalendarPage app={app} month={month} onMonthChange={setMonth} active={visible && page === 'calendar' && !selection} onDay={date => select({ kind: 'day', date })} /></div>
      <div hidden={page !== 'search'}><SearchPage app={app} month={month} onMonthChange={setMonth} active={visible && page === 'search' && !selection} search={search} setSearch={setSearch} onStaff={(id, staffMonth) => select({ kind: 'staff', id, month: staffMonth })} /></div>
      <div hidden={page !== 'pay'}><PayPage app={app} month={month} onMonthChange={setMonth} active={visible && page === 'pay' && !selection} settings={settings} setSettings={setSettings} /></div>
    </main>
    <nav className="floating-nav" aria-label="画面の切り替え">
      {([['calendar', 'calendar3', 'カレンダー', 'カレンダーを表示'], ['search', 'people', 'スタッフ', 'スタッフを表示'], ['pay', 'cash-coin', '給与', '給与の概算を表示']] as const).map(([value, icon, text, label]) => <button key={value} type="button" className={`dock-item dock-page${page === value ? ' is-active' : ''}`} aria-label={label} aria-current={page === value ? 'page' : undefined} title={label} onClick={() => changePage(value)}><Icon name={icon} /><span>{text}</span></button>)}
    </nav>
    <Details app={app} initial={selection} visible={visible} onClose={() => setSelection(null)} returnFocus={returnFocus.current} />
  </>;
}
