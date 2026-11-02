import { useLayoutEffect, useRef, useState } from 'react';
import { Clock3, Coffee, ArrowLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent } from './registry/components/dialog/dialog';
import { AppData, dateParts, dayDescriptor, staffDescriptor, duration, validDate } from './data';
import { useView } from './hooks';
import { Badge, Button, Empty, MonthSwitcher, Result } from './ui';
import type { DayData, Month, StaffData } from './types';

export type Selection = { kind: 'day'; date: string } | { kind: 'staff'; id: number; month: Month };
interface Frame { selection: Selection; top: number; focus: string | null }

export function Details({ app, initial, visible = true, onClose, returnFocus }: { app: AppData; initial: Selection | null; visible?: boolean; onClose: () => void; returnFocus: HTMLElement | null }) {
  return <Dialog open={!!initial && visible} onOpenChange={open => { if (!open && visible) onClose(); }}>
    {initial && <DetailContent app={app} initial={initial} visible={visible} onClose={onClose} returnFocus={returnFocus} />}
  </Dialog>;
}

function DetailContent({ app, initial, visible, onClose, returnFocus }: { app: AppData; initial: Selection; visible: boolean; onClose: () => void; returnFocus: HTMLElement | null }) {
  const [frames, setFrames] = useState<Frame[]>([{ selection: initial, top: 0, focus: null }]);
  const frame = frames[frames.length - 1];
  const selection = frame.selection;
  const scroll = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const restored = useRef<Frame | null>(null);
  const day = useView<DayData>(app, dayDescriptor(selection.kind === 'day' ? selection.date : '2000-01-01'), visible && selection.kind === 'day');
  const staff = useView<StaffData>(app, staffDescriptor(selection.kind === 'staff' ? selection.month : { year: 2000, month: 1 }, selection.kind === 'staff' ? selection.id : 0), visible && selection.kind === 'staff');
  const query = selection.kind === 'day' ? day : staff;
  useLayoutEffect(() => {
    if (restored.current === frame) return;
    if (!query.value && !query.error) return;
    restored.current = frame;
    if (scroll.current) scroll.current.scrollTop = frame.top;
    const target = frame.focus ? Array.from(scroll.current?.querySelectorAll<HTMLElement>('[data-focus-key]') ?? []).find(node => node.dataset.focusKey === frame.focus) : titleRef.current;
    target?.focus({ preventScroll: true });
  }, [frame, query.value, query.error]);
  function push(next: Selection) {
    const focused = document.activeElement as HTMLElement | null;
    const saved = { ...frame, top: scroll.current?.scrollTop ?? 0, focus: focused?.dataset.focusKey ?? null };
    setFrames([...frames.slice(0, -1), saved, { selection: next, top: 0, focus: null }].slice(-20));
  }
  function back() { if (frames.length === 1) onClose(); else setFrames(frames.slice(0, -1)); }
  const date = selection.kind === 'day' ? selection.date : '';
  const dayLabel = date ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : '';
  const dateObj = new Date(`${date || '2000-01-01'}T00:00:00`);
  const title = selection.kind === 'day' ? dayLabel : staff.value?.name || 'スタッフ詳細';
  const description = selection.kind === 'day' ? `${date.slice(0, 4)}年 ${'日月火水木金土'[dateObj.getDay()]}曜日` : '月間シフトと勤務時間';
  return <DialogContent title={title} description={description} className="detail-dialog" onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus({ preventScroll: true }); }} onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
    <div className="detail-scroll" ref={scroll}>
      <h2 tabIndex={-1} className="sr-only" ref={titleRef}>{title}</h2>
      {selection.kind === 'staff' && <MonthSwitcher value={selection.month} label="スタッフシフトの表示月" onChange={month => setFrames([...frames.slice(0, -1), { selection: { ...selection, month }, top: 0, focus: null }])} />}
      <Result state={query}>
        {selection.kind === 'day' && day.value && <>
          <div className="detail-summary"><span>出勤するスタッフ</span><strong>{day.value.count}<small>人</small></strong></div>
          {day.value.workers.length ? day.value.workers.map((worker, index, workers) => <div key={`${worker.user_id}:${index}`}>
            {day.value!.has_my_shift && index > 0 && workers[index - 1].is_me && <p className="group-label">一緒に出勤するスタッフ</p>}
            {day.value!.has_my_shift && !worker.is_me && !worker.is_overlapping && (index === 0 || workers[index - 1].is_me || workers[index - 1].is_overlapping) && <p className="group-label">時間が被っていないスタッフ</p>}
            <article className={`worker-card ${worker.is_me ? 'is-me' : ''} ${worker.is_same_end ? 'same-end' : ''}`}>
              <div className="worker-header"><button className="text-button worker-name" type="button" data-focus-key={`worker:${worker.user_id}`} onClick={() => push({ kind: 'staff', id: worker.user_id, month: dateParts(date) })} onPointerEnter={() => void app.prefetch(staffDescriptor(dateParts(date), worker.user_id))}>{worker.name}<ChevronRight size={14} aria-hidden="true" /></button><span className="worker-badges">{worker.is_me ? <Badge color="teal" size="sm">あなた</Badge> : worker.is_same_end ? <Badge color="violet" size="sm">Last · 同じ退勤時刻</Badge> : null}</span></div>
              {(worker.age != null || worker.rank) && <p className="worker-meta">{worker.age != null ? `${worker.age}歳` : ''}{worker.rank ? ` ${worker.rank}` : ''}</p>}
              <p className="work-time"><Clock3 size={16} aria-hidden="true" />{worker.time}</p>
              {worker.rest_times?.length ? <p className="rest-time"><Coffee size={15} aria-hidden="true" />休憩 {worker.rest_times.join(', ')}</p> : null}
            </article>
          </div>) : <Empty>予定されているシフトはありません</Empty>}
        </>}
        {selection.kind === 'staff' && staff.value && <>
          <div className="staff-profile"><span className="avatar large" aria-hidden="true">{staff.value.name.slice(0, 1)}</span><div><p>従業員ID：{staff.value.employee_code || '未設定'}</p><p>誕生日：{staff.value.birthday?.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1/$2/$3') || '未設定'}（{staff.value.age != null ? `${staff.value.age}歳` : '年齢未設定'}）</p></div></div>
          {staff.value.schedules.length ? <><div className="schedule-summary"><span>表示月の勤務時間合計</span><strong>{duration(staff.value.total_work_minutes)}</strong><small>休憩を除く予定の実働時間</small></div><div className="schedule-list">{staff.value.schedules.map((schedule, index) => <div className="schedule-row" key={`${schedule.date}:${index}`}>
            <button type="button" className="schedule-date" data-focus-key={`date:${schedule.date}`} disabled={!validDate(schedule.date)} onClick={() => push({ kind: 'day', date: schedule.date })} onPointerEnter={() => { if (validDate(schedule.date)) void app.prefetch(dayDescriptor(schedule.date)); }}><strong>{schedule.date_display}</strong><small>{schedule.day_of_week}曜日</small></button>
            <div><p className="work-time"><Clock3 size={15} aria-hidden="true" />{schedule.time}</p>{schedule.rest_times?.length ? <p className="rest-time">休憩 {schedule.rest_times.join(', ')}</p> : null}</div>
          </div>)}</div></> : <Empty>この月の出勤予定はありません</Empty>}
        </>}
      </Result>
    </div>
    <div className="detail-footer"><Button variant="secondary" onClick={back}><ArrowLeft size={16} aria-hidden="true" />戻る</Button></div>
  </DialogContent>;
}
