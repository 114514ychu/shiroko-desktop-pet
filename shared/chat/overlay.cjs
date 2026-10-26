const path = require('node:path');
const { prepareReply } = require('./reply.cjs');
const {createSpeechSequence,streamingReply}=require('./speech-sequence.cjs');
const { BrowserWindow, ipcMain, screen, safeStorage, Menu } = require('electron');
const { createDeepSeekChat } = require('../deepseek-chat.cjs');
let service;
function planBubble(anchor, size, area, expanded) {
  const width = Math.min(area.width, expanded ? Math.max(180, Math.min(300, size.width)) : 42);
  const height = Math.min(area.height, expanded ? Math.max(40, Math.min(420, size.height)) : 42);
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, expanded ? anchor.x - width / 2 : anchor.x + 46)));
  const above = anchor.y - height - 8;
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, expanded ? above : anchor.y + 26)));
  return { x, y, width: Math.round(width), height: Math.round(height), arrow: Math.max(22, Math.min(width - 22, anchor.x - x)), crowded: expanded && above < area.y };
}
function createPetChatOverlay({ pet, name, getOutfit, getVariant = getOutfit, roleId = 'sunaookami-shiroko', conversations, openHistory, stopVoice, dataDirectory, chatService, speechService, openSettings, dictation = require('./dictation.cjs').recognize, speechLanguage = null, volume = 1, alwaysOnTop = () => true }) {
  const chat = chatService || (service ||= createDeepSeekChat({ safeStorage, dataDirectory }));
  const channel = 'pet-chat:' + pet.id;
  let disposed = false, ready = false, anchor = null, expanded = false, size = { width: 280, height: 150 }, controller, busy = false;
  let taskLine = { text: '', hidden: true }, chatContext = getOutfit(), menu, chatting = false, topmost, placement;
  let speechController, speaking = false, speechReply, revision = 0;
  let activeTurn, microphone;
  const identity = () => ({ roleId, name, outfit: getVariant() });
  const session = () => conversations?.current(identity());
  function snapshotSession(open = false) { const value = session(); if (value) emit('session', { session: value, open }); }
  function sessionResult(id) { try { return conversations?.get(id); } catch { return null; } }
  const win = new BrowserWindow({ width: 42, height: 42, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false,
    minimizable: false, maximizable: false, skipTaskbar: true, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false,
      additionalArguments: ['--pet-chat-channel=' + channel] } });
  win.setMenuBarVisibility(false);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('console-message', ({ level, message }) => { if (level === 'error') console.error('[head bubble] ' + message); });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
  function emit(type, value) { if (ready && !disposed && !win.isDestroyed()) win.webContents.send(channel + ':event', { type, value }); }
  function stopSpeech() { speechController?.abort(); speechReply?.sequence.dispose(); speechController = null; speaking = false; speechReply = null; emit('speech-stop'); }
  function cancel() { revision++; microphone?.abort();microphone=null;controller?.abort(); controller = null; busy = false; if(activeTurn){conversations?.fail(activeTurn.id,activeTurn.messageId,'对话已取消，可以重试。',true);activeTurn=null;} stopSpeech(); }
  function syncOutfit() { const outfit=getOutfit();if(outfit!==chatContext){const wasChatting=chatting;chatContext=outfit;cancel();emit('identity',{...identity(),outfit,persona:session()?.persona});snapshotSession(wasChatting);} }
  function selectSession(id, open = true) {
    const value = conversations?.get(id);
    if(!value || value.persona !== require('./conversations.cjs').personaFor(roleId,getVariant())) throw Error('请切换到对应角色后续聊。');
    cancel();conversations.activate(id);snapshotSession(open);return value;
  }
  function reposition() {
    if (disposed || win.isDestroyed() || pet.isDestroyed()) return;
    if (!pet.isVisible() || pet.isMinimized()) { cancel(); emit('close'); win.hide(); return; }
    if (!ready || !anchor) { win.hide(); return; }
    const bounds = pet.getBounds(), point = { x: bounds.x + anchor.x, y: bounds.y + anchor.y };
    const area = screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea;
    const next = planBubble(point, size, area, expanded);
    const current = win.getBounds();
    if (['x', 'y', 'width', 'height'].some(key => current[key] !== next[key])) win.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height });
    const nextTopmost = alwaysOnTop();
    if (nextTopmost !== topmost) { topmost = nextTopmost; win.setAlwaysOnTop(topmost, 'floating'); }
    if (placement !== next.arrow + ':' + next.crowded) { placement = next.arrow + ':' + next.crowded; emit('placement', { arrow: next.arrow, crowded: next.crowded }); }
    if (!win.isVisible()) win.showInactive();
  }
  async function invoke(event, value) {
    if (disposed || event.sender !== win.webContents || !value || typeof value !== 'object') return null;
    try {
      if (value.type === 'status') return { ...chat.status(), name, outfit: getOutfit(), speechEnabled: Boolean(speechService && (!speechService.enabled || speechService.enabled())), applicationSettings:Boolean(openSettings) };
      if(value.type==='settings'&&openSettings){openSettings();return {ok:true};}
      if (value.type === 'key') return { ok: true, ...chat.saveKey(value.value) };
      if (value.type === 'current') return {ok:true,session:session()};
      if(value.type==='dictation'){
        cancel();stopVoice();const active=microphone=new AbortController();active.finish=new AbortController();
        try{const result=await dictation({signal:active.signal,finishSignal:active.finish.signal,onReady:features=>{if(microphone===active){active.canFinish=features?.canFinish===true;emit('dictation-ready',{canFinish:active.canFinish});}},onProcessing:()=>{if(microphone===active){active.canFinish=false;emit('dictation-processing');}}});if(active.signal.aborted||microphone!==active)return {ok:false,error:'语音输入已取消。'};return {ok:true,text:result.text,uncertain:result.uncertain===true};}
        finally{if(microphone===active)microphone=null;}
      }
      if(value.type==='dictation-finish'){
        if(!microphone||!microphone.canFinish)return {ok:false,error:'当前未在录音，请等待识别完成。'};
        microphone.canFinish=false;microphone.finish.abort();return {ok:true};
      }
      if (value.type === 'draft' && conversations) { conversations.draft(value.sessionId,value.text);return {ok:true}; }
      if (value.type === 'send') {
        microphone?.abort();microphone=null;
        const useSpeech=Boolean(speechService&&(!speechService.enabled||speechService.enabled()));
        if (busy) return { ok: false, error: '请等待上一条回复。' };
        stopSpeech(); const id = ++revision, active = new AbortController();
        busy = true; controller = active; stopVoice();
        // Load only when a message is sent, overlapping model startup with the
        // cloud reply. A preparation error is reported by the synthesis request.
        if(useSpeech&&speechService.prepare)void speechService.prepare(active.signal).catch(()=>{});
        let turn;
        try {
          let outgoing=value.history, summary='';
          if(conversations){
            const current=session();if(value.sessionId!==current.id)throw Error('已切换对话，请重新发送。');
            const begun=conversations.begin(current.id,value.text,value.retryId);
            turn=activeTurn={id:current.id,messageId:begun.messageId};
            const context=conversations.context(turn.id,turn.messageId);outgoing=context.history;summary=context.summary;
          }
          let sequence;
          if(useSpeech){speechController=new AbortController();sequence=createSpeechSequence({synthesize:(text,signal)=>speechService.synthesize(text,signal),signal:speechController.signal});speechReply={id,sequence};}
          const reply = await chat.send(outgoing, { name, roleId, sessionId:turn?.id, messageId:turn?.messageId, outfit: getOutfit(), summary, speechLanguage: useSpeech ? speechLanguage : null }, active.signal,{onStatus:text=>{if(!active.signal.aborted&&id===revision)emit('agent-status',{requestId:value.requestId,text});},onToolStart:()=>{
            if(disposed||active.signal.aborted||id!==revision)return;
            if(useSpeech){sequence.dispose();sequence=createSpeechSequence({synthesize:(text,signal)=>speechService.synthesize(text,signal),signal:speechController.signal});speechReply.sequence=sequence;}
            emit('agent-status',{requestId:value.requestId,text:'正在处理工具请求…'});
          },onText:raw=>{
            if(disposed||active.signal.aborted||id!==revision)return;
            const partial=streamingReply(raw,Boolean(useSpeech&&speechLanguage==='ja'));
            if(useSpeech&&partial.spoken)sequence.update(partial.spoken);
            if(partial.primary)emit('reply-progress',{requestId:value.requestId,text:partial.primary});
          }});
          if (disposed || active.signal.aborted || id !== revision) return { ok: false, error: '对话已取消。' };
          const { primary, spoken } = await prepareReply(reply, { chat, japanese: Boolean(useSpeech && speechLanguage === 'ja'), signal: active.signal });
          if (disposed || active.signal.aborted || id !== revision) return { ok: false, error: '对话已取消。' };
          if(useSpeech){if(!sequence.accepts(spoken)){sequence.dispose();sequence=createSpeechSequence({synthesize:(text,signal)=>speechService.synthesize(text,signal),signal:speechController.signal});speechReply.sequence=sequence;}sequence.update(spoken,true);}
          let saved;
          if(turn){saved=conversations.complete(turn.id,turn.messageId,primary);activeTurn=null;void conversations.summarize(turn.id,chat.summarize?.bind(chat));}
          return { ok: true, reply: primary, historyReply: primary, speechId: useSpeech ? id : null, session:saved };
        } catch(error){if(turn){conversations.fail(turn.id,turn.messageId,error.message,active.signal.aborted);if(activeTurn===turn)activeTurn=null;}if(id===revision)stopSpeech();return {ok:false,error:error.message,session:turn?sessionResult(turn.id):null};}
        finally { if (controller === active) { busy = false; controller = null; } }
      }
      if (value.type === 'speech' && speechService && speechReply && value.id === speechReply.id) {
        const active = speechController, id = value.id;
        speaking = true; stopVoice();
        try {
          const audio = await speechReply.sequence.next(value.index??0);
          if (disposed || active.signal.aborted || id !== revision) return { ok: false, error: '语音已取消。' };
          return { ok: true, id, ...audio };
        } catch (error) { if (speechController === active) speaking = false; throw error; }
      }
    } catch (error) { return { ok: false, error: error.message }; }
    return null;
  }
  function input(event, value) {
    if (disposed || event.sender !== win.webContents || !value || typeof value !== 'object') return;
    if (value.type === 'ready') { ready = true; emit('identity', { ...identity(), outfit: getOutfit(), persona: session()?.persona }); snapshotSession(); emit('volume', volume); emit('task', taskLine); reposition(); }
    else if (value.type === 'layout' && Number.isFinite(value.width) && Number.isFinite(value.height)) { expanded = Boolean(value.expanded); chatting = Boolean(value.chatting); size = value; reposition(); }
    else if (value.type === 'hit') win.setIgnoreMouseEvents(!Boolean(value.value), { forward: true });
    else if (value.type === 'focus') { stopVoice(); win.setIgnoreMouseEvents(false); win.show(); win.focus(); }
    else if (value.type === 'cancel') cancel();
    else if (value.type === 'speech-done' && value.id === speechReply?.id) { speechController?.abort();speechReply.sequence.dispose();speechController=null;speaking = false; speechReply = null; }
    else if (value.type === 'menu') {
      menu = Menu.buildFromTemplate([
        { label: '聊天', click: () => emit('open', true) },
        { label: '聊天与声音设置', click: () => openSettings ? openSettings() : emit('settings', true) },
        { label: '聊天记录', enabled: Boolean(openHistory), click: () => openHistory?.(session()?.id) },
        { label: '新建对话', click: () => { cancel(); if(conversations){conversations.create(identity());snapshotSession(true);}else emit('clear'); } },
        { type: 'separator' }, { label: '收起', click: () => emit('close') }
      ]); menu.popup({ window: win });
    }
  }
  ipcMain.handle(channel + ':invoke', invoke); ipcMain.on(channel + ':input', input);
  for (const type of ['move', 'resize', 'show', 'hide', 'minimize', 'restore']) pet.on(type, reposition);
  win.on('blur', () => emit('blur'));
  function dispose() {
    if (disposed) return; cancel(); disposed = true; menu?.closePopup();
    for (const type of ['move', 'resize', 'show', 'hide', 'minimize', 'restore']) pet.removeListener(type, reposition);
    ipcMain.removeHandler(channel + ':invoke'); ipcMain.removeListener(channel + ':input', input);
    if (!win.isDestroyed()) win.destroy();
  }
  pet.once('closed', dispose);
  return { window: () => win, dispose, stopSpeech, syncOutfit, selectSession, announce(text){
    if(disposed||!ready||busy||speaking||microphone||pet.isDestroyed()||!pet.isVisible()||(typeof text==='object'&&chatting))return false;
    const ambient=typeof text==='object';
    stopSpeech();stopVoice();const id=++revision,reply=ambient?String(text.text).slice(0,300):'老师，提醒时间到了：'+String(text).slice(0,300);
    if(speechService&&(!speechService.enabled||speechService.enabled())&&(!ambient||text.voice)){speechController=new AbortController();const sequence=createSpeechSequence({synthesize:(text,signal)=>speechService.synthesize(text,signal),signal:speechController.signal});sequence.update(speechLanguage==='ja'?(ambient?String(text.spoken||'先生、少し休憩しませんか。'):'先生、リマインダーの時間です。内容を確認してください。'):reply,true);speechReply={id,sequence};speaking=true;emit('announcement',{reply,speechId:id});}else emit('announcement',{reply});return true;
  }, draft(text) {cancel();emit('draft-text',String(text).slice(0,6000));}, resetSession(id) { if(sessionResult(id)?.id===session()?.id){cancel();conversations.create(identity());snapshotSession();} }, setVolume(value) { if (Number.isFinite(value)) { volume = Math.max(0, Math.min(1, value)); emit('volume', volume); } }, isChatting: () => chatting || busy || speaking || Boolean(microphone), open() { syncOutfit();emit('open', true); },
    update(value) {
      if (!value || typeof value !== 'object' || disposed) return;
      if (value.type === 'anchor' && Number.isFinite(value.x) && Number.isFinite(value.y)) {
        anchor = { x: Math.max(-4096, Math.min(4096, value.x)), y: Math.max(-4096, Math.min(4096, value.y)) };
        syncOutfit();
        reposition();
      } else if (value.type === 'line' && typeof value.text === 'string') { taskLine = { text: value.text.slice(0, 6000), hidden: Boolean(value.hidden) }; emit('task', taskLine); }
    }
  };
}
module.exports = { createPetChatOverlay, planBubble };
