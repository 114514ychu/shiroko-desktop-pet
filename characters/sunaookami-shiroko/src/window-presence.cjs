// A pet has no minimize button, but Windows Show Desktop can still suppress it.
// Track user intent separately from the native window state and never focus it.
function maintainPetPresence(win, { enabled = true, interval = 1500, timers = globalThis } = {}) {
  let wanted = false, topmost = Boolean(enabled), closed = false, busy = false;
  let pending = null;
  const alive = () => !closed && !win.isDestroyed();
  function reconcile() {
    if (!alive() || !wanted || !topmost || busy) return;
    busy = true;
    try {
      if (win.isMinimized() || !win.isVisible()) win.showInactive();
      // Reinsert in the topmost band; setting true again can be a native no-op.
      win.setAlwaysOnTop(false, 'normal');
      win.setAlwaysOnTop(true, 'floating');
      // isAlwaysOnTop can remain true while Explorer/another topmost window is above us.
      win.moveTop();
    } finally { busy = false; }
  }
  function schedule() {
    if (!alive() || !wanted || !topmost || busy || pending != null) return;
    pending = timers.setTimeout(() => { pending = null; reconcile(); }, 100);
    pending?.unref?.();
  }
  const pulse = timers.setInterval(reconcile, interval);
  pulse?.unref?.();
  const events = ['minimize', 'hide', 'restore', 'show', 'always-on-top-changed'];
  for (const event of events) win.on(event, schedule);
  function dispose() {
    if (closed) return;
    closed = true;
    timers.clearInterval(pulse);
    if (pending != null) timers.clearTimeout(pending);
    for (const event of events) win.removeListener(event, schedule);
  }
  win.once('closed', dispose);
  return {
    show() { if (!alive()) return; wanted = true; win.showInactive(); reconcile(); },
    hide() { if (!alive()) return; wanted = false; win.hide(); },
    setEnabled(value) {
      topmost = Boolean(value);
      if (!alive()) return;
      win.setAlwaysOnTop(topmost, topmost ? 'floating' : 'normal');
      reconcile();
    },
    isWanted: () => wanted,
    reconcile,
    dispose
  };
}
module.exports = { maintainPetPresence };
