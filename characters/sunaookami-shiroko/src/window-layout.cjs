const MAX_STAGE_SIZE = 4096;
const STUDIO_PANEL_WIDTH = 322;
function normalizeLayoutRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = ['width', 'height', 'offsetX', 'offsetY', 'baseWidth', 'baseHeight'];
  if (!keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
  if (['width', 'height', 'baseWidth', 'baseHeight'].some(key => value[key] <= 0)) return null;
  const result = {};
  for (const key of ['width', 'height', 'baseWidth', 'baseHeight']) result[key] = Math.min(MAX_STAGE_SIZE, Math.max(1, Math.ceil(value[key])));
  for (const key of ['offsetX', 'offsetY']) result[key] = Math.max(-MAX_STAGE_SIZE, Math.min(MAX_STAGE_SIZE, Math.round(value[key])));
  result.clamped = keys.some(key => Math.abs(result[key] - value[key]) > 1);
  return result;
}
function baseAnchor(bounds, layout = {}) {
  return { x: bounds.x + (layout.offsetX || 0), y: bounds.y + (layout.offsetY || 0) };
}
function planPetLayout(config, request, anchor, area, footerHeight = 28) {
  const width = Math.min(MAX_STAGE_SIZE, area.width, Math.max(config.width, request.width));
  const height = Math.min(MAX_STAGE_SIZE, area.height, Math.max(config.height, request.height + footerHeight));
  const proposedX = anchor.x - request.offsetX, proposedY = anchor.y - request.offsetY;
  const x = Math.max(area.x, Math.min(area.x + area.width - width, proposedX));
  const y = Math.max(area.y, Math.min(area.y + area.height - height, proposedY));
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
    stage: { width: Math.round(width), height: Math.max(1, Math.round(height) - footerHeight) },
    offsetX: request.offsetX, offsetY: request.offsetY,
    limited: Boolean(request.clamped || width < request.width || height - footerHeight < request.height || x !== proposedX || y !== proposedY)
  };
}
function planStudioSize(currentContent, currentBounds, request, area) {
  const horizontalChrome = Math.max(0, currentBounds.width - currentContent.width);
  const verticalChrome = Math.max(0, currentBounds.height - currentContent.height);
  return {
    width: Math.max(1, Math.min(MAX_STAGE_SIZE, area.width - horizontalChrome, Math.max(currentContent.width, request.width + STUDIO_PANEL_WIDTH))),
    height: Math.max(1, Math.min(MAX_STAGE_SIZE, area.height - verticalChrome, Math.max(currentContent.height, request.height)))
  };
}
module.exports = { MAX_STAGE_SIZE, STUDIO_PANEL_WIDTH, normalizeLayoutRequest, baseAnchor, planPetLayout, planStudioSize };
