// Copyright (c) 2026 B站Absdasbdsa. Licensed under Mulan PSL v2.
// Keep the thumb responsive while coalescing input and ignoring older snapshots.
export function createVolumeControl({ input, output, send, onError, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let pending = null, sending = false, timer = null, disposed = false;
  const paint = value => { input.value = String(Math.round(value * 100)); output.textContent = input.value + '%'; };
  async function flush() {
    if (disposed || sending || pending == null) return;
    if (timer != null) clearTimer(timer); timer = null;
    const value = pending; pending = null; sending = true;
    try {
      const result = await send(value);
      if (!result) throw new Error('音量设置未保存');
      if (pending == null) paint(result.preferences.volume);
    } catch (error) { onError(error); }
    finally { sending = false; if (pending != null && !disposed) timer = setTimer(flush, 50); }
  }
  function change() {
    pending = Math.min(1, Math.max(0, Number(input.value) / 100)); paint(pending);
    if (!sending && timer == null) timer = setTimer(flush, 50);
  }
  input.addEventListener('input', change); input.addEventListener('change', flush);
  return {
    render(value) { if (!sending && pending == null) paint(Number.isFinite(value) ? value : 1); },
    dispose() { disposed = true; if (timer != null) clearTimer(timer); input.removeEventListener('input', change); input.removeEventListener('change', flush); }
  };
}
