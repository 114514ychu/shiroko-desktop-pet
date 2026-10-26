// Copyright (c) 2026 B站Absdasbdsa. Licensed under Mulan PSL v2.
function createDialogueCoordinator({ stop, now = Date.now }) {
  let current = null, sequence = 0;
  const pending = new Map();
  function grant(id, kind) {
    const lease = id + ':' + ++sequence;
    current = { id, kind, lease, started: now() }; return lease;
  }
  function next() {
    if (current || !pending.size) return;
    const [id, request] = pending.entries().next().value;
    pending.delete(id); request.resolve(grant(id, request.kind));
  }
  return {
    request(id, kind) {
      if (!['idle', 'pickup', 'status'].includes(kind)) return null;
      if (current && now() - current.started >= 65000) { const old = current; current = null; stop(old.id); }
      const priority = { idle: 0, pickup: 1, status: 2 };
      const oldPending = pending.get(id);
      if (oldPending) { pending.delete(id); oldPending.resolve(null); }
      if (current && priority[kind] <= priority[current.kind] && current.id !== id) {
        if (kind === 'status') return new Promise(resolve => pending.set(id, { kind, resolve }));
        return null;
      }
      // The renderer already stopped its own previous clip. Sending it another
      // asynchronous stop here can accidentally cancel the newly requested one.
      if (current) { const old = current; current = null; if (old.id !== id) stop(old.id); }
      return grant(id, kind);
    },
    release(id, lease) { if (current?.id === id && current.lease === lease) { current = null; next(); } },
    releaseRole(id) {
      const request = pending.get(id);
      if (request) { pending.delete(id); request.resolve(null); }
      if (current?.id === id) { current = null; next(); }
    },
    snapshot() { return current ? { ...current } : null; }
  };
}
module.exports = { createDialogueCoordinator };
