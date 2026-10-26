const { normalizeStateActions } = require('./state-actions.mjs');
const DEFAULTS = { width: 340, height: 450, alwaysOnTop: true, gaze: true, codexFollow: false, roam: false, variant: 'default', quality: 'high' };
const PET_SIZES = [200, 260, 340, 420, 510];
const PET_FOOTER_HEIGHT = 28;
function normalizePreferences(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const proposedWidth = Number(saved.width);
  const width = Number.isFinite(proposedWidth) && proposedWidth > 0 ? PET_SIZES.reduce((best, value) => Math.abs(value - proposedWidth) < Math.abs(best - proposedWidth) ? value : best, PET_SIZES[0]) : DEFAULTS.width;
  const value = { ...DEFAULTS, width, height: Math.round(width * DEFAULTS.height / DEFAULTS.width) + PET_FOOTER_HEIGHT, assetRevision: Number.isInteger(saved.assetRevision) ? saved.assetRevision : 0 };
  for (const key of ['alwaysOnTop', 'gaze', 'codexFollow', 'roam']) if (typeof saved[key] === 'boolean') value[key] = saved[key];
  if (['default', 'riding', 'swimsuit', 'terror'].includes(saved.variant)) value.variant = saved.variant;
  for (const key of ['x', 'y']) if (typeof saved[key] === 'number' && Number.isFinite(saved[key])) value[key] = Math.round(saved[key]);
  value.stateActions = normalizeStateActions(saved.stateActions);
  return value;
}
function clampToWorkArea(bounds, area) {
  return { ...bounds, x: Math.min(area.x + area.width - Math.min(bounds.width, area.width), Math.max(area.x, bounds.x)), y: Math.min(area.y + area.height - Math.min(bounds.height, area.height), Math.max(area.y, bounds.y)) };
}
module.exports = { DEFAULTS, PET_SIZES, PET_FOOTER_HEIGHT, normalizePreferences, clampToWorkArea };
