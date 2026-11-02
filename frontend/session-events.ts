const name = 'shift-session-change';
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
export function publishSessionChange() {
  if (channel) channel.postMessage('changed');
  else { try { localStorage.setItem(name, `${Date.now()}-${Math.random()}`); } catch { /* Session checks also run on return. */ } }
}
export function subscribeSessionChange(listener: () => void) {
  if (channel) { channel.addEventListener('message', listener); return () => channel.removeEventListener('message', listener); }
  const onStorage = (event: StorageEvent) => { if (event.key === name) listener(); };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
