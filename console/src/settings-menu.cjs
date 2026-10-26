// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('node:path');
const { canSend } = require('./window-lifecycle.cjs');
const menus = new Map();
const ACTIONS = new Set(['application', 'check-updates', 'about', 'hide', 'quit']);
ipcMain.handle('settings-menu:initial', event => menus.get(event.sender.id)?.state || null);
ipcMain.handle('settings-menu:action', (event, action) => {
  const menu = menus.get(event.sender.id);
  if (!menu || !ACTIONS.has(action)) return false;
  menu.closePopup();
  return menu.onAction(action);
});
ipcMain.on('settings-menu:close', event => menus.get(event.sender.id)?.closePopup(true));

// A separate popup stays above embedded student WebContentsViews. HTML allows
// the notification to sit at the end of the row with an actual green color.
class SettingsMenu {
  constructor({ parent, anchor, theme, updateReminder, onAction, onClose }) {
    this.parent = parent; this.onAction = onAction; this.state = { theme, updateReminder };
    const content = parent.getContentBounds(), zoom = parent.webContents.getZoomFactor();
    this.anchor = { x: content.x + anchor.x * zoom, y: content.y + anchor.y * zoom,
      width: anchor.width * zoom, height: anchor.height * zoom };
    const area = screen.getDisplayMatching(this.anchor).workArea, width = 210, height = 214;
    const x = Math.round(Math.max(area.x, Math.min(this.anchor.x + this.anchor.width - width + 8, area.x + area.width - width)));
    const y = Math.round(Math.max(area.y, Math.min(this.anchor.y + this.anchor.height + 6 - 8, area.y + area.height - height)));
    this.window = new BrowserWindow({ parent, x, y, width, height, useContentSize: true,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, movable: false, minimizable: false, maximizable: false,
      skipTaskbar: true, show: false, title: '更多设置', autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'settings-menu-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    this.window.setMenuBarVisibility(false);
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    const id = this.window.webContents.id; menus.set(id, this);
    this.closeForParent = () => this.closePopup();
    for (const event of ['move', 'resize', 'hide', 'minimize', 'closed']) parent.on(event, this.closeForParent);
    this.window.on('blur', () => {
      if (this.closing) return;
      const point = screen.getCursorScreenPoint(), a = this.anchor;
      this.closedOnAnchor = point.x >= a.x && point.x <= a.x + a.width && point.y >= a.y && point.y <= a.y + a.height;
      this.closePopup();
    });
    this.window.on('closed', () => {
      menus.delete(id);
      for (const event of ['move', 'resize', 'hide', 'minimize', 'closed']) parent.removeListener(event, this.closeForParent);
      onClose?.(this);
    });
    this.ready = this.window.loadFile(path.join(__dirname, 'settings-menu.html')).then(() => {
      if (this.window.isDestroyed()) return;
      this.set(this.state); this.window.show(); this.window.webContents.focus();
    }).catch(error => { if (!this.window.isDestroyed()) throw error; });
  }
  set(value) { this.state = { ...this.state, ...value }; if (canSend(this.window)) this.window.webContents.send('settings-menu:state', this.state); }
  closePopup(restoreFocus = false) {
    if (this.window.isDestroyed()) return;
    this.closing = true;
    this.window.destroy();
    if (restoreFocus && canSend(this.parent)) this.parent.webContents.send('console:settings-focus');
  }
}
module.exports = { SettingsMenu };
