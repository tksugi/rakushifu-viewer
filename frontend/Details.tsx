import { useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AppData, dateParts, dayDescriptor, staffDescriptor, duration, validDate } from './data';
import { useView } from './hooks';
import { Empty, Icon, MonthSwitcher, Result } from './ui';
import type { DayData, Month, StaffData } from './types';

export type Selection = { kind: 'day'; date: string } | { kind: 'staff'; id: number; month: Month };
interface Frame { selection: Selection; top: number; focus: string | null }

export function Details({ app, initial, visible = true, onClose, returnFocus }: { app: AppData; initial: Selection | null; visible?: boolean; onClose: () => void; returnFocus: HTMLElement | null }) {
  return <Dialog.Root open={!!initial && visible} onOpenChange={open => { if (!open && visible) onClose(); }}>
    {initial && <DetailContent app={app} initial={initial} visible={visible} onClose={onClose} returnFocus={returnFocus} />}
  </Dialog.Root>;
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
    if (restored.current === frame || (!query.value && !query.error)) return;
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
  const dateObj = new Date(`${date || '2000-01-01'}T00:00:00`);
  const title = selection.kind === 'day' ? `${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` : staff.value?.name || 'スタッフ詳細';
  return <Dialog.Portal>
    <Dialog.Overlay className="modal-backdrop show" />
    <Dialog.Content id="detailModal" className="react-detail-dialog modal-dialog-scrollable" onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.focus({ preventScroll: true }); }} onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}>
      <div className="modal-content">
        <div className="modal-header-custom"><div className="modal-heading">
          <Dialog.Title asChild><h5 className="modal-title" tabIndex={-1} ref={titleRef}>{title}</h5></Dialog.Title>
          <Dialog.Description asChild><div>{selection.kind === 'day' ? <div className="modal-date-sub">{date.slice(0, 4)}年 {'日月火水木金土'[dateObj.getDay()]}曜日</div> : <><div className="modal-date-sub">従業員ID: {staff.value?.employee_code || '—'}</div><div className="modal-date-sub">誕生日: {staff.value ? `${staff.value.birthday?.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, '$1/$2/$3') || '未設定'} (${staff.value.age != null ? `${staff.value.age}歳` : '年齢未設定'})` : '—'}</div></>}</div></Dialog.Description>
        </div></div>
        <div className="modal-body detail-scroll" ref={scroll}>
          {selection.kind === 'staff' && <MonthSwitcher value={selection.month} variant="staff" label="スタッフシフトの表示月" onChange={month => setFrames([...frames.slice(0, -1), { selection: { ...selection, month }, top: 0, focus: null }])} />}
          <Result state={query}>
            {selection.kind === 'day' && day.value && (day.value.workers.length ? day.value.workers.map((worker, index, workers) => <div key={`${worker.user_id}:${index}`}>
              {day.value!.has_my_shift && index > 0 && workers[index - 1].is_me && <div className="separator">一緒に出勤するスタッフ</div>}
              {day.value!.has_my_shift && !worker.is_me && !worker.is_overlapping && (index === 0 || workers[index - 1].is_me || workers[index - 1].is_overlapping) && <div className="separator">時間が被っていないスタッフ</div>}
              <div className={`shift-detail-card${worker.is_me ? ' is-me' : worker.is_same_end ? ' same-end' : ''}`}>
                <div className="worker-card-header"><div className="worker-identity"><button className="worker-name-link" type="button" data-focus-key={`worker:${worker.user_id}`} onClick={() => push({ kind: 'staff', id: worker.user_id, month: dateParts(date) })} onPointerEnter={() => void app.prefetch(staffDescriptor(dateParts(date), worker.user_id))}><span className="worker-name">{worker.name}</span></button>{worker.age ? <span className="worker-age">{worker.age}歳</span> : null}{worker.rank && <span className="worker-rank">{worker.rank}</span>}</div><div className="worker-badges">{worker.is_me ? <span className="badge-me">あなた</span> : worker.is_same_end ? <span className="same-end-badge"><Icon name="stars" />Last</span> : null}</div></div>
                <div className="worker-time"><Icon name="clock" />{worker.time}</div>{worker.rest_times?.length ? <div className="worker-time"><Icon name="cup-hot" />休憩 {worker.rest_times.join(', ')}</div> : null}
              </div>
            </div>) : <Empty>予定されているシフトはありません</Empty>)}
            {selection.kind === 'staff' && staff.value && (staff.value.schedules.length ? <>
              <div className="schedule-summary"><div className="schedule-summary-label">表示月の勤務時間合計</div><div className="schedule-summary-value">{duration(staff.value.total_work_minutes)}</div></div>
              <div className="schedule-list">{staff.value.schedules.map((schedule, index) => <div className="schedule-item" key={`${schedule.date}:${index}`}>
                <button type="button" className="schedule-date schedule-date-btn" data-focus-key={`date:${schedule.date}`} disabled={!validDate(schedule.date)} onClick={() => push({ kind: 'day', date: schedule.date })} onPointerEnter={() => { if (validDate(schedule.date)) void app.prefetch(dayDescriptor(schedule.date)); }}><span className="schedule-date-main">{schedule.date_display}</span><span className="schedule-dow">({schedule.day_of_week})</span></button>
                <div className="schedule-time"><span className="schedule-time-main"><Icon name="clock" />{schedule.time}</span></div>
                {schedule.rest_times?.length ? <div className="schedule-rest"><span>休憩</span>{schedule.rest_times.map((time, i) => <span key={i}>{time}</span>)}</div> : null}
              </div>)}</div>
            </> : <Empty>この月の出勤予定はありません</Empty>)}
          </Result>
        </div>
        <div className="modal-footer-custom"><button type="button" className="btn-dismiss" onClick={back}>戻る</button></div>
      </div>
    </Dialog.Content>
  </Dialog.Portal>;
}
