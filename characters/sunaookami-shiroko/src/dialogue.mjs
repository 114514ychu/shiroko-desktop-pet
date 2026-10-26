// Copyright (c) 2026 B站Absdasbdsa. Licensed under Mulan PSL v2.
// Outfit-aware dialogue with one voice per task-state transition.
export function normalizeDialogue(value) {
  const line = item => {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) return null;
    const audio = typeof item.audio === 'string' && /^\/assets\/(?:voice\/[\w.-]+\.ogg|voice-lobby-5\.mp3)$/.test(item.audio) ? item.audio : null;
    return { text: item.text.trim().slice(0, 300), audio, duration: Number.isFinite(item.audioDurationSeconds) ? item.audioDurationSeconds : 0 };
  };
  const group = item => ({
    idle: Array.isArray(item?.idle) ? item.idle.map(line).filter(Boolean) : [], pickup: line(item?.pickup),
    states: Object.fromEntries(['running', 'waiting', 'review', 'failed'].map(key => [key, line(item?.states?.[key])]).filter(([, value]) => value))
  });
  const result = group(value);
  if (value?.variants && typeof value.variants === 'object' && !Array.isArray(value.variants)) {
    result.variants = Object.fromEntries(Object.entries(value.variants)
      .filter(([key]) => /^[a-z0-9-]+$/.test(key) && key !== 'constructor' && key !== 'prototype')
      .map(([key, item]) => [key, group(item)]));
  }
  return result;
}

export async function loadDialogue(fetcher = globalThis.fetch) {
  try {
    const response = await fetcher('/assets/dialogue.json');
    return response.ok ? normalizeDialogue(await response.json()) : normalizeDialogue(null);
  } catch { return normalizeDialogue(null); }
}

export function createDialogueController({ bubble, canIdle, canPickup, enabled = true, initialVolume = 1, getVariant = () => 'default', canStatus = () => true,
  makeAudio = url => new Audio(url), requestAudio = () => 'standalone', releaseAudio = () => {},
  clock = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let catalogue = { idle: [], pickup: null }, lines = catalogue, selectedVariant = null, idleIndex = 0, idleTimer = null, pickupTimer = null;
  let current = null, statusKey = '', statusState = 'idle', statusText = '', active = enabled, disposed = false, idleCooldownUntil = 0;
  let volume = Number.isFinite(initialVolume) ? Math.min(1, Math.max(0, initialVolume)) : 1;
  const valid = entry => current === entry && !disposed && active && entry.variant === (getVariant() || 'default');
  const cancelTimer = timer => { if (timer != null) clearTimer(timer); };
  function release(lease) { try { if (lease) Promise.resolve(releaseAudio(lease)).catch(() => {}); } catch {} }
  function stopAudio(entry) {
    cancelTimer(entry.watchdog); entry.watchdog = null;
    if (entry.audio) {
      const audio = entry.audio; entry.audio = null;
      audio.onplaying = audio.onended = audio.onerror = null;
      try { audio.pause(); audio.removeAttribute?.('src'); audio.load?.(); } catch {}
    }
    release(entry.lease); entry.lease = null;
  }
  function clearCurrent(kind) {
    if (!current || kind && current.kind !== kind) return;
    const old = current; current = null;
    if (old.kind === 'idle') idleCooldownUntil = Math.max(idleCooldownUntil, clock() + 2500);
    cancelTimer(old.timer); stopAudio(old);
    bubble.hidden = true; if (bubble.dataset) bubble.dataset.kind = 'none';
  }
  function clearIdle() { cancelTimer(idleTimer); idleTimer = null; clearCurrent('idle'); }
  function clearPickup() { cancelTimer(pickupTimer); pickupTimer = null; clearCurrent('pickup'); }
  // Switching outfits invalidates pending pickups and asynchronous audio grants too.
  function syncVariant() {
    const next = getVariant() || 'default';
    if (next === selectedVariant) return false;
    clearIdle(); clearPickup(); clearCurrent();
    selectedVariant = next; statusKey = '';
    lines = Object.hasOwn(catalogue.variants || {}, next) ? catalogue.variants[next]
      : next === 'default' || !catalogue.variants ? catalogue : { idle: [], pickup: null, states: {} };
    idleIndex = 0; idleCooldownUntil = 0;
    return true;
  }
  function finish(entry) {
    if (!valid(entry)) return;
    clearCurrent();
  }
  function fallback(entry) {
    if (!valid(entry) || entry.timer != null) return;
    entry.audioAllowed = false; stopAudio(entry);
    bubble.textContent = entry.line.text; bubble.hidden = false;
    entry.timer = setTimer(() => finish(entry), 6000);
  }
  function show(kind, line) {
    clearCurrent();
    const entry = { kind, line, variant: selectedVariant, started: clock(), timer: null, watchdog: null, audio: null, lease: null, audioAllowed: true };
    current = entry; bubble.textContent = line.text; bubble.hidden = true;
    if (bubble.dataset) bubble.dataset.kind = kind;
    if (!line.audio) { fallback(entry); return; }
    entry.watchdog = setTimer(() => fallback(entry), kind === 'status' ? 120000 : Math.min(60000, Math.max(15000, line.duration * 1000 + 5000)));
    Promise.resolve().then(() => valid(entry) && entry.audioAllowed ? requestAudio(kind) : null).then(lease => {
      if (!valid(entry) || !entry.audioAllowed) { release(lease); return; }
      if (!lease) { fallback(entry); return; }
      entry.lease = lease;
      cancelTimer(entry.watchdog);
      entry.watchdog = setTimer(() => fallback(entry), Math.min(60000, Math.max(15000, line.duration * 1000 + 5000)));
      try {
        const audio = makeAudio(line.audio); entry.audio = audio;
        audio.volume = volume; audio.preload = 'auto';
        audio.onplaying = () => {
          if (!valid(entry) || entry.audio !== audio) return;
          bubble.textContent = line.text; bubble.hidden = false;
          cancelTimer(entry.watchdog);
          entry.watchdog = setTimer(() => fallback(entry), Math.min(120000, Math.max(15000, (Number.isFinite(audio.duration) ? audio.duration : line.duration) * 1000 + 3000)));
        };
        audio.onended = () => { if (entry.audio === audio) finish(entry); };
        audio.onerror = () => { if (entry.audio === audio) fallback(entry); };
        Promise.resolve(audio.play()).catch(() => { if (entry.audio === audio) fallback(entry); });
      } catch { fallback(entry); }
    }).catch(() => fallback(entry));
  }
  // Kept as an inert compatibility hook: waiting alone must never start speech.
  function scheduleIdle() { if (!active || disposed || !canIdle()) clearIdle(); }
  function clickIdle() {
    syncVariant();
    if (!active || disposed || !canIdle() || current || !lines.idle.length || clock() < idleCooldownUntil) return false;
    idleCooldownUntil = clock() + 2500;
    show('idle', lines.idle[idleIndex++ % lines.idle.length]);
    return true;
  }
  function schedulePickup() {
    syncVariant();
    clearIdle(); clearPickup(); clearCurrent('status');
    if (!active || disposed || !canPickup() || !lines.pickup) return;
    pickupTimer = setTimer(() => {
      pickupTimer = null;
      if (syncVariant()) return;
      if (active && !disposed && canPickup() && current?.kind !== 'status') show('pickup', lines.pickup);
    }, 1000);
  }
  function reconcile() {
    syncVariant();
    if (!active || disposed) { clearIdle(); clearPickup(); clearCurrent(); return; }
    if (!canPickup()) clearPickup();
    scheduleIdle();
    if (!canStatus()) { clearCurrent('status'); return; }
    if (!['running', 'waiting', 'review', 'failed'].includes(statusState)) return;
    const key = selectedVariant + ':' + statusState;
    if (key === statusKey) return;
    const line = lines.states?.[statusState];
    if (!line && statusState === 'running') return;
    statusKey = key;
    clearIdle(); clearPickup();
    show('status', line || { text: statusText, audio: null, duration: 0 });
  }
  return {
    setLines(value) { catalogue = value || { idle: [], pickup: null }; selectedVariant = null; reconcile(); },
    clearIdle, clearPickup, scheduleIdle, clickIdle, schedulePickup, reconcile,
    status(state, text) {
      if (state !== statusState) { statusKey = ''; clearCurrent('status'); }
      statusState = state; statusText = text;
      reconcile();
    },
    setVolume(value) {
      if (!Number.isFinite(value)) return;
      volume = Math.min(1, Math.max(0, value));
      if (current?.audio) current.audio.volume = volume;
    },
    setActive(value) { active = enabled && Boolean(value); reconcile(); },
    stop() { clearIdle(); clearPickup(); clearCurrent(); },
    dispose() { disposed = true; clearIdle(); clearPickup(); clearCurrent(); },
    snapshot() { return { kind: current?.kind || 'none', variant: selectedVariant, volume, audio: current?.audio?.getAttribute?.('src') || null, playing: Boolean(current?.audio && !current.audio.paused), time: current?.audio?.currentTime || 0, idlePending: false, pickupPending: pickupTimer != null, clickCooldownMs: Math.max(0, idleCooldownUntil - clock()) }; }
  };
}
