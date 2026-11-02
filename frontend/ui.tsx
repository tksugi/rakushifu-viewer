import { ChevronLeft, ChevronRight, CalendarDays, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './registry/components/button/button';
import { Skeleton } from './registry/components/skeleton/skeleton';
import { monthLabel, moveMonth, validMonth } from './data';
import type { Month, Entry } from './types';
import type { ReactNode } from 'react';

export { Button };
export { Input } from './registry/components/input/input';
export { Badge } from './registry/components/badge/badge';

export function MonthSwitcher({ value, onChange, label = '表示月' }: { value: Month; onChange: (month: Month) => void; label?: string }) {
  return <div className="month-switcher" role="group" aria-label={label}>
    <Button variant="ghost" className="icon-button" aria-label="前月" disabled={!validMonth(moveMonth(value, -1))} onClick={() => onChange(moveMonth(value, -1))}><ChevronLeft aria-hidden="true" size={19} /></Button>
    <span aria-live="polite">{monthLabel(value)}</span>
    <Button variant="ghost" className="icon-button" aria-label="次月" disabled={!validMonth(moveMonth(value, 1))} onClick={() => onChange(moveMonth(value, 1))}><ChevronRight aria-hidden="true" size={19} /></Button>
  </div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state"><CalendarDays size={32} aria-hidden="true" /><p>{children}</p></div>; }

interface ResultState {
  error: Error | null; isFetching: boolean; data?: Entry<unknown>; value?: unknown; revoked?: boolean; refetch: () => unknown;
}
export function Result({ state, children, label = '読み込み中' }: { state: ResultState; children: ReactNode; label?: string }) {
  if (state.revoked) return <Empty>このスタッフは現在の表示対象に含まれていません</Empty>;
  if (!state.value && !state.error) return <div className="loading-state"><Skeleton label={label} lines={5} /></div>;
  return <>
    {state.error ? <div className="update-error" role="status"><AlertCircle size={17} aria-hidden="true" /><span>{state.value ? '更新できませんでした。取得済みのデータを表示しています。' : state.error.message || 'データを取得できませんでした'}{state.value && state.data ? <small>最終取得：{new Date(state.data.fetchedAt).toLocaleString('ja-JP')}</small> : null}</span><Button variant="ghost" size="sm" onClick={() => state.refetch()} loading={state.isFetching}>再試行</Button></div> : state.isFetching && state.value ? <p className="updating" role="status"><RefreshCw size={13} aria-hidden="true" />更新中…</p> : null}
    {children}
  </>;
}
