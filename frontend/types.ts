export interface Month { year: number; month: number }
export interface Session { scope: string; user_id: number; expires_in: number | null }
export interface Settings { hourly_wage: string; night_bonus_percent: string }
export interface CalendarDay { has_me: boolean; total_count: number; my_shift_time?: string; my_shift_end_time?: string }
export type CalendarData = Record<string, CalendarDay>;
export interface Person { user_id: number; name: string; employee_code: string | null; rank: string | null; has_shift: boolean }
export interface Worker { user_id: number; name: string; age: number | null; rank: string | null; time: string; rest_times: string[]; is_me: boolean; is_overlapping: boolean; is_same_end: boolean }
export interface DayData { workers: Worker[]; has_my_shift: boolean; count: number }
export interface Schedule { date: string; date_display: string; day_of_week: string; time: string; rest_times: string[]; duration_minutes: number }
export interface StaffData { user_id: number; name: string; employee_code: string | null; birthday: string | null; age: number | null; total_work_minutes: number; schedules: Schedule[] }
export interface PayData { user_id: number; estimated_yen: number; shift_count: number; scheduled_minutes: number; break_minutes: number; worked_minutes: number; night_minutes: number }
export interface Descriptor { key: string; month: string; url: string; options?: RequestInit }
export interface Entry<T = unknown> { data: T; month: string; revision: string; fetchedAt: number; expiresAt: number; invalid: boolean }
export interface DataCache {
  scope: string | null; epoch: number; entries: Map<string, Entry>;
  get(descriptor: Descriptor): Promise<Entry>;
  peek(key: string): Entry | undefined;
  fresh(entry: Entry | undefined): boolean;
  clear(): void;
}
declare global {
  var ViewDataCache: new (fetcher: (url: string, options?: RequestInit) => Promise<Response>, options?: { onSessionChanged?: () => void }) => DataCache;
}
