// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const DAY = 24 * 60 * 60 * 1000;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

function beijingSchedule(now) {
  const day = new Date(now + BEIJING_OFFSET).toISOString().slice(0, 10);
  // 08:00 in Beijing is 00:00 UTC, regardless of the computer's time zone.
  const due = Date.parse(day + 'T00:00:00Z');
  return { day, due, next: now < due ? due : due + DAY };
}
function normalizeUpdateCache(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const day = value.lastAutomaticCheckDay;
  const validDay = typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + 'T00:00:00Z')) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
  return { lastAutomaticCheckDay: validDay ? day : '', updateAvailable: value.updateAvailable === true };
}

function createDailyUpdateSchedule({ check, lastDay = '', onAttempt = () => {}, onError = () => {},
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let running = false, timer;
  function refresh() {
    if (!running) return Promise.resolve();
    clearTimer(timer);
    const time = now(), { day, due, next } = beijingSchedule(time);
    // A short wall-clock recheck also handles a clock adjustment while awake.
    timer = setTimer(refresh, Math.max(1, Math.min(next - time, 60000)));
    timer?.unref?.();
    if (time < due || day <= lastDay) return Promise.resolve();
    lastDay = day; // Reserve before awaiting, including failed requests and resume races.
    return Promise.resolve().then(() => { if (!running) return; onAttempt(day); return check(); }).catch(onError);
  }
  return {
    start() { if (running) return Promise.resolve(); running = true; return refresh(); },
    refresh,
    stop() { running = false; clearTimer(timer); },
    get lastDay() { return lastDay; }
  };
}
module.exports = { beijingSchedule, normalizeUpdateCache, createDailyUpdateSchedule };
