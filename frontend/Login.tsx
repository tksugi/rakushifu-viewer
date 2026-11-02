import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, ArrowRight, ArrowUpRight, ShieldCheck, AlertCircle } from 'lucide-react';
import { Button, Input } from './ui';
import { publishSessionChange } from './session-events';

export function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    const form = event.currentTarget;
    const fields = new FormData(form);
    try {
      const response = await fetch('/login', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_code: fields.get('employee_code'), password: fields.get('password') }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'ログインに失敗しました');
      form.reset(); publishSessionChange(); window.location.assign('/');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '通信エラーが発生しました');
      requestAnimationFrame(() => errorRef.current?.focus());
      submitting.current = false; setBusy(false);
    }
  }
  return <main className="login-page"><div className="login-story"><a className="brand" href="/login"><span className="brand-icon"><CalendarDays size={21} aria-hidden="true" /></span><span>シフトビューア<small>RAKUSHIFU VIEWER</small></span></a><div className="login-copy"><p className="eyebrow">A LITTLE CLARITY, EVERY DAY</p><h1>次のシフトを、<br />気持ちよく。</h1><p>予定も、一緒に働くメンバーも。<br />知りたいことを、ひとつの画面で。</p><div className="login-calendar-art" aria-hidden="true"><div><span>MY SCHEDULE</span><CalendarDays size={18} /></div><p>シフトをひと目で。</p><div className="art-grid">{Array.from({ length: 14 }, (_, i) => <span key={i} className={[1, 3, 5, 8, 10].includes(i) ? 'filled' : ''}>{i + 1}</span>)}</div></div></div><span className="login-footnote">らくしふ非公式の閲覧アプリ</span></div>
    <div className="login-form-side"><section className="login-card"><span className="login-mark"><CalendarDays size={27} aria-hidden="true" /></span><p className="eyebrow">WELCOME BACK</p><h2>ログイン</h2><p className="login-subtitle">らくしふの従業員アカウントを使用します。</p>
      {error && <div className="update-error" role="alert" tabIndex={-1} ref={errorRef}><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
      <form id="loginForm" method="post" action="/login" onSubmit={submit}><Input label="従業員ID" id="employeeCode" name="employee_code" type="text" maxLength={50} autoComplete="username" required placeholder="従業員IDを入力" /><Input label="パスワード" id="password" name="password" type="password" maxLength={500} autoComplete="current-password" required placeholder="パスワードを入力" /><Button type="submit" id="btnLogin" className="login-submit" loading={busy}>{busy ? 'ログイン中…' : 'ログイン'}<ArrowRight size={17} aria-hidden="true" /></Button></form>
      <div className="sample-entry"><a href="/sample">ログインなしでサンプルを試す<ArrowUpRight size={16} aria-hidden="true" /></a><p>架空のスタッフ・シフトで各機能を確認できます。</p></div><p className="privacy-note"><ShieldCheck size={16} aria-hidden="true" />パスワードはアプリに保存しません。</p>
    </section></div></main>;
}
