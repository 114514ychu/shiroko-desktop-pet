// Electron setPosition reads back a rounded DIP size and feeds it to SetBounds.
// On fractional Windows DPI that size can grow on every move. Keep the requested
// layout size instead, including when an action expands the window for props.
const sizes = new WeakMap();

function rememberWindowSize(win, bounds) {
  sizes.set(win, { width: bounds.width, height: bounds.height });
}

function getWindowBounds(win) {
  const current = win.getBounds();
  return { ...current, ...(sizes.get(win) || {}) };
}

function setWindowPosition(win, x, y) {
  const current = win.getBounds();
  const size = sizes.get(win) || { width: current.width, height: current.height };
  return setWindowBounds(win, { x, y, ...size });
}

function setWindowBounds(win, bounds) {
  const current = win.getBounds();
  rememberWindowSize(win, bounds);
  if (['x', 'y', 'width', 'height'].every(key => current[key] === bounds[key])) return false;
  win.setBounds(bounds);
  return true;
}

module.exports = { rememberWindowSize, getWindowBounds, setWindowPosition, setWindowBounds };
