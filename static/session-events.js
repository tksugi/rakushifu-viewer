/* Broadcast only a change notification, never an account ID or private data. */
(function () {
    const listeners = new Set();
    const name = 'shift-session-change';
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(name) : null;
    const notify = () => listeners.forEach(listener => listener());
    if (channel) channel.onmessage = notify;
    window.addEventListener('storage', event => {
        if (!channel && event.key === name) notify();
    });
    window.shiftSessionEvents = {
        subscribe: listener => listeners.add(listener),
        publish: () => {
            if (channel) channel.postMessage('changed');
            else {
                try { localStorage.setItem(name, `${Date.now()}-${Math.random()}`); }
                catch (error) { /* The session check on return is still required. */ }
            }
        },
    };
})();
