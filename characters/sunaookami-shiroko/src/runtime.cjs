function createPetRuntime(options = {}) {
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain: nativeIpcMain, screen, shell, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer, ROOT } = require('./server.cjs');
const { HarnessStateMonitor } = require('../../../shared/harness-state.cjs');
const { createPetChatOverlay } = require('../../../shared/chat/overlay.cjs');
const { createLocalSpeech } = require('../../../shared/local-speech.cjs');
const speechConfig = {text_lang:'ja'};
let chatOverlay;
const { normalizeStateActions, resolveStateActions, changeStateAction } = require('./state-actions.mjs');
const { DEFAULTS, PET_SIZES, PET_FOOTER_HEIGHT, normalizePreferences, clampToWorkArea } = require('./preferences.cjs');
const { normalizeLayoutRequest, baseAnchor, planPetLayout, planStudioSize } = require('./window-layout.cjs');
const { maintainPetPresence } = require('./window-presence.cjs');
const { rememberWindowSize, getWindowBounds, setWindowPosition, setWindowBounds } = require('./window-motion.cjs');


const roleId = 'sunaookami-shiroko';
const managed = Boolean(options.host);
const listeners = [], handles = [];
const ipcMain = {
  on(channel, handler) { listeners.push([channel, handler]); return nativeIpcMain.on(channel, handler); },
  handle(channel, handler) { handles.push(channel); nativeIpcMain.handle(channel, handler); }
};
let desiredVisible = options.visible !== false;
let dialogueVolume = Number.isFinite(options.dialogueVolume) ? Math.min(1, Math.max(0, options.dialogueVolume)) : 1;
let disposed = false;
function requestQuit() { if (managed) options.host.hideRole(roleId); else app.quit(); }

const DATA = options.host?.runtimeDataRoot ? path.join(options.host.runtimeDataRoot, roleId) : path.join(ROOT, '.runtime');
fs.mkdirSync(DATA, { recursive: true });
if (!managed) app.setPath('userData', DATA);
if (!managed) app.setName('砂狼白子 3D');
app.commandLine.appendSwitch('force_high_performance_gpu');
const SELF_TEST_VIEW = process.argv.includes('--self-test-pet') ? 'pet' : 'studio';
const CONTROL_TEST = !managed && process.argv.includes('--self-test-controls');
const SELF_TEST = !managed && (process.argv.includes('--self-test') || process.argv.includes('--self-test-pet') || CONTROL_TEST);
const STUDIO_ONLY = !managed && process.argv.includes('--studio');
let config = normalizePreferences();
try { config = normalizePreferences(JSON.parse(fs.readFileSync(path.join(DATA, 'preferences.json'), 'utf8'))); } catch {}
const variantSpeech = options.host?.speechFor?.(() => config.variant);
const migrateAssets = config.assetRevision !== 2;
let petLayout = { offsetX: 0, offsetY: 0, width: config.width, height: config.height - PET_FOOTER_HEIGHT };
let pet, studio, popupMenu, tray, web, monitor, drag, walking, cursorTimer, wanderTimer;
let latestState = { state: 'idle', label: '待机', connected: false };
let manualClip = null;
let playback = { paused: false, speed: 1 };
let catalog;
const reports = new Map();
const pendingCommands = new Map();
const snapshotRequests = new Map();
let snapshotSequence = 0, finishStartup, failStartup;
const startupReady = new Promise((resolve, reject) => { finishStartup = resolve; failStartup = reject; });
const diagnostics = [];
let petCaptureScheduled = false, petCaptureTimer;
const REPORTS = options.host?.diagnosticsRoot ? path.join(options.host.diagnosticsRoot,roleId) : path.join(DATA,'diagnostics');
const reportPath = path.join(REPORTS, 'desktop-validation.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

function savePreferences() {
  const temporary = path.join(DATA, 'preferences.tmp');
  const saved = { ...config };
  if (!Object.keys(saved.stateActions || {}).length) delete saved.stateActions;
  fs.writeFileSync(temporary, JSON.stringify(saved, null, 2));
  fs.renameSync(temporary, path.join(DATA, 'preferences.json'));
}
function send(win, name, data) { if (win && !win.isDestroyed() && !win.rendererFailed && !win.webContents.isDestroyed()) win.webContents.send(name, data); }
function sendCommand(value) {
  for (const [view,win] of [['pet',pet],['studio',studio]]) {
    if (!win || win.isDestroyed() || win.rendererFailed) continue;
    if (!reports.get(view)?.ready) {const queue=pendingCommands.get(view) || [];queue.push(value);pendingCommands.set(view,queue);}
    else send(win,'pet-sunaookami-shiroko:renderer-command',value);
  }
}
function command(name, value) { sendCommand({ name, value }); }
function publishState(value) {
  latestState = value;
  const state = { ...value, autoMode: manualClip == null };
  send(pet, 'pet-sunaookami-shiroko:state', state); send(studio, 'pet-sunaookami-shiroko:state', state);
  if (popupMenu) { popupMenu.getMenuItemById('current-state').label = stateHint(); recordNativeMenu(popupMenu); }
}
function requestPlaybackSnapshot(win) {
  return new Promise(resolve => {
    const id = String(++snapshotSequence);
    const timer = setTimeout(() => { snapshotRequests.delete(id); resolve(null); }, 1000);
    snapshotRequests.set(id, { sender: win.webContents, resolve, timer });
    send(win, 'pet-sunaookami-shiroko:snapshot-request', id);
  });
}
async function buildInitial(view) {
  const source = view === 'studio' ? pet : studio;
  const sourceView = view === 'studio' ? 'pet' : 'studio';
  const current = (!SELF_TEST || CONTROL_TEST) && source && !source.isDestroyed() && reports.get(sourceView)?.ready ? await requestPlaybackSnapshot(source) : null;
  const playerSnapshot = current || (view === 'pet' && options.playerSnapshot?.clip === manualClip && options.playerSnapshot.variant === config.variant ? options.playerSnapshot : null);
  return { config, catalog, dialogueVolume, baseStage: { width: config.width, height: config.height - PET_FOOTER_HEIGHT }, state: { ...latestState, autoMode: manualClip == null }, desktop: true, managed, view, viewActive: Boolean((view === 'studio' ? studio : pet)?.isVisible()), selfTest: SELF_TEST && !CONTROL_TEST, manualClip, playback, playerSnapshot, sizes: PET_SIZES, petVisible: Boolean(pet?.isVisible()) };
}

function safeBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  return clampToWorkArea(bounds, display.workArea);
}
function savePetPosition() { if (pet && !pet.isDestroyed()) { const anchor = baseAnchor(pet.getBounds(), petLayout); config.x = anchor.x; config.y = anchor.y; savePreferences(); } }
function currentPetAnchor() {
  if (pet && !pet.isDestroyed()) {
    const actual = baseAnchor(pet.getBounds(), petLayout);
    return { x: drag || walking ? actual.x : config.x ?? actual.x, y: drag || walking ? actual.y : config.y ?? actual.y };
  }
  const area = screen.getPrimaryDisplay().workArea;
  return { x: config.x ?? area.x + area.width - config.width - 55, y: config.y ?? area.y + area.height - config.height - 25 };
}
function applyPetLayout(request, anchor = currentPetAnchor()) {
  if (!pet || pet.isDestroyed()) return null;
  const area = screen.getDisplayMatching({ ...anchor, width: config.width, height: config.height }).workArea;
  const planned = planPetLayout(config, request, anchor, area, PET_FOOTER_HEIGHT);
  petLayout = { ...request, offsetX: planned.offsetX, offsetY: planned.offsetY };
  setWindowBounds(pet, planned.bounds);
  if (drag) { const cursor = screen.getCursorScreenPoint(), bounds = pet.getBounds(); drag.offsetX = cursor.x - bounds.x; drag.offsetY = cursor.y - bounds.y; }
  // Native resize is asynchronous: the renderer must wait for the requested
  // target, rather than accepting the previous getBounds() as its new viewport.
  return { width: planned.stage.width, height: planned.stage.height, limited: planned.limited };
}

function createWindow(view) {
  const isPet = view === 'pet';
  reports.delete(view);pendingCommands.delete(view);
  if (isPet) petLayout = { offsetX: 0, offsetY: 0, width: config.width, height: config.height - PET_FOOTER_HEIGHT };
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = safeBounds({ x: config.x ?? area.x + area.width - config.width - 55, y: config.y ?? area.y + area.height - config.height - 25, width: isPet ? config.width : 1120, height: isPet ? config.height : 840 });
  const windowOptions = {
    ...bounds, title: '砂狼白子 · 3D', frame: !isPet, transparent: isPet,
    backgroundColor: isPet ? '#00000000' : '#eff4f7', resizable: !isPet,
    maximizable: !isPet, minimizable: !isPet, hasShadow: !isPet,
    skipTaskbar: isPet, alwaysOnTop: isPet && config.alwaysOnTop,
    show: false, icon: path.join(ROOT, 'assets', 'ui', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }
  };
  if (managed) windowOptions.webPreferences.partition = 'persist:pet-' + roleId;
  const win = !isPet && managed ? options.host.createStudio(roleId, windowOptions) : new BrowserWindow(windowOptions);
  if (isPet) { rememberWindowSize(win, bounds); setWindowBounds(win, bounds); }
  if (isPet) {
    win.petPresence = maintainPetPresence(win, { enabled: config.alwaysOnTop });
    for (const event of ['show','hide','minimize','restore']) win.on(event,()=>send(win,'pet-sunaookami-shiroko:renderer-command',{name:'activity',value:win.isVisible() && !win.isMinimized()}));
  } else if (!managed) {
    for (const event of ['show','hide','minimize','restore']) win.on(event,()=>send(win,'pet-sunaookami-shiroko:renderer-command',{name:'activity',value:win.isVisible() && !win.isMinimized()}));
  }
  if (isPet && !SELF_TEST) { config.x = bounds.x; config.y = bounds.y; savePreferences(); }
  win.setMenuBarVisibility(false);
  if (isPet) chatOverlay = createPetChatOverlay({ pet: win, name: "砂狼白子",
    roleId, getVariant:()=>config.variant, conversations:options.host?.conversations, openHistory:options.host?.openHistory,
    getOutfit: () => { const entry = catalog?.variants.find(item => item.variant === config.variant); return entry?.display_name || entry?.label || config.variant; },
    stopVoice: () => command('dialogueStop'), dataDirectory: options.host?.runtimeDataRoot ? path.join(options.host.runtimeDataRoot, 'chat') : path.resolve(ROOT, '../../console/.runtime/chat'), chatService: options.host?.chatService,
    speechService: options.host?.speechService || variantSpeech, dictation:options.host?.dictation, openSettings:options.host?.openAppSettings, speechLanguage: speechConfig.text_lang, volume: dialogueVolume, alwaysOnTop: () => config.alwaysOnTop });
  win.loadURL(web.origin + '/?view=' + view);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(web.origin + '/')) event.preventDefault(); });
  win.webContents.on('console-message', ({ level, message }) => {
    if (['warning', 'error'].includes(level)) { diagnostics.push({ view, level, message: message.slice(0, 1200) }); console.error(`[${view}] ${message}`); }
  });
  win.webContents.on('render-process-gone', (_event, details) => { if (disposed || win.closing) return; win.rendererFailed = true; if (isPet) win.petPresence.hide(); diagnostics.push({ view, rendererFailure: details.reason }); });
  win.once('ready-to-show', () => { if (isPet) { if (desiredVisible) win.petPresence.show(); } else win.showInactive(); });
  win.on('closed', () => { if (isPet && pet === win) { pet = null; clearInterval(cursorTimer); clearInterval(wanderTimer); } else if (!isPet && studio === win) studio = null; if ((SELF_TEST && !(CONTROL_TEST && !isPet)) || (STUDIO_ONLY && !pet)) requestQuit(); });
  return win;
}

function openStudio() {
  if (managed) options.host.selectStudio(roleId);
  if (studio && !studio.isDestroyed()) {
    studio.show(); studio.focus();
    const target=studio, currentVariant=config.variant, currentClip=manualClip;
    if (pet && !pet.isDestroyed() && reports.get('pet')?.ready) requestPlaybackSnapshot(pet).then(player=>{
      if (player && studio === target && target.isVisible() && currentVariant === config.variant && currentClip === manualClip) send(target,'pet-sunaookami-shiroko:renderer-command',{name:'syncPlayback',value:player});
    });
    return;
  }
  studio = createWindow('studio');
}
function cancelPetInteraction() { endDrag(); command('cancelInteraction'); }
function setPetVisible(value) {
  if (pet && !pet.isDestroyed()) pet.webContents.setAudioMuted(!value);
  if (!value && managed) options.host.releaseDialogueRole?.(roleId);
  desiredVisible = Boolean(value);
  if (!pet || pet.isDestroyed()) return;
  if (!desiredVisible) {
    if (walking) { walking = null; command('walk', 0); }
    cancelPetInteraction(); pet.petPresence.hide();
  } else if (reports.get('pet')?.ready && !pet.rendererFailed) pet.petPresence.show();
}

function chooseClip(name) {
  cancelPetInteraction();
  // A parked paused pose is restored by the initial renderer snapshot. Do not
  // briefly resume it while the queued bootstrap commands are being delivered.
  const restoring = !reports.get('pet')?.ready && options.playerSnapshot?.variant === config.variant && options.playerSnapshot?.clip === name;
  manualClip = name; playback.paused = restoring ? Boolean(options.playerSnapshot.paused) : false;
  config.roam = false; walking = null;
  command('play', { clip: name, manual: true });
  command('playback', { name: 'pause', value: playback.paused }); savePreferences();
}
function selectedVariant() { return catalog.variants.find(entry => entry.variant === config.variant) || catalog.variants[0]; }
function applyLaunchSelection(argv) {
  const variant = argv.find(value => value.startsWith('--variant='))?.slice('--variant='.length);
  if (catalog.variants.some(entry => entry.variant === variant)) chooseVariant(variant);
  const clip = argv.find(value => value.startsWith('--clip='))?.slice('--clip='.length);
  if (selectedVariant().animations.some(animation => animation.name === clip)) chooseClip(clip);
}
function chooseVariant(value) {
  if (!catalog.variants.some(entry => entry.variant === value) || config.variant === value) return;
  closeMenu(); cancelPetInteraction(); chatOverlay?.stopSpeech(); walking = null; manualClip = null; playback.paused = false;
  config.variant = value; savePreferences();
  chatOverlay?.syncOutfit();
  command('variant', value); publishState(latestState);
}
function resetFollow(enableFollow = false) { if (enableFollow) { config.codexFollow = true; command('follow', true); } cancelPetInteraction(); manualClip = null; walking = null; playback.paused = false; command('auto', true); command('playback', { name: 'pause', value: false }); publishState(latestState); savePetPosition(); }
function resizePet(width) {
  const anchor = currentPetAnchor();
  const ratio = DEFAULTS.height / DEFAULTS.width;
  config.width = width; config.height = Math.round(width * ratio) + PET_FOOTER_HEIGHT;
  applyPetLayout({ width: config.width, height: config.height - PET_FOOTER_HEIGHT, offsetX: 0, offsetY: 0, baseWidth: config.width, baseHeight: config.height - PET_FOOTER_HEIGHT }, anchor);
  if (pet) savePetPosition();
  savePreferences();
  command('size', { width: config.width, height: config.height - PET_FOOTER_HEIGHT });
}
function resetPosition() {
  if (!pet) return;
  const area = screen.getPrimaryDisplay().workArea;
  const target = safeBounds({ x: area.x + area.width - config.width - 55, y: area.y + area.height - config.height - 25, width: config.width, height: config.height });
  applyPetLayout(petLayout, { x: target.x, y: target.y });
  savePetPosition();
}

function stateHint() { const labels = { idle: '待机', running: '执行中', waiting: '等待确认', review: latestState.needsReview ? '待查看' : '已完成', failed: '失败' }; return '当前：' + (labels[latestState.state] || labels.idle) + (manualClip == null ? ' · 自动' : ' · 手动'); }
function closeMenu() { popupMenu?.closePopup(pet || studio); popupMenu = null; }
function recordNativeMenu(menu) {
  fs.writeFileSync(path.join(REPORTS, 'native-menu-validation.json'), JSON.stringify({ generatedAt: new Date().toISOString(), style: 'native-system', compact: true, state: latestState.state, items: menu.items.map(item => ({ id: item.id, label: item.label, enabled: item.enabled, type: item.type, submenuCount: item.submenu?.items.length || 0 })), grayStatusHint: menu.getMenuItemById('current-state')?.enabled === false }, null, 2));
}
function showMenu() {
  closeMenu();
  const selected = selectedVariant();
  const menu = Menu.buildFromTemplate([
    { label: '聊天', click: () => chatOverlay?.open() },
    { label: '服装', submenu: catalog.variants.map(entry => ({ label: entry.label || entry.variant, type: 'radio', checked: entry.variant === config.variant, click: () => chooseVariant(entry.variant) })) },
    { label: '打开控制台', click: openStudio },
    { label: '更多设置', submenu: [
    { label: '播放原始动作', submenu: selected.animations.map(item => ({ label: `${item.name}   ${item.duration_seconds.toFixed(2)} s`, type: 'radio', checked: manualClip === item.name, click: () => chooseClip(item.name) })) },
    { label: '场景视角', visible: selected.scene_navigation_clips?.includes(manualClip) || false, submenu: [
      { label: '完整场景', click: () => command('sceneView', 'overview') },
      { label: '原学生大小', click: () => command('sceneView', 'character') }
    ] },
    { label: '恢复自动陪伴', click: () => resetFollow(true) },
    { id: 'current-state', label: stateHint(), enabled: false },
    { type: 'separator' },
    { label: '跟随 DeepSeek Harness 工作状态', type: 'checkbox', checked: config.codexFollow, click: item => { config.codexFollow = item.checked; command('follow', item.checked); if (item.checked) resetFollow(); savePreferences(); } },
    { label: '视线跟随鼠标', type: 'checkbox', checked: config.gaze, click: item => { config.gaze = item.checked; command('gaze', item.checked); savePreferences(); } },
    { label: '保持置顶', type: 'checkbox', checked: config.alwaysOnTop, click: item => { config.alwaysOnTop = item.checked; pet?.petPresence.setEnabled(item.checked); savePreferences(); } },
    { label: '桌面散步', type: 'checkbox', checked: config.roam, click: item => { config.roam = item.checked; manualClip = null; if (!item.checked) { walking = null; resetFollow(); } savePreferences(); } },
    { label: '学生大小', submenu: PET_SIZES.map(width => ({ label: `${width === 200 ? '小号 ' : width === 340 ? '默认 ' : ''}${width} px`, type: 'radio', checked: config.width === width, click: () => resizePet(width) })) },
    { label: '回到屏幕右下角', click: resetPosition },
    ] },
    { type: 'separator' },
    { label: pet?.petPresence.isWanted() ? '暂时隐藏学生' : '显示学生', click: () => { if (managed) { options.host.toggleRole(roleId); return; } if (!pet) return; setPetVisible(!pet.petPresence.isWanted()); } },
    { label: '退出学生', click: requestQuit }
  ]);
  popupMenu = menu; recordNativeMenu(menu);
  menu.popup({ window: pet || studio, callback: () => { if (popupMenu === menu) popupMenu = null; } });
}

function beginDrag(sender) {
  if (!pet || sender !== pet.webContents) return;
  if (walking) { walking = null; manualClip = null; playback.paused = false; command('walk', 0); publishState(latestState); }
  walking = null;
  const cursor = screen.getCursorScreenPoint(); const bounds = pet.getBounds();
  drag = { offsetX: cursor.x - bounds.x, offsetY: cursor.y - bounds.y };
  pet.setIgnoreMouseEvents(false);
}
function beginWalk(targetX) { walking = { targetX: targetX + petLayout.offsetX }; command('walk', Math.sign(walking.targetX - currentPetAnchor().x)); }
function endDrag() {
  if (pet && drag) { const bounds = safeBounds(getWindowBounds(pet)); setWindowBounds(pet, bounds); savePetPosition(); }
  drag = null;
}

function startMovement() {
  let cursorTick = 0;
  cursorTimer = setInterval(() => {
    if (!pet || pet.isDestroyed() || !pet.isVisible()) return;
    ++cursorTick;
    if (!drag && cursorTick % 2 !== 0) return;
    const cursor = screen.getCursorScreenPoint();
    if (drag) setWindowPosition(pet, Math.round(cursor.x - drag.offsetX), Math.round(cursor.y - drag.offsetY));
    else if (walking) {
      const bounds = pet.getBounds(); const delta = walking.targetX - baseAnchor(bounds, petLayout).x;
      if (Math.abs(delta) < 2) { walking = null; command('walk', 0); resetFollow(); }
      else setWindowPosition(pet, bounds.x + Math.sign(delta) * 2, bounds.y);
    }
    const bounds = pet.getBounds();
    if (cursorTick % 2 === 0) send(pet, 'pet-sunaookami-shiroko:cursor', { x: (cursor.x - bounds.x) / bounds.width * 2 - 1, y: (cursor.y - bounds.y) / (bounds.height - PET_FOOTER_HEIGHT) * 2 - 1 });
  }, 16);
  wanderTimer = setInterval(() => {
    if (!config.roam || drag || manualClip || walking || !pet?.isVisible() || latestState.state === 'waiting') return;
    const bounds = pet.getBounds(); const area = screen.getDisplayMatching(bounds).workArea;
    const anchorX = baseAnchor(bounds, petLayout).x;
    const targetX = Math.round(Math.max(area.x, Math.min(area.x + area.width - config.width, anchorX + (Math.random() > 0.5 ? 1 : -1) * (80 + Math.random() * 160))));
    beginWalk(targetX - petLayout.offsetX);
  }, 18000);
}

function senderIsOurs(event) { return event.sender === pet?.webContents || event.sender === studio?.webContents; }
ipcMain.handle('pet-sunaookami-shiroko:dialogue', (event, value) => {
  if (disposed || event.sender !== pet?.webContents || !value || typeof value !== 'object') return null;
  if (value.action === 'release' && typeof value.lease === 'string') { if (managed) options.host.releaseDialogue?.(roleId, value.lease); return true; }
  if (value.action !== 'request' || !['idle', 'pickup', 'status'].includes(value.kind) || !desiredVisible || !pet?.isVisible() || chatOverlay?.isChatting()) return null;
  return managed ? (options.host.requestDialogue?.(roleId, value.kind) || null) : 'standalone';
});
ipcMain.on('pet-sunaookami-shiroko:bubble', (event, value) => { if (!disposed && event.sender === pet?.webContents) chatOverlay?.update(value); });
ipcMain.handle('pet-sunaookami-shiroko:initial', event => senderIsOurs(event) ? buildInitial(event.sender === pet?.webContents ? 'pet' : 'studio') : null);
ipcMain.handle('pet-sunaookami-shiroko:layout', async (event, value) => {
  if (!senderIsOurs(event)) return null;
  const request = normalizeLayoutRequest(value);
  if (!request || request.baseWidth !== config.width || request.baseHeight !== config.height - PET_FOOTER_HEIGHT) return null;
  if (event.sender === pet?.webContents) return applyPetLayout(request);
  const win = studio;
  if (!win || win.isDestroyed()) return null;
  const bounds = win.getBounds(), content = win.getContentBounds(), area = screen.getDisplayMatching(bounds).workArea;
  const size = planStudioSize(content, bounds, request, area);
  win.setContentSize(size.width, size.height);
  setWindowBounds(win, safeBounds(win.getBounds()));
  const actual = await win.webContents.executeJavaScript(`new Promise(resolve => { let done = false; const finish = () => { if (done) return; done = true; const stage = document.getElementById('stage'); resolve({width:stage.clientWidth,height:stage.clientHeight}); }; requestAnimationFrame(finish); setTimeout(finish, 50); })`);
  return { width: actual.width, height: actual.height, limited: Boolean(request.clamped || actual.width < request.width || actual.height < request.height) };
});
ipcMain.on('pet-sunaookami-shiroko:playback-snapshot', (event, { id, player } = {}) => {
  const pending = snapshotRequests.get(id);
  if (!pending || event.sender !== pending.sender) return;
  clearTimeout(pending.timer); snapshotRequests.delete(id);
  const entry = selectedVariant();
  const clip = player?.variant === entry.variant && entry.animations.find(item => item.name === player?.clip);
  if (!clip || !Number.isFinite(player.time) || !Number.isFinite(player.speed) || !Number.isFinite(player.capturedAt)) { pending.resolve(null); return; }
  const value = { variant: entry.variant, clip: player.clip, time: Math.max(0, Math.min(clip.duration_seconds, player.time)), speed: Math.max(0.25, Math.min(2, player.speed)), auto: Boolean(player.auto), paused: Boolean(player.paused), walking: Boolean(player.walking), yaw: Number.isFinite(player.yaw) ? player.yaw : 0, tailActive: Boolean(player.tailActive && (entry.animation_tail_loops ?? catalog.animation_tail_loops)?.[player.clip]), tailRepeats: Number.isInteger(player.tailRepeats) ? Math.max(0, player.tailRepeats) : 0, capturedAt: player.capturedAt };
  const fade = player.fade;
  if (value.tailActive && fade && [fade.time, fade.timeScale, fade.blend, fade.elapsed].every(Number.isFinite) && fade.blend > 0 && fade.blend <= 2 && fade.elapsed >= 0 && fade.elapsed <= fade.blend) value.fade = { time: fade.time, timeScale: Math.max(0, Math.min(1, fade.timeScale)), blend: fade.blend, elapsed: fade.elapsed, anchor: Boolean(fade.anchor) };
  pending.resolve(value);
});
ipcMain.handle('pet-sunaookami-shiroko:capture', async (event, dataUrl) => {
  if (!senderIsOurs(event) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 40 * 1024 * 1024) return false;
  const directory = path.join(DATA, 'captures'); fs.mkdirSync(directory, { recursive: true });
  const result = await dialog.showSaveDialog(managed ? options.host.window : BrowserWindow.fromWebContents(event.sender), { title: '保存砂狼白子高清截图', defaultPath: path.join(directory, '砂狼白子.png'), filters: [{ name: 'PNG 图片', extensions: ['png'] }] });
  if (result.canceled) return false;
  fs.writeFileSync(result.filePath, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  return true;
});
ipcMain.handle('pet-sunaookami-shiroko:qa-frame', (event, { clip, dataUrl, tag = '', variant = config.variant } = {}) => {
  const entry = catalog.variants.find(item => item.variant === variant);
  if (!SELF_TEST || !senderIsOurs(event) || !entry?.animations.some(item => item.name === clip) || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length > 40 * 1024 * 1024) return false;
  if (!['', 'ambient-first', 'ambient-middle', 'ambient-blend', 'f-0', 'f-0_25', 'f-0_5', 'f-0_75', 'f-0_995'].includes(tag)) return false;
  const target = path.join(REPORTS, (event.sender === pet?.webContents ? 'pet-animation-' : 'animation-') + variant + '-' + clip + (tag ? '-' + tag : '') + '.png');
  fs.writeFileSync(target, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64')); return true;
});
ipcMain.on('pet-sunaookami-shiroko:hit-test', (event, value) => { if (event.sender === pet?.webContents && !drag) pet.setIgnoreMouseEvents(!Boolean(value), { forward: true }); });
ipcMain.on('pet-sunaookami-shiroko:drag', (event, phase) => { if (event.sender !== pet?.webContents) return; if (phase === 'begin') beginDrag(event.sender); else if (phase === 'end') endDrag(); });
function handleCommand({ name, value } = {}) {
  if (name === 'chat') chatOverlay?.open();
  else if (name === 'assistantReminder') return chatOverlay?.announce(value);
  else if (name === 'assistantDraft') {if(!chatOverlay||chatOverlay.isChatting())return false;chatOverlay.draft(value);return true;}
  else if (name === 'chatSession') return chatOverlay?.selectSession(value);
  else if (name === 'chatSessionRemove') return chatOverlay?.resetSession(value);
  else if (name === 'menu') showMenu();
  else if (name === 'studio') openStudio();
  else if (name === 'openCodex') {const executable=options.host?.getSettings?.().harnessExecutable;if(executable&&fs.existsSync(executable)){const child=spawn(executable,[],{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();}else options.host?.openAppSettings?.();}
  else if (name === 'stateAction' || name === 'resetStateActions') {
    if (!value || value.variant !== config.variant) return false;
    const next = changeStateAction(catalog, config.stateActions, value, name === 'resetStateActions');
    if (!next) return false;
    config.stateActions = next;
    command('stateActions', next); savePreferences(); return true;
  }
  else if (name === 'auto') resetFollow(true);
  else if (name === 'variant') chooseVariant(value);
  else if (name === 'sceneView' && (value === 'overview' || value === 'character' || Number.isFinite(value) && value >= 0 && value <= 1)) command('sceneView', value);
  else if (name === 'play' && selectedVariant().animations.some(a => a.name === value)) chooseClip(value);
  else if (name === 'playback' && value && typeof value === 'object') {
    const control = value.name;
    let setting = value.value;
    if (control === 'pause' && typeof setting === 'boolean') playback.paused = setting;
    else if (control === 'speed' && Number.isFinite(setting)) { setting = Math.min(2, Math.max(0.25, setting)); playback.speed = setting; }
    else if (control === 'seek' && Number.isFinite(setting)) { setting = Math.min(1, Math.max(0, setting)); playback.paused = true; }
    else if (control === 'restart') playback.paused = false;
    else return;
    command('playback', { name: control, value: setting });
  }
  else if (name === 'dialogueVolume' && Number.isFinite(value)) { dialogueVolume = Math.min(1, Math.max(0, value)); command('dialogueVolume', dialogueVolume); chatOverlay?.setVolume(dialogueVolume); }
  else if (name === 'dialogueStop') { command('dialogueStop'); chatOverlay?.stopSpeech(); }
  else if (name === 'gaze') { config.gaze = Boolean(value); command('gaze', config.gaze); savePreferences(); }
  else if (name === 'follow') { config.codexFollow = Boolean(value); command('follow', config.codexFollow); if (config.codexFollow) resetFollow(); savePreferences(); }
  else if (name === 'size' && PET_SIZES.includes(Number(value))) resizePet(Number(value));
  else if (name === 'alwaysOnTop') { config.alwaysOnTop = Boolean(value); pet?.petPresence.setEnabled(config.alwaysOnTop); savePreferences(); }
  else if (name === 'roam') { config.roam = Boolean(value); manualClip = null; if (!config.roam) { walking = null; resetFollow(); } savePreferences(); }
  else if (name === 'resetPosition') resetPosition();
  else if (name === 'visibility' && pet) { if (managed) { options.host.toggleRole(roleId); return; } setPetVisible(!pet.petPresence.isWanted()); }
  else if (name === 'closeMenu') closeMenu();
  else if (name === 'quit') requestQuit();
}
ipcMain.on('pet-sunaookami-shiroko:command', (event, value) => { if (senderIsOurs(event)) handleCommand(value); });
ipcMain.on('pet-sunaookami-shiroko:renderer-report', (event, value) => {
  if (!senderIsOurs(event) || !value || typeof value !== 'object') return;
  const view = event.sender === pet?.webContents ? 'pet' : 'studio';
  reports.set(view, value);
  if (value.ready) {
    const target=view === 'pet' ? pet : studio;
    for (const pending of pendingCommands.get(view) || []) send(target,'pet-sunaookami-shiroko:renderer-command',pending);
    pendingCommands.delete(view);publishState(latestState);
  }
  if (managed && view === 'pet' && value.error) pet.petPresence.hide();
  if (value.ready) { const target=view === 'pet' ? pet : studio; send(target,'pet-sunaookami-shiroko:renderer-command',{name:'activity',value:Boolean(target?.isVisible() && (!target.isMinimized || !target.isMinimized()))}); }
  if (managed && view === 'pet' && value.ready) { if (desiredVisible) pet.petPresence.show(); else pet.petPresence.hide(); }
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), windows: Object.fromEntries(reports), diagnostics, harnessMonitor: { ...latestState, readsLifecycleOnly: true, writesHarnessData: false } }, null, 2));
  if (view === 'pet' && value.ready && !petCaptureScheduled) {
    petCaptureScheduled = true;
    petCaptureTimer = setTimeout(async () => {
      const capturedPet = pet;
      if (disposed || !capturedPet || capturedPet.isDestroyed() || capturedPet.webContents.isDestroyed()) return;
      try {
        const picture = await capturedPet.webContents.capturePage(undefined, { stayHidden: true });
        if (disposed || capturedPet.isDestroyed() || capturedPet.webContents.isDestroyed() || pet !== capturedPet) return;
        const currentFooter = await capturedPet.webContents.executeJavaScript(`(() => {
          const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
          const layout = { stage:rect('stage'), row:rect('petFooter'), name:rect('petName'), studioButton:rect('petStudio'), menuButton:rect('petMenu') };
          const canvas = document.getElementById('scene'), sample = document.createElement('canvas');
          sample.width = Math.ceil(layout.stage.width); sample.height = Math.ceil(layout.stage.height);
          const context = sample.getContext('2d',{willReadFrequently:true}); context.drawImage(canvas,0,0,sample.width,sample.height);
          const bytes = context.getImageData(0,0,sample.width,sample.height).data;
          const controls = [layout.name,layout.studioButton,layout.menuButton]; let bottom=0,overlap=0;
          for(let y=0;y<sample.height;y++)for(let x=0;x<sample.width;x++)if(bytes[(y*sample.width+x)*4+3]>32){
            bottom=Math.max(bottom,y+1);
            if(controls.some(r=>x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height))overlap++;
          }
          return {layout,sceneBottom:bottom,gap:Math.min(...controls.map(r=>r.y))-bottom,overlap,measuredAt:new Date().toISOString(),variant:document.body.dataset.variant,clip:document.body.dataset.activeClip};
        })()`);
        if (disposed || capturedPet.isDestroyed() || capturedPet.webContents.isDestroyed() || pet !== capturedPet) return;
        fs.writeFileSync(path.join(REPORTS, 'desktop-pet.png'), picture.toPNG());
        fs.writeFileSync(path.join(REPORTS, 'native-pet-launch.json'), JSON.stringify({ generatedAt: new Date().toISOString(), ready: true, bounds: capturedPet.getBounds(), visible: capturedPet.isVisible(), alwaysOnTop: capturedPet.isAlwaysOnTop(), frameless: true, transparent: true, loopbackOrigin: web.origin, renderer: { ...value, footerLayout: currentFooter.layout }, footerPixels: currentFooter, state: latestState }, null, 2));
      } catch (error) { if (!disposed && !capturedPet.isDestroyed()) console.error('Pet capture failed: ' + error.message); }
    }, 1500);
  }
});

if (!managed && !app.requestSingleInstanceLock()) app.quit();
else {
  if (!managed) app.on('second-instance', async (_event, argv) => {
    await startupReady;
    applyLaunchSelection(argv);
    if (argv.includes('--studio')) openStudio();
    else { if (!pet || pet.isDestroyed()) { pet = createWindow('pet'); startMovement(); } pet.petPresence.show(); }
  });
  app.whenReady().then(async () => {
    if (disposed) { finishStartup(); return; }
    if (migrateAssets) { await session.defaultSession.clearCache(); config.assetRevision = 2; savePreferences(); }
    savePreferences();
    catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'catalog.json'), 'utf8'));
    config.stateActions = normalizeStateActions(config.stateActions, catalog);
    if (!catalog.variants.some(entry => entry.variant === config.variant)) config.variant = catalog.default_variant;
    if (!SELF_TEST) applyLaunchSelection(process.argv);
    web = await createServer();
    if (disposed) { web.server.close(); finishStartup(); return; }
    monitor = options.monitor || new HarnessStateMonitor();
    monitor.on('change', publishState);
    if (!options.monitor) monitor.start(); latestState = monitor.snapshot;
    if (CONTROL_TEST) { pet = createWindow('pet'); startMovement(); }
    else if (SELF_TEST && SELF_TEST_VIEW === 'pet') pet = createWindow('pet');
    else if (STUDIO_ONLY || SELF_TEST) openStudio(); else { pet = createWindow('pet'); startMovement(); }
    finishStartup();
    if (!SELF_TEST && !managed) {
      const iconFile = path.join(ROOT, 'assets', 'ui', 'icon.png');
      const icon = fs.existsSync(iconFile) ? nativeImage.createFromPath(iconFile).resize({ width: 20, height: 20 }) : nativeImage.createEmpty();
      tray = new Tray(icon); tray.setToolTip('砂狼白子 · 3D 学生陪伴'); tray.on('click', showMenu); tray.on('right-click', showMenu); tray.on('double-click', openStudio);
      if (process.argv.includes('--show-menu')) setTimeout(showMenu, 2000);
    }
    if (CONTROL_TEST) {
      monitor.stop();
      const { run } = require('../tools/test_controls.cjs');
      const original = { ...config };
      await run({ pet, openStudio, studio: () => studio, chooseClip, resizePet, showMenu, closeMenu, beginWalk, publishState, movement: () => ({ walking, drag }), layout: () => petLayout, config: () => config, ROOT, latestState: () => latestState, restore: () => { config = original; walking = null; drag = null; petLayout = { offsetX: 0, offsetY: 0, width: config.width, height: config.height - PET_FOOTER_HEIGHT }; setWindowBounds(pet, safeBounds({ x: original.x ?? pet.getBounds().x, y: original.y ?? pet.getBounds().y, width: original.width, height: original.height })); savePreferences(); } });
      app.exit(0);
    } else if (SELF_TEST) {
      const started = Date.now();
      const check = setInterval(async () => {
        if (reports.get(SELF_TEST_VIEW)?.selfTestComplete) {
          clearInterval(check);
          const picture = await (SELF_TEST_VIEW === 'pet' ? pet : studio).webContents.capturePage();
          fs.writeFileSync(path.join(REPORTS, SELF_TEST_VIEW === 'pet' ? 'pet-selftest-screenshot.png' : 'studio-screenshot.png'), picture.toPNG());
          app.exit(reports.get(SELF_TEST_VIEW).ok ? 0 : 1);
        } else if (Date.now() - started > 240000) { clearInterval(check); fs.writeFileSync(reportPath, JSON.stringify({ ok: false, error: 'Renderer self-test timed out', diagnostics }, null, 2)); app.exit(1); }
      }, 500);
    }
  }).catch(error => { console.error(error); failStartup(error); if (!managed) app.exit(1); });
  if (!managed) app.on('window-all-closed', () => { if (STUDIO_ONLY || SELF_TEST) requestQuit(); });
  if (!managed) app.on('before-quit', () => { if (!SELF_TEST) savePetPosition(); for (const pending of snapshotRequests.values()) { clearTimeout(pending.timer); pending.resolve(null); } snapshotRequests.clear(); monitor?.stop(); clearInterval(cursorTimer); clearInterval(wanderTimer); web?.server.close(); });
}


return {
  ready: startupReady,
  snapshot() {
    const variant = catalog?.variants.find(entry => entry.variant === config.variant) || catalog?.variants[0];
    const failure = diagnostics.findLast(entry => entry.rendererFailure);
    const error = reports.get('pet')?.error || (failure ? '学生画面已停止，请重新载入。' : null);
    return { id: roleId, dialogueVolume, config: { ...config }, hasTray: Boolean(tray), visible: Boolean(pet?.petPresence.isWanted()), ready: Boolean(reports.get('pet')?.ready && reports.get('pet').variant === config.variant && !error),
      manualClip, activeClip: manualClip || (catalog ? resolveStateActions(catalog, config.variant, config.stateActions) : {})[config.codexFollow ? latestState.state : 'idle'], playback: { ...playback },
      state: { state: latestState.state, label: latestState.label, connected: latestState.connected }, error,
      variants: (catalog?.variants || []).map(entry => ({ id: entry.variant, name: entry.display_name || entry.variant, animations: entry.animations.map(a => ({ name: a.name, duration: a.duration_seconds })) })) };
  },
  setVisible: setPetVisible,
  ...(managed && options.host.testing ? { testMovement: { beginWalk, movement: () => ({ walking: Boolean(walking), dragging: Boolean(drag) }), stop: () => { endDrag(); walking = null; command('walk', 0); } } } : {}),
  command: handleCommand, openStudio,
  petWindow: () => pet, studioWindow: () => studio, chatWindow: () => chatOverlay?.window(),
  capturePlayback: async () => pet && !pet.isDestroyed() && !pet.rendererFailed && reports.get('pet')?.ready ? requestPlaybackSnapshot(pet) : null,
  async thumbnail() {
    if (!pet || pet.isDestroyed() || pet.rendererFailed || !reports.get('pet')?.ready) return null;
    return pet.webContents.executeJavaScript(`(() => { window.dispatchEvent(new Event('pet-preview')); const canvas = document.getElementById('scene'); const output = document.createElement('canvas'); const ratio = Math.min(1, 450 / Math.max(canvas.width,canvas.height)); output.width = Math.max(1,Math.round(canvas.width*ratio)); output.height = Math.max(1,Math.round(canvas.height*ratio)); output.getContext('2d').drawImage(canvas,0,0,output.width,output.height); return output.toDataURL('image/png'); })()`);
  },
  dispose() {
    if (disposed) return; disposed = true; chatOverlay?.dispose();
    if (managed) options.host.releaseDialogueRole?.(roleId);
    clearTimeout(petCaptureTimer);
    savePetPosition(); closeMenu();
    for (const pending of snapshotRequests.values()) { clearTimeout(pending.timer); pending.resolve(null); } snapshotRequests.clear();
    monitor?.removeListener('change', publishState); if (!options.monitor) monitor?.stop();
    clearInterval(cursorTimer); clearInterval(wanderTimer); web?.server.close(); tray?.destroy();
    studio?.close(); if (pet && !pet.isDestroyed()) pet.destroy();
    for (const [channel, handler] of listeners) nativeIpcMain.removeListener(channel, handler);
    for (const channel of handles) nativeIpcMain.removeHandler(channel);
    pendingCommands.clear();
  }
};

}
module.exports = { createPetRuntime };
