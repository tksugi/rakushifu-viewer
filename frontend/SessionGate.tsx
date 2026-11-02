import { useEffect, useState } from 'react';
import { AppData } from './data';
import { App } from './App';
import { Loading } from './ui';
import { subscribeSessionChange } from './session-events';

export function SessionGate({ app }: { app: AppData }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let canceled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    async function check(conceal = false) {
      if (canceled || app.ended) return;
      if (conceal) { document.body.classList.add('session-checking'); setHidden(true); }
      try {
        await app.ensureSession(true);
        if (canceled || app.ended) return;
        document.body.classList.remove('session-checking');
        setReady(true); setHidden(false); setError('');
        // Refresh only active, expired views. Fresh cached views remain immediate.
        void app.client.refetchQueries({ type: 'active', stale: true });
        clearTimeout(heartbeat);
        if (!app.prefix && !document.hidden) heartbeat = setTimeout(() => void check(), 60000);
      } catch {
        if (canceled || app.ended) return;
        setError('認証状態を確認できませんでした。通信を確認して再試行してください。');
        clearTimeout(retry); retry = setTimeout(() => void check(conceal), 30000);
      }
    }
    void check(true);
    const visibility = () => {
      clearTimeout(heartbeat);
      if (document.hidden) {
        if (!app.prefix) { document.body.classList.add('session-checking'); setHidden(true); }
      } else void check(!app.prefix);
    };
    const pagehide = () => app.end(false);
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    const unsubscribe = app.prefix ? () => {} : subscribeSessionChange(() => app.end());
    return () => { canceled = true; clearTimeout(retry); clearTimeout(heartbeat); unsubscribe(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', pagehide); window.removeEventListener('pageshow', pageshow); };
  }, [app, attempt]);
  return <>
    {ready && <div hidden={hidden}><App app={app} visible={!hidden} /></div>}
    {(!ready || hidden) && <main className="session-state"><h1>認証状態を確認しています</h1>{error ? <><p role="alert">{error}</p><button className="btn-dismiss" onClick={() => setAttempt(value => value + 1)}>再試行</button></> : <Loading label="認証状態を確認中" />}</main>}
    {ready && !hidden && error && <div className="session-warning" role="status">{error}<button className="btn-dismiss" onClick={() => setAttempt(value => value + 1)}>再試行</button></div>}
  </>;
}
