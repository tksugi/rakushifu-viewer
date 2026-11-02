import { Clock3, Moon, Search, ChevronRight, CalendarDays, Coffee, ArrowUpRight, Users, Banknote } from 'lucide-react';
import { useEffect } from 'react';
import { AppData, calendarDescriptor, searchDescriptor, payDescriptor, staffDescriptor, dayDescriptor, monthLabel, validSettings, duration } from './data';
import { useDebounced, useView } from './hooks';
import { Badge, Empty, Input, Result } from './ui';
import type { CalendarData, Month, Person, PayData, Settings } from './types';

export function CalendarPage({ app, month, active, onDay }: { app: AppData; month: Month; active: boolean; onDay: (date: string) => void }) {
  const query = useView<CalendarData>(app, calendarDescriptor(month), active);
  const data = query.value;
  const shiftDays = data ? Object.values(data).filter(day => day.has_me).length : 0;
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const first = new Date(0); first.setFullYear(month.year, month.month - 1, 1); first.setHours(0, 0, 0, 0);
  const days = new Date(month.year, month.month, 0).getDate();
  const slots = first.getDay() + days;
  return <div className="calendar-layout">
    <aside className="month-panel">
      <div><p className="eyebrow">MY SHIFT</p><p className="large-month">{String(month.month).padStart(2, '0')}<span>月</span></p><p className="year-label">{month.year}</p></div>
      <div className="month-panel-bottom"><span className="panel-icon"><CalendarDays size={23} aria-hidden="true" /></span><p>今月の勤務日</p><strong aria-live="polite">{data ? shiftDays : '—'}<small>日</small></strong><p className="panel-caption">日付を選んで、一緒に働く<br />メンバーを確認しましょう。</p></div>
    </aside>
    <section className="calendar-card" aria-label={monthLabel(month) + 'のカレンダー'}>
      <div className="calendar-caption"><span><span className="legend-dot" />自分のシフト</span><span>日付を選ぶと詳細を表示</span></div>
      <Result state={query}>
        {data && <><div className="calendar-weekdays">{'日月火水木金土'.split('').map((day, i) => <span key={day} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{day}</span>)}</div>
        <div className="calendar-grid">{Array.from({ length: Math.ceil(slots / 7) * 7 }, (_, index) => {
          const day = index - first.getDay() + 1;
          if (day < 1 || day > days) return <div className="calendar-day outside" key={index} aria-hidden="true" />;
          const date = `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const entry = data[date] ?? { has_me: false, total_count: 0 };
          const otherCount = entry.total_count - (entry.has_me ? 1 : 0);
          return <button type="button" key={date} className={`calendar-day ${entry.has_me ? 'mine' : ''} ${date === todayString ? 'today' : ''} ${index % 7 === 0 ? 'sun' : index % 7 === 6 ? 'sat' : ''}`} aria-label={`${month.month}月${day}日${entry.has_me ? ` 自分のシフト ${entry.my_shift_time || '未定'}〜${entry.my_shift_end_time || '未定'}` : ` 出勤${otherCount}人`}`} aria-current={date === todayString ? 'date' : undefined} onClick={() => onDay(date)} onFocus={() => void app.prefetch(dayDescriptor(date))} onPointerEnter={() => void app.prefetch(dayDescriptor(date))}>
            <span className="date-number">{day}</span>{entry.has_me ? <span className="shift-time"><span>{entry.my_shift_time || '未定'}</span><span className="time-divider">–</span><span>{entry.my_shift_end_time || '未定'}</span></span> : otherCount > 0 ? <span className="other-count"><Users size={12} aria-hidden="true" />{otherCount}<span className="count-unit">人</span></span> : null}
          </button>;
        })}</div></>}
      </Result>
    </section>
  </div>;
}

export function SearchPage({ app, month, active, search, setSearch, onStaff }: { app: AppData; month: Month; active: boolean; search: string; setSearch: (value: string) => void; onStaff: (id: number, month: Month) => void }) {
  const debounced = useDebounced(search.trim());
  const query = useView<Person[]>(app, searchDescriptor(month, debounced), active);
  // Search conditions never display the previous query's results during the debounce.
  const current = debounced === search.trim();
  return <section className="staff-page surface">
    <div className="section-heading"><div><p className="eyebrow">YOUR TEAM</p><h2>スタッフを探す</h2></div><span className="section-mark"><Users size={25} aria-hidden="true" /></span></div>
    <div className="search-input"><Search size={19} aria-hidden="true" /><Input label="名前・従業員コード" id="staffSearchInput" type="search" maxLength={100} autoComplete="off" placeholder="スタッフを検索" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {current ? <Result state={query} label="スタッフを検索中">
      {query.value && <><p className="result-count">{query.value.length}人のスタッフ</p><div className="people-list">{query.value.length ? query.value.map(person => <button key={person.user_id} type="button" className="person-row" onClick={() => onStaff(person.user_id, month)} onFocus={() => void app.prefetch(staffDescriptor(month, person.user_id))} onPointerEnter={() => void app.prefetch(staffDescriptor(month, person.user_id))}>
        <span className="avatar" aria-hidden="true">{person.name.slice(0, 1)}</span><span className="person-identity"><strong>{person.name}</strong><small>{person.employee_code || 'コード未設定'}</small></span><ChevronRight size={17} aria-hidden="true" />
      </button>) : <Empty>該当するスタッフはいません</Empty>}</div></>}
    </Result> : <p className="loading-state" role="status">検索中…</p>}
  </section>;
}

export function PayPage({ app, month, active, settings, setSettings }: { app: AppData; month: Month; active: boolean; settings: Settings; setSettings: (settings: Settings) => void }) {
  const debounced = useDebounced(settings);
  const valid = validSettings(settings);
  const current = settings.hourly_wage === debounced.hourly_wage && settings.night_bonus_percent === debounced.night_bonus_percent;
  const query = useView<PayData>(app, payDescriptor(month, debounced), active && valid && current);
  useEffect(() => {
    if (!app.info || !valid) return;
    try { localStorage.setItem(app.settingsKey(), JSON.stringify(settings)); } catch { /* Input still works without storage. */ }
  }, [app, settings, valid]);
  const data = current && valid ? query.value : undefined;
  return <div className="pay-layout">
    <section className="surface pay-settings"><div className="section-heading"><div><p className="eyebrow">PAY SETTINGS</p><h2>給与の設定</h2></div><span className="section-mark"><Banknote size={25} aria-hidden="true" /></span></div>
      <Input label="時給（円）" id="hourlyWage" type="number" min={0} max={100000} step="any" inputMode="decimal" placeholder="時給を入力" value={settings.hourly_wage} onChange={e => setSettings({ ...settings, hourly_wage: e.target.value })} error={!Number.isFinite(Number(settings.hourly_wage)) || Number(settings.hourly_wage) < 0 || Number(settings.hourly_wage) > 100000 ? '0〜100,000円で入力してください' : undefined} />
      <Input label="深夜割増率（%）" id="nightBonus" type="number" min={0} max={500} step="any" inputMode="decimal" value={settings.night_bonus_percent} onChange={e => setSettings({ ...settings, night_bonus_percent: e.target.value })} error={settings.night_bonus_percent.trim() === '' || !Number.isFinite(Number(settings.night_bonus_percent)) || Number(settings.night_bonus_percent) < 0 || Number(settings.night_bonus_percent) > 500 ? '0〜500%で入力してください' : undefined} />
      <p className="settings-note"><Moon size={16} aria-hidden="true" />深夜帯は22:00〜翌5:00です。</p>
    </section>
    <section className="surface pay-results" aria-label="勤務時間と給与の概算"><div className="pay-total"><Badge color="teal" pill>予定シフトからの概算</Badge><h2>今月の給与概算</h2><p className={`pay-amount ${settings.hourly_wage === '' || !valid ? 'hint' : ''}`} aria-live="polite">{!valid ? '入力を確認してください' : !current ? '計算中…' : settings.hourly_wage === '' ? '時給を入力してください' : data ? <>{data.estimated_yen.toLocaleString('ja-JP')}<small>円</small></> : '—'}</p><span className="pay-month">{monthLabel(month)}</span></div>
      {valid && current ? <Result state={query} label="給与を計算中">{data && <div className="pay-breakdown">{[
        ['シフト', `${data.shift_count}件`, CalendarDays], ['予定時間', duration(data.scheduled_minutes), Clock3], ['休憩', duration(data.break_minutes), Coffee], ['実働時間', duration(data.worked_minutes), ArrowUpRight], ['深夜時間', duration(data.night_minutes), Moon],
      ].map(([label, value, Icon]) => { const Glyph = Icon as typeof Clock3; return <div className="pay-row" key={String(label)}><span><Glyph size={17} aria-hidden="true" />{String(label)}</span><strong>{String(value)}</strong></div>; })}</div>}</Result> : null}
      <p className="pay-note">{app.prefix ? '架空のシフトと休憩時刻' : 'らくしふのシフトと休憩時刻'}から計算した概算です。残業・休日割増、交通費、税金は含みません。時給と割増率はこのブラウザに保存します。</p>
    </section>
  </div>;
}
