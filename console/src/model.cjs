const MODES = new Set(['single']);
const THEMES = new Set(['system', 'light', 'dark']);
function normalizeConsolePreferences(value = {}, roleIds = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const valid = new Set(roleIds);
  return {
    mode: 'single',
    theme: THEMES.has(value.theme) ? value.theme : 'system',
    ignoreUpdateReminders: value.ignoreUpdateReminders === true,
    volume: Number.isFinite(value.volume) ? Math.min(1, Math.max(0, value.volume)) : 1,
    soloId: valid.has(value.soloId) ? value.soloId : null,
    selectedIds: [],
    window: value.window && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value.window[key])) ? {
      x: Math.round(value.window.x), y: Math.round(value.window.y), width: Math.max(900, Math.min(1800, Math.round(value.window.width))), height: Math.max(640, Math.min(1200, Math.round(value.window.height)))
    } : null
  };
}
function visibleRoleIds(preferences) {
  return preferences.mode === 'single' ? (preferences.soloId ? [preferences.soloId] : []) : [...preferences.selectedIds];
}
function applySelection(preferences, action, roleIds) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('无效的显示选择');
  const next = normalizeConsolePreferences(preferences, roleIds);
  if (action.type === 'mode' && MODES.has(action.value)) {
    if (next.mode !== action.value) { next.mode = action.value; next.soloId = null; next.selectedIds = []; }
  }
  else if (action.type === 'solo' && next.mode === 'single' && (action.value === null || roleIds.includes(action.value))) next.soloId = action.value;
  else if (action.type === 'clear') { next.soloId = null; next.selectedIds = []; }
  else if (action.type === 'visible' && next.mode === 'multi' && roleIds.includes(action.id) && typeof action.value === 'boolean') {
    const set = new Set(next.selectedIds);
    if (action.value) set.add(action.id); else set.delete(action.id);
    next.selectedIds = roleIds.filter(id => set.has(id));
  } else if (action.type === 'all' && next.mode === 'multi' && typeof action.value === 'boolean') next.selectedIds = action.value ? [...roleIds] : [];
  else throw new Error('无效的显示选择');
  return next;
}
function applyTheme(preferences, value, roleIds) {
  if (!THEMES.has(value)) throw new Error('无效的主题选择');
  return { ...normalizeConsolePreferences(preferences, roleIds), theme: value };
}
function resolveTheme(value, systemDark) {
  return value === 'dark' || value === 'system' && systemDark ? 'dark' : 'light';
}
function validateRoleCommand(snapshot, name, value) {
  const variant = snapshot.variants.find(entry => entry.id === snapshot.config.variant) || snapshot.variants[0];
  if (name === 'variant') return snapshot.variants.some(entry => entry.id === value);
  if (name === 'play') return variant?.animations.some(entry => entry.name === value) || false;
  if (['auto', 'resetPosition', 'studio', 'menu'].includes(name)) return value == null;
  if (['gaze', 'follow', 'alwaysOnTop', 'roam'].includes(name)) return typeof value === 'boolean';
  if (name === 'size') return [200,260,340,420,510].includes(value);
  if (name === 'dialogueVolume') return Number.isFinite(value) && value >= 0 && value <= 1;
  return false;
}
module.exports = { normalizeConsolePreferences, visibleRoleIds, applySelection, applyTheme, resolveTheme, validateRoleCommand };
