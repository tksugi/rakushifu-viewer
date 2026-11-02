import { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppData } from './data';
const SessionGate = lazy(() => import('./SessionGate').then(module => ({ default: module.SessionGate })));
const Login = lazy(() => import('./Login').then(module => ({ default: module.Login })));
import './style.css';


const root = createRoot(document.getElementById('root')!);
const isLogin = document.body.dataset.page === 'login';
const app = new AppData(document.body.dataset.apiPrefix || '', redirect => {
  // Unmount private content synchronously before navigating or submitting logout.
  flushSync(() => root.render(<main className="session-state"><p>ログイン画面に移動します…</p></main>));
  if (redirect) window.location.replace('/login');
});
root.render(<>{isLogin ? <Suspense fallback={<p>ログイン画面を読み込んでいます。</p>}><Login /></Suspense> : <QueryClientProvider client={app.client}><Suspense fallback={<p>画面を読み込んでいます。</p>}><SessionGate app={app} /></Suspense></QueryClientProvider>}</>);
