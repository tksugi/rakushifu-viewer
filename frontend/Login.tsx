import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Icon } from './ui';
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
  return <main className="login-container"><div className="login-card">
    <div className="login-header"><div className="login-icon"><Icon name="calendar3" /></div><h1 className="login-title">シフト管理</h1><p className="login-subtitle">らくしふの従業員アカウントでログイン</p></div>
    <div className="login-body">
      {error && <div className="error-message show" role="alert" tabIndex={-1} ref={errorRef}><Icon name="exclamation-circle" /><span>{error}</span></div>}
      <form id="loginForm" method="post" action="/login" onSubmit={submit}>
        <div className="form-group"><label className="form-label-custom" htmlFor="employeeCode">従業員ID</label><input type="text" className="form-input" id="employeeCode" name="employee_code" placeholder="従業員IDを入力" maxLength={50} autoComplete="username" required /></div>
        <div className="form-group"><label className="form-label-custom" htmlFor="password">パスワード</label><input type="password" className="form-input" id="password" name="password" placeholder="パスワードを入力" maxLength={500} autoComplete="current-password" required /></div>
        <button type="submit" className="btn-login" id="btnLogin" disabled={busy}>{busy ? <><span className="spinner-border spinner-border-sm" aria-hidden="true" />ログイン中...</> : <><Icon name="box-arrow-in-right" />ログイン</>}</button>
      </form>
      <div className="text-center mt-3"><a href="/sample">ログインなしでサンプルを試す</a><p className="small text-secondary mt-2 mb-0">架空のスタッフ・シフトで各機能を確認できます。</p></div>
    </div>
  </div></main>;
}
