import { useEffect } from 'react';
import { AppData, calendarDescriptor, searchDescriptor, payDescriptor, staffDescriptor, dayDescriptor, monthLabel, validSettings, duration } from './data';
import { useDebounced, useView } from './hooks';
import { Empty, Icon, Loading, MonthSwitcher, Result } from './ui';
import { LoadingIndicator } from './components/arc/LoadingIndicator';
import type { CalendarData, Month, Person, PayData, Settings } from './types';

interface MonthProps { month: Month; onMonthChange?: (month: Month) => void }
export function CalendarPage({ app, month, onMonthChange = () => {}, active, onDay }: MonthProps & { app: AppData; active: boolean; onDay: (date: string) => void }) {
  const query = useView<CalendarData>(app, calendarDescriptor(month), active);
  const data = query.value;
  const shiftDays = data ? Object.values(data).filter(day => day.has_me).length : 0;
  const today = new Date();
  const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const first = new Date(0); first.setFullYear(month.year, month.month - 1, 1); first.setHours(0, 0, 0, 0);
  const days = new Date(month.year, month.month, 0).getDate();
  return <div className="calendar-layout" id="calendarPage">
    <div className="calendar-sidebar"><section className="month-panel" aria-label="表示中の月">
      <div className="month-panel-content"><p className="month-eyebrow">SHIFT CALENDAR</p><h1 className="month-display"><span className="month-num">{month.month}</span><span className="month-label">月</span><span className="month-year">{month.year}年</span></h1><p className="month-caption">シフトをひと目で。</p></div>
      <MonthSwitcher value={month} onChange={onMonthChange} label="カレンダーの表示月" variant="desktop" />
    </section></div>
    <section className="calendar-wrapper" aria-label={monthLabel(month) + 'のカレンダー'}>
      <div className="mobile-calendar-overview"><MonthSwitcher value={month} onChange={onMonthChange} label="カレンダーの表示月" /><p className="mobile-shift-summary" aria-live="polite">{data ? `自分の勤務日：${shiftDays}日` : <LoadingIndicator compact label="自分の勤務日を確認中" />}</p></div>
      <div className="calendar-header-row">{'日月火水木金土'.split('').map((day, i) => <div key={day} className={`calendar-header${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`}>{day}</div>)}</div>
      <Result state={query}>
        {data && <div className="calendar-grid">{Array.from({ length: first.getDay() + days }, (_, index) => {
          const day = index - first.getDay() + 1;
          if (day < 1) return <div className="calendar-day empty" key={index} aria-hidden="true" />;
          const date = `${String(month.year).padStart(4, '0')}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const entry = data[date] ?? { has_me: false, total_count: 0 };
          const otherCount = entry.total_count - (entry.has_me ? 1 : 0);
          return <button type="button" key={date} className={`calendar-day${entry.has_me ? ' has-my-shift' : ''}${date === todayString ? ' is-today' : ''}${index % 7 === 0 ? ' day-sun' : index % 7 === 6 ? ' day-sat' : ''}`} aria-label={`${month.month}月${day}日${entry.has_me ? ` 自分のシフト ${entry.my_shift_time || '未定'}〜${entry.my_shift_end_time || '未定'}` : ` 出勤${otherCount}人`}`} aria-current={date === todayString ? 'date' : undefined} onClick={() => onDay(date)} onFocus={() => void app.prefetch(dayDescriptor(date))} onPointerEnter={() => void app.prefetch(dayDescriptor(date))}>
            <span className="date-num">{day}</span>{entry.has_me ? <span className="shift-badge mine"><span className="shift-t">{entry.my_shift_time || ''}</span><span className="shift-sep">~</span><span className="shift-t">{entry.my_shift_end_time || ''}</span></span> : otherCount > 0 ? <span className="shift-badge other">{otherCount}人</span> : null}
          </button>;
        })}</div>}
      </Result>
    </section>
  </div>;
}

export function SearchPage({ app, month, onMonthChange = () => {}, active, search, setSearch, onStaff }: MonthProps & { app: AppData; active: boolean; search: string; setSearch: (value: string) => void; onStaff: (id: number, month: Month) => void }) {
  const debounced = useDebounced(search.trim());
  const query = useView<Person[]>(app, searchDescriptor(month, debounced), active);
  const current = debounced === search.trim();
  return <section className="search-page" aria-label="スタッフ">
    <div className="mobile-calendar-overview page-month-overview"><MonthSwitcher value={month} onChange={onMonthChange} label="スタッフの表示月" /></div>
    <div className="search-page-content">
      <label className="field-label" htmlFor="staffSearchInput">名前・従業員コード</label><input className="form-control" id="staffSearchInput" type="search" maxLength={100} autoComplete="off" placeholder="スタッフを検索" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="search-results" aria-live="polite">{current ? <Result state={query} label="検索中…">{query.value && (query.value.length ? query.value.map(person => <button key={person.user_id} type="button" className="search-person" onClick={() => onStaff(person.user_id, month)} onFocus={() => void app.prefetch(staffDescriptor(month, person.user_id))} onPointerEnter={() => void app.prefetch(staffDescriptor(month, person.user_id))}><span><strong>{person.name}</strong><small>{person.employee_code || 'コード未設定'}</small></span><Icon name="chevron-right" /></button>) : <Empty>該当するスタッフはいません</Empty>)}</Result> : <Loading label="検索中" />}</div>
    </div>
  </section>;
}

export function PayPage({ app, month, onMonthChange = () => {}, active, settings, setSettings }: MonthProps & { app: AppData; active: boolean; settings: Settings; setSettings: (settings: Settings) => void }) {
  const debounced = useDebounced(settings);
  const valid = validSettings(settings);
  const current = settings.hourly_wage === debounced.hourly_wage && settings.night_bonus_percent === debounced.night_bonus_percent;
  const query = useView<PayData>(app, payDescriptor(month, debounced), active && valid && current);
  useEffect(() => { if (!app.info || !valid) return; try { localStorage.setItem(app.settingsKey(), JSON.stringify(settings)); } catch { /* Storage is optional. */ } }, [app, settings, valid]);
  const data = current && valid ? query.value : undefined;
  return <section className="pay-page" aria-label="勤務時間と給与の概算">
    <div className="mobile-calendar-overview page-month-overview"><MonthSwitcher value={month} onChange={onMonthChange} label="給与の対象月" /></div>
    <div className="pay-page-content"><div className="pay-fields">
      <label className="field-label" htmlFor="hourlyWage">時給（円）<input className="form-control pay-input" id="hourlyWage" type="number" min={0} max={100000} step="1" inputMode="decimal" placeholder="時給を入力" value={settings.hourly_wage} onChange={e => setSettings({ ...settings, hourly_wage: e.target.value })} /></label>
      <label className="field-label" htmlFor="nightBonus">深夜割増率（%）<input className="form-control pay-input" id="nightBonus" type="number" min={0} max={500} step="1" inputMode="decimal" value={settings.night_bonus_percent} onChange={e => setSettings({ ...settings, night_bonus_percent: e.target.value })} /></label>
    </div>
    {!valid ? <p role="alert" className="field-error">時給は0〜100,000円、深夜割増率は0〜500%で入力してください</p> : !current ? <Loading label="計算中" /> : <Result state={query} label="計算中…">{data && <div aria-live="polite">
      <div className="pay-total"><span>給与の概算</span><strong>{settings.hourly_wage === '' ? '時給を入力してください' : `${data.estimated_yen.toLocaleString('ja-JP')}円`}</strong></div>
      {[['シフト', `${data.shift_count}件`], ['予定時間', duration(data.scheduled_minutes)], ['休憩', duration(data.break_minutes)], ['実働時間', duration(data.worked_minutes)], ['深夜時間', duration(data.night_minutes)]].map(([label, value]) => <div className="pay-row" key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </div>}</Result>}
    <p className="pay-note">{app.prefix ? '架空のシフトと休憩時刻' : 'らくしふのシフトと休憩時刻'}から計算した概算です。深夜帯は22:00〜翌5:00。残業・休日割増、交通費、税金は含みません。時給と割増率はこのブラウザに保存します。</p></div>
  </section>;
}
