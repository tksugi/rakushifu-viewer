import { monthLabel, moveMonth, validMonth } from './data';
import type { Month, Entry } from './types';
import type { ReactNode } from 'react';

export function Icon({ name }: { name: string }) { return <i className={`bi bi-${name}`} aria-hidden="true" />; }

export function MonthSwitcher({ value, onChange, label = '表示月', variant = 'mobile' }: { value: Month; onChange: (month: Month) => void; label?: string; variant?: 'mobile' | 'desktop' | 'staff' }) {
  return <div className={variant === 'desktop' ? 'month-switcher' : variant === 'staff' ? 'staff-month-switcher' : 'mobile-month-switcher'} role="group" aria-label={label}>
    <button type="button" className="month-switch-btn" aria-label="前月" title="前月" disabled={!validMonth(moveMonth(value, -1))} onClick={() => onChange(moveMonth(value, -1))}><Icon name="chevron-left" /></button>
    {variant === 'staff' ? <span aria-live="polite">{monthLabel(value)}</span> : variant === 'mobile' ? <h1 aria-live="polite">{monthLabel(value)}</h1> : null}
    <button type="button" className="month-switch-btn" aria-label="次月" title="次月" disabled={!validMonth(moveMonth(value, 1))} onClick={() => onChange(moveMonth(value, 1))}><Icon name="chevron-right" /></button>
  </div>;
}
export function Empty({ children }: { children: ReactNode }) { return <div className="empty-state"><div className="empty-state-icon"><Icon name="calendar-x" /></div><p>{children}</p></div>; }
export function Loading({ label = '読み込み中…' }: { label?: string }) { return <div className="loading-placeholder" role="status" aria-label={label}><div className="spinner-ring" aria-hidden="true" /><span className="loading-text">{label}</span></div>; }

interface ResultState { error: Error | null; isFetching: boolean; data?: Entry<unknown>; value?: unknown; revoked?: boolean; refetch: () => unknown }
export function Result({ state, children, label = '読み込み中…' }: { state: ResultState; children: ReactNode; label?: string }) {
  if (state.revoked) return <Empty>このスタッフは現在の表示対象に含まれていません</Empty>;
  if (!state.value && !state.error) return <Loading label={label} />;
  return <>
    {state.error ? <p className="data-update-status" role="status">{state.value ? '更新できませんでした。' : state.error.message || 'データを取得できませんでした'}{state.value && state.data ? ` 最終取得：${new Date(state.data.fetchedAt).toLocaleString('ja-JP')}` : ''}<button type="button" onClick={() => state.refetch()} disabled={state.isFetching}>再試行</button></p> : state.isFetching && state.value ? <p className="data-update-status" role="status">更新中…</p> : null}
    {children}
  </>;
}
