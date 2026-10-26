// Shared policy, copied into each self-contained character distribution.
export const STATE_ACTION_LABELS = Object.freeze({ idle: '待机', running: '处理中', waiting: '等待你', review: '完成、待查看', failed: '失败' });
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
export function normalizeStateActions(saved, catalog) {
  const result = {};
  if (!object(saved)) return result;
  for (const [id, mapping] of Object.entries(saved).slice(0, 32)) {
    if (!/^[a-z0-9-]{1,64}$/.test(id) || !object(mapping)) continue;
    const variant = catalog?.variants.find(entry => entry.variant === id);
    if (catalog && !variant) continue;
    const clean = {};
    for (const state of Object.keys(STATE_ACTION_LABELS)) {
      const clip = own(mapping, state) ? mapping[state] : null;
      if (typeof clip !== 'string' || !clip.length || clip.length > 256) continue;
      if (variant && !variant.animations.some(entry => entry.name === clip)) continue;
      if (variant && clip === (variant.state_animations || catalog.state_animations)?.[state]) continue;
      clean[state] = clip;
    }
    if (Object.keys(clean).length) result[id] = clean;
  }
  return result;
}
export function resolveStateActions(catalog, variantId, saved) {
  const variant = catalog.variants.find(entry => entry.variant === variantId) || catalog.variants[0];
  return { ...(variant.state_animations || catalog.state_animations), ...normalizeStateActions(saved, catalog)[variant.variant] };
}
export function changeStateAction(catalog, saved, value, reset = false) {
  if (!object(value)) return null;
  const variant = catalog.variants.find(entry => entry.variant === value.variant);
  if (!variant) return null;
  const next = normalizeStateActions(saved, catalog);
  if (reset) { delete next[variant.variant]; return next; }
  if (!own(STATE_ACTION_LABELS, value.state) || typeof value.clip !== 'string') return null;
  if (value.clip && !variant.animations.some(entry => entry.name === value.clip)) return null;
  const mapping = { ...next[variant.variant] };
  if (!value.clip || value.clip === (variant.state_animations || catalog.state_animations)[value.state]) delete mapping[value.state];
  else mapping[value.state] = value.clip;
  if (Object.keys(mapping).length) next[variant.variant] = mapping;
  else delete next[variant.variant];
  return next;
}
