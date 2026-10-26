const $ = id => document.getElementById(id);
const api = window.petChat;
const histories = new Map();
let context = '', identity = {}, expanded = false, composing = false, pending = false, settings = false, sequence = 0, timer, replyUntil = 0, lastTask = '', lastLayout = '', placementArrow = 140;
let speechActive = false, speechSequence = 0, speechId = null, speechAudio, speechTimer, speechText = '', volume = 1;
let sessionId = null, sessionSnapshot = null, draftTimer, pendingText='';
let listening=false,microphoneSequence=0,microphonePhase='idle';
function controls(){ $('interrupt').hidden=!(pending||speechActive||listening);$('microphone').setAttribute('aria-pressed',String(listening));$('microphone').disabled=listening&&microphonePhase!=='recording';$('microphone').textContent=listening&&microphonePhase==='recording'?'完成':'麦';$('microphone').title=listening?'说完点击完成；■ 可取消本次语音输入':'语音输入（Alt+V），识别后可编辑再发送';$('send').disabled=pending||listening; }
function interrupt(){
  microphoneSequence++;listening=false;sequence++;api.input({type:'cancel'});stopSpeech();
  if(pending&&!$('message').value)$('message').value=pendingText;
  pending=false;voiceStatus('');controls();saveDraft();paint();
}
async function dictate(){
  if(listening){
    if(microphonePhase!=='recording')return;
    const ticket=microphoneSequence;microphonePhase='finishing';controls();voiceStatus('正在结束录音…');
    let result;try{result=await api.invoke({type:'dictation-finish'});}catch{result={ok:false,error:'结束录音失败，请重试或点击 ■ 取消。'};}
    if(ticket===microphoneSequence&&listening&&microphonePhase==='finishing'&&!result?.ok){microphonePhase='recording';controls();voiceStatus(result?.error||'结束录音失败，请重试。');}
    return;
  }
  interrupt();const ticket=++microphoneSequence;listening=true;microphonePhase='preparing';controls();voiceStatus('正在加载中文识别模型，首次可能需要十几秒…');
  let result;try{result=await api.invoke({type:'dictation'});}catch{result={error:'语音输入未能启动，请检查麦克风。'};}
  if(ticket!==microphoneSequence)return;listening=false;controls();
  if(result?.ok){$('message').value=($('message').value+' '+result.text).trim().slice(0,6000);saveDraft();voiceStatus(result.uncertain?'识别可能有误，请检查文字；靠近麦克风并减少旁边的人声后重试。':'识别完成，可以修改后发送。');}else voiceStatus(result?.error||'没有识别到语音，请确认麦克风未静音。');
  measure();$('message').focus();
}
const history = () => { if (!histories.has(context)) histories.set(context, []); return histories.get(context); };
function saveDraft() {
  clearTimeout(draftTimer);
  if(sessionId)void api.invoke({type:'draft',sessionId,text:$('message').value||(pending?pendingText:'')}).catch(()=>{});
}
function loadSession(value, replaceDraft = true) {
  sessionId=value.id;sessionSnapshot=value;context=value.persona;
  histories.set(context,value.messages.filter(item=>item.status==='completed').map(({role,content})=>({role,content})));
  if(replaceDraft)$('message').value=value.draft||'';
}
function measure() {
  // A covered transparent window can stop receiving animation frames on Windows.
  // Resize on the subtitle event itself so speech never waits for mouse movement.
  positionTail();
  const layout = { type: 'layout', expanded, chatting: composing || speechActive, width: $('shell').offsetWidth, height: $('shell').offsetHeight };
  const key = JSON.stringify(layout);
  if (key !== lastLayout) { lastLayout = key; api.input(layout); }
}
function positionTail() { $('bubble').style.setProperty('--tail-left', (placementArrow - $('bubble').getBoundingClientRect().left - 6) + 'px'); }
new ResizeObserver(measure).observe($('shell'));

// User-opened chat stays open; only ambient voice bubbles expire automatically.
function armHide() {
  clearTimeout(timer);
  if (!expanded || composing || settings || pending || speechActive || $('message').value.trim()) return;
  timer = setTimeout(close, replyUntil ? Math.max(0, replyUntil - Date.now()) : 8000);
}
function display(text, kind = 'chat', translation = '') {
  $('voiceStatus').hidden = true;
  const primary = typeof text === 'string' ? (/[\u3040-\u30ff]/.test(text) ? '中文台词暂时不可用，请重试。' : text) : '';
  $('reply').textContent = primary;
  $('reply').scrollTop = 0;
  $('translation').textContent = '';
  $('translation').hidden = true;
  $('translation').scrollTop = 0;
  $('bubble').dataset.kind = kind;
  $('bubble').hidden = !primary;
  measure();
}
function voiceStatus(text) { $('voiceStatus').textContent = text; $('voiceStatus').hidden = !text; measure(); }
function setSpeaking(active) { $('state').hidden = !active; controls(); }
function stopSpeech() {
  speechSequence++; clearTimeout(speechTimer); setSpeaking(false);
  if (speechAudio) { speechAudio.onplaying = speechAudio.onended = speechAudio.onerror = speechAudio.onloadedmetadata = null; speechAudio.pause(); speechAudio.removeAttribute('src'); speechAudio.load(); speechAudio = null; }
  if (speechId !== null) api.input({ type: 'speech-done', id: speechId });
  speechId = null; speechActive = false; speechText = ''; voiceStatus('');controls();
}
function finishSpeech(error) {
  const text = speechText;
  stopSpeech();
  if (error) { display(text); voiceStatus(error); replyUntil = Date.now() + 15000; paint(); }
  else if (composing) { display(text); replyUntil = 0; paint(); }
  else close();
  if (composing && document.hasFocus()) $('message').focus();
}
async function speakReply(result) {
  stopSpeech(); speechActive = true; speechId = result.speechId; speechText = result.reply; setSpeaking(true);
  const ticket = speechSequence, id = speechId;
  const current = () => ticket === speechSequence && speechActive;
  const fetchChunk = async index => {
    try { return await api.invoke({ type: 'speech', id, index }); }
    catch { return { ok: false, error: '语音合成失败，文字回复仍可查看。' }; }
  };
  const waiting = () => {
    clearTimeout(speechTimer); voiceStatus('正在准备声音…');
    speechTimer = setTimeout(() => { if (current()) { api.input({ type: 'cancel' }); finishSpeech('语音合成超时，文字回复仍可查看。'); } }, 245000);
  };
  display(speechText); waiting(); paint();
  async function playChunk(index, prepared) {
    const speech = await prepared;
    if (!current()) return;
    if (!speech?.ok || speech.id !== id || speech.index !== index) { finishSpeech(speech?.error || '语音未能播放，文字回复仍可查看。'); return; }
    if (speech.done) { finishSpeech(); return; }
    if (speech.mime !== 'audio/wav' || typeof speech.audioBase64 !== 'string' || !speech.audioBase64) { finishSpeech('语音未能播放，文字回复仍可查看。'); return; }
    try {
      const audio = speechAudio = new Audio('data:audio/wav;base64,' + speech.audioBase64);
      audio.volume = volume;
      // Fetch only one next chunk while this one plays; stale replies never start audio.
      const next = fetchChunk(index + 1);
      audio.onended = () => {
        if (!current()) return;
        audio.onplaying = audio.onended = audio.onerror = null;
        audio.removeAttribute('src'); audio.load(); speechAudio = null;
        waiting(); void playChunk(index + 1, next);
      };
      audio.onerror = () => { if (current()) finishSpeech('音频播放失败，文字回复仍可查看。'); };
      audio.onplaying = () => {
        if (!current()) return;
        voiceStatus(''); setSpeaking(true); clearTimeout(speechTimer);
        speechTimer = setTimeout(() => { if (current()) finishSpeech('播放超时，已停止声音。'); }, Number.isFinite(audio.duration) ? Math.min(600000, Math.max(15000, audio.duration * 1000 + 5000)) : 180000);
      };
      await audio.play();
    } catch { if (current()) finishSpeech('无法播放声音，文字回复仍可查看。'); }
  }
  await playChunk(0, fetchChunk(0));
}
function paint() {
  controls();
  document.body.classList.toggle('expanded', expanded);
  $('conversation').hidden = !expanded;
  $('composer').hidden = !composing || settings;
  $('settings').hidden = !settings;
  $('panelActions').hidden = !composing;
  $('rail').hidden = expanded && (composing || settings);
  $('menu').hidden = !expanded || composing || settings;
  $('toggle').setAttribute('aria-expanded', String(composing));
  $('toggle').setAttribute('aria-label', composing ? '收起聊天' : '展开聊天');
  measure(); armHide();
}
function open() {
  expanded = composing = true; settings = false;
  replyUntil = 0;
  if (!pending && !$('reply').textContent && $('translation').hidden) display('老师，想聊些什么？');
  paint(); api.input({ type: 'focus' }); requestAnimationFrame(() => $('message').focus());
  if(sessionId){const ticket=sequence,id=sessionId;void api.invoke({type:'current'}).then(result=>{if(result?.session&&id===sessionId&&ticket===sequence&&!pending){loadSession(result.session,!$('message').value);}}).catch(()=>{});}
}
function close() {microphoneSequence++;listening=false; if(pending&&!$('message').value)$('message').value=pendingText;saveDraft(); sequence++; api.input({ type: 'cancel' }); stopSpeech(); pending = false; $('send').disabled = false; expanded = composing = settings = false; replyUntil = 0; lastTask = ''; clearTimeout(timer); $('apiKey').value = ''; $('message').blur(); api.input({ type: 'hit', value: false }); paint(); }
async function showSettings() {
    if(listening){microphoneSequence++;listening=false;api.input({type:'cancel'});controls();}
  const config=await api.invoke({type:'status'});if(config?.applicationSettings){await api.invoke({type:'settings'});return;}
  sequence++; api.input({ type: 'cancel' }); stopSpeech(); pending = false; $('send').disabled = false;
  expanded = composing = settings = true; $('bubble').hidden = true; paint(); api.input({ type: 'focus' });
  const status = await api.invoke({ type: 'status' });
  $('keyStatus').textContent = status?.configured ? '已保存本机 Key，填写新 Key 可替换。' : status?.encryptionAvailable === false ? '本机加密不可用，暂时无法保存。' : '尚未配置 API Key。';
  $('saveKey').disabled = status?.encryptionAvailable === false;
  $('apiKey').focus();
}
$('toggle').onclick = () => composing ? close() : open();
$('menu').onclick = () => api.input({ type: 'menu' });
$('panelMenu').onclick = event => { event.stopPropagation(); api.input({ type: 'menu' }); };
$('panelClose').onclick = event => { event.stopPropagation(); close(); };
$('interrupt').onclick=interrupt;
$('microphone').onclick=()=>void dictate();
$('bubble').onclick = () => { if (!composing && !settings) open(); };
$('rail').oncontextmenu = event => { event.preventDefault(); api.input({ type: 'menu' }); };
$('back').onclick = () => { settings = false; $('apiKey').value = ''; display(history().at(-1)?.content || '老师，想聊些什么？'); open(); };
$('saveKey').onclick = async () => {
  $('saveKey').disabled = true;
  try { const result = await api.invoke({ type: 'key', value: $('apiKey').value }); $('apiKey').value = ''; $('keyStatus').textContent = result?.ok ? '已加密保存，可以返回聊天了。' : result?.error || '保存失败，请重试。'; }
  finally { $('saveKey').disabled = false; }
};
$('composer').onsubmit = async event => {
  event.preventDefault();
  const text = $('message').value.trim(); if (!text || pending || listening || event.isComposing) return;
  const attempt = sequence;
  const status = await api.invoke({ type: 'status' });
  if (attempt !== sequence || pending || !composing || settings) return;
  if (!status?.configured&&!status?.assistantEnabled) { await showSettings(); return; }
  const items = history();
  stopSpeech();
  pending = true; $('send').disabled = true; clearTimeout(timer);
  const request = ++sequence, requestContext = context;
  const outgoing = [...items, { role: 'user', content: text }].slice(-24);
  pendingText=text;
  clearTimeout(draftTimer);
  const last=sessionSnapshot?.messages.at(-1);
  const retryId=last?.role==='user'&&['failed','cancelled','interrupted'].includes(last.status)&&last.content===text?last.id:undefined;
  $('message').value = ''; display('正在想…', 'pending');
  let result;
  try { result = await api.invoke({ type: 'send', sessionId, text, retryId, history: outgoing, requestId: request }); }
  catch { result = { ok: false, error: '连接失败，请稍后重试。' }; }
  if (request !== sequence || requestContext !== context) return;
  pending = false; $('send').disabled = false;
  if(result?.session)loadSession(result.session,false);
  if (result?.ok) {
    if(!result.session){items.push({ role: 'user', content: text }, { role: 'assistant', content: result.reply });items.splice(0, Math.max(0, items.length - 24));}
    display(result.reply);
  } else {
    if (!$('message').value) $('message').value = text;
    display(result?.error || '请求失败，请重试。', 'error');
  }
  replyUntil = Date.now() + 15000;
  expanded = true; composing = true; paint();
  if (result?.ok && result.speechId != null) void speakReply(result);
  if (composing && document.hasFocus()) $('message').focus();
};
$('message').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault(); });
$('message').addEventListener('input', () => { armHide();clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,350); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') close();else if(event.altKey&&event.key.toLowerCase()==='v'&&composing&&!settings){event.preventDefault();if(!event.repeat)void dictate();} });
document.addEventListener('pointermove', event => { api.input({ type: 'hit', value: Boolean(event.target.closest('button,input,#bubble,#settings,#composer')) }); });
$('shell').addEventListener('pointerleave', () => { api.input({ type: 'hit', value: false }); armHide(); });
api.onEvent(({ type, value }) => {
  if (type === 'identity') {
    const next = value.persona || value.name + ':' + value.outfit;
    identity = value;
    $('who').textContent = value.name || '白子';
    if (next !== context) { close(); context = next; sessionId=null;sessionSnapshot=null;pending = false; $('send').disabled = false; $('message').value = ''; const last = history().at(-1); display(last?.content || ''); }
    $('message').placeholder = '和' + (value.name || '我') + '聊聊…';
  } else if(type==='session') {
    microphoneSequence++;listening=false;
    if(sessionId&&value.session.id!==sessionId)saveDraft();
    clearTimeout(draftTimer);sequence++;stopSpeech();pending=false;$('send').disabled=false;
    loadSession(value.session,value.session.id!==sessionId||!$('message').value);display(history().at(-1)?.content||'老师，想聊些什么？');
    if(value.open)open();else paint();
  } else if(type==='dictation-ready'){if(listening){microphonePhase=value?.canFinish===false?'automatic':'recording';controls();voiceStatus(value?.canFinish===false?'正在听，请说话…（■ 可取消）':'正在听，请说话；说完点“完成”（最长 20 秒，■ 可取消）');}
  } else if(type==='dictation-processing'){if(listening){microphonePhase='processing';controls();voiceStatus('正在识别语音…');}
  } else if(type==='draft-text'){interrupt();$('message').value=value;saveDraft();open();
  } else if (type === 'agent-status') {
    if(pending&&value.requestId===sequence)display(value.text,'pending');
  } else if (type === 'announcement') {
    if(pending||speechActive)return;
    expanded=true;display(value.reply);replyUntil=Date.now()+15000;paint();if(value.speechId!=null)void speakReply(value);
  } else if (type === 'reply-progress') {
    if (pending && value.requestId === sequence && typeof value.text === 'string') display(value.text);
  } else if (type === 'task') {
    if (value.hidden || !value.text) { lastTask = ''; if (!composing && !settings && !pending && $('bubble').dataset.kind === 'task') close(); return; }
    if (composing || settings || pending || speechActive) return;
    if (expanded && $('bubble').dataset.kind === 'task' && value.text === lastTask) return;
    lastTask = value.text;
    // The original voice controller owns the line's lifetime, including long clips
    // and interrupted playback. This watchdog only handles a missing completion.
    expanded = true; display(value.text, 'task'); replyUntil = Date.now() + 125000; paint();
  } else if (type === 'placement') { placementArrow = value.arrow; positionTail(); }
  else if (type === 'volume') { if (Number.isFinite(value)) { volume = Math.max(0, Math.min(1, value)); if (speechAudio) speechAudio.volume = volume; } }
  else if (type === 'speech-stop') { if (speechActive) finishSpeech(); }
  else if (type === 'open') open();
  else if (type === 'close') close();
  else if (type === 'settings') void showSettings();
  else if (type === 'clear') { sequence++; api.input({ type: 'cancel' }); stopSpeech(); history().length = 0; pending = false; $('send').disabled = false; $('message').value = ''; display('对话已清空。'); open(); }
  else if (type === 'blur' && !settings && !pending && !$('message').value.trim()) armHide();
});
api.input({ type: 'ready' }); paint();
