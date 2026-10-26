const { EventEmitter } = require('node:events');
const { WebContentsView } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { BACKGROUNDS, pagePresentationScript } = require('./presentation.cjs');
const { STUDIO_HEADER_HEIGHT, studioLayoutScript } = require('./studio-layout.cjs');
const PANEL_CSS = fs.readFileSync(path.join(__dirname,'panel-style.css'),'utf8');
// Adapts a role's existing studio window to a view inside the shared console.
class StudioView extends EventEmitter {
  constructor(host, roleId, options) {
    super();
    this.host = host; this.roleId = roleId;
    this.view = new WebContentsView({ webPreferences: options.webPreferences });
    this.webContents = this.view.webContents;
    this.webContents.setBackgroundThrottling(false);
    this.view.setVisible(false);
    this.webContents.on('did-finish-load', () => {
      this.presentationLoaded = true; this.cssReady = null;
      this.applyPresentation().then(() => { if (!this.isDestroyed()) this.emit('ready-to-show'); });
    });
    this.webContents.once('destroyed', () => this.emit('closed'));
    this.view.setBackgroundColor(BACKGROUNDS[this.host.presentation.theme]);
    this.attached = false;
    this.host.views.set(roleId, this);
    this.layout();
    this.releaseWhenIdle();
  }
  isDestroyed() { return Boolean(this.closing) || this.webContents.isDestroyed(); }
  isVisible() { return this.attached && !this.host.window.isDestroyed() && this.host.window.isVisible(); }
  isActive() { return this.isVisible() && !this.host.window.isMinimized(); }
  async applyPresentation() {
    const ticket = this.presentationTicket = (this.presentationTicket || 0) + 1;
    if (this.isDestroyed() || !this.presentationLoaded) return;
    const value = this.host.presentation;
    this.view.setBackgroundColor(BACKGROUNDS[value.theme]);
    try {
      this.cssReady ||= this.webContents.insertCSS(PANEL_CSS);
      await this.cssReady;
      if (this.isDestroyed() || ticket !== this.presentationTicket) return;
      await this.webContents.executeJavaScript(pagePresentationScript(value.theme,this.host.roleMetadata(this.roleId)));
      await this.webContents.executeJavaScript(studioLayoutScript(this.roleId));
    } catch (error) { if (!this.isDestroyed()) console.error('Panel presentation:',error.message); }
  }
  setAttached(value) {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    this.attached = value; this.view.setVisible(value);
    this.updateActivity();
  }
  releaseWhenIdle(delay = 60000) {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (!this.isDestroyed() && !this.isActive()) this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (!this.isActive()) this.close();
    }, delay);
  }
  updateActivity() {
    if (this.isDestroyed()) return;
    const active = this.isActive();
    if (!this.rendererFailed) this.webContents.send('pet-' + this.roleId + ':renderer-command', {name:'activity',value:active});
    if (active) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    else if (!this.idleTimer) this.releaseWhenIdle();
  }
  setMenuBarVisibility() {}
  loadURL(url) { return this.webContents.loadURL(url); }
  show() { this.host.showStudio(this.roleId); }
  showInactive() { this.host.attachStudio(this.roleId); }
  focus() { this.host.window.focus(); this.webContents.focus(); }
  layout() {
    if (this.isDestroyed()) return;
    const [width, height] = this.host.window.getContentSize();
    this.view.setBounds({ x: 0, y: STUDIO_HEADER_HEIGHT, width, height: Math.max(1, height - STUDIO_HEADER_HEIGHT) });
  }
  getBounds() { const content = this.host.window.getContentBounds(); const b = this.view.getBounds(); return { x: content.x, y: content.y + STUDIO_HEADER_HEIGHT, width: b.width, height: b.height }; }
  getContentBounds() { return this.getBounds(); }
  setBounds() { this.layout(); }
  setContentSize(width, height) {
    if (!this.attached) return;
    const current = this.host.window.getContentSize();
    if (width > current[0] || height + STUDIO_HEADER_HEIGHT > current[1]) this.host.resizeForStudio(width, height + STUDIO_HEADER_HEIGHT);
    this.layout();
  }
  close() {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    if (this.isDestroyed()) return;
    this.closing = true;
    if (this.attached && !this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(this.view);
    this.attached = false;
    if (this.host.views.get(this.roleId) === this) this.host.views.delete(this.roleId);
    this.webContents.close();
  }
}
module.exports = { StudioView };
