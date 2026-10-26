import { userMessage, studentOptions, visibilitySelection } from './ui-feedback.mjs';
import { createVolumeControl } from './volume-control.mjs';
import { PREVIEW_FRAME, visibleBounds, fitPreview, projectBounds } from './preview-fit.mjs';
import { characterIdentity, matchesCharacter } from './character-identity.mjs';
import { initConversationHistory } from './conversation-history.mjs';
import { initAssistantPanel } from './assistant-panel.mjs';

const api = window.petConsole;
const $ = id => document.getElementById(id);
let state, toastTimer, previewTargetsKey, removalId=null, removalBusy=false;
const cards = new Map();
const volumeControl = createVolumeControl({ input: $('volumeRange'), output: $('volumeValue'), send: value => api.volume(value), onError: error => toast(error.message) });
window.addEventListener('beforeunload', () => volumeControl.dispose());
const labels = { default:'默认服装',dress:'礼服',swimsuit:'泳装','new-year':'新年' };
function toast(message) { $('toast').textContent = userMessage(message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500); }
async function perform(action) { try { const value = await action(); if(value?.roles)render(value);if(value?.operation?.message)toast(value.operation.message); if (value === false) { if (state) render(state); toast('当前选择暂不可用，请等待学生载入完成。'); } } catch (error) { if (state) render(state); toast(error.message || '操作未完成，请重试。'); } }
function options(select, entries, value, signature) {
  if (select.dataset.signature !== signature) {
    select.replaceChildren(...entries.map(entry => { const o = document.createElement('option'); o.value = entry.id; o.textContent = entry.name; return o; }));
    select.dataset.signature = signature;
  }
  select.value = value;
}
function makeCard(role,index) {
  const element = document.createElement('article');element.className = 'character-card';element.dataset.id = role.id;
  element.innerHTML = '<div class="portrait"><span class="card-number"></span><svg class="portrait-orbit" viewBox="0 0 220 220" aria-hidden="true"><path d="M39.289 180.711 A100 100 0 1 1 180.711 180.711"/></svg><div class="preview-stage"><svg class="portrait-shadow" viewBox="0 0 310 280" preserveAspectRatio="xMidYMax meet" aria-hidden="true"><defs><radialGradient><stop offset="0" class="shadow-core"/><stop offset=".45" class="shadow-soft"/><stop offset="1" class="shadow-edge"/></radialGradient></defs><ellipse cx="155" cy="267" rx="60" ry="12"/></svg><img alt="学生场景预览"></div><div class="card-loading"><span>正在载入学生…</span><br><button hidden>重新载入</button></div></div><button type="button" class="remove-student" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5"/></svg></button><label class="visibility-toggle"><input type="checkbox"><span>显示</span></label><div class="glass-controls"><label class="glass-field"><span>服装</span><select></select></label><label class="glass-field"><span>动作</span><select></select></label></div><div class="package-actions" hidden><div class="package-progress" role="status" hidden><span class="download-spinner" aria-hidden="true"></span><output>0.00%</output><span class="package-phase">正在下载</span></div><p class="package-error" hidden></p><div class="package-buttons"><button class="install-student">下载学生</button><button class="cancel-download" hidden>取消</button></div></div><div class="card-footer"><div class="card-info"><div class="card-name"><span class="card-emblem" role="img"></span><strong></strong></div><div class="card-caption"><span class="status-dot" aria-hidden="true"></span><span class="card-status"></span><span class="card-inventory"></span></div></div><button class="more-button">动作面板 <span aria-hidden="true">↗</span></button></div>';
  const shadow = element.querySelector('.portrait-shadow ellipse'), gradient = element.querySelector('.portrait-shadow radialGradient');
  gradient.id = 'ground-' + role.id; shadow.setAttribute('fill', 'url(#' + gradient.id + ')');
  element.querySelector('.card-number').textContent = String(index+1).padStart(2,'0') + ' / STUDENT';
  element.querySelector('strong').textContent = role.name;
  const identity = characterIdentity(role), emblem = element.querySelector('.card-emblem');
  emblem.innerHTML = identity.emblemSVG; emblem.setAttribute('aria-label', identity.emblemLabel); emblem.title = identity.emblemLabel;
  const visible = element.querySelector('input');visible.setAttribute('aria-label','显示'+role.name);
  const [skin,clip] = element.querySelectorAll('select');skin.setAttribute('aria-label',role.name+'皮肤');clip.setAttribute('aria-label',role.name+'动作');
  visible.addEventListener('change',()=>perform(()=>api.selection(visibilitySelection(state.preferences,role.id,visible.checked))));
  skin.addEventListener('change',()=>perform(()=>api.command(role.id,'variant',skin.value)));
  clip.addEventListener('change',()=>perform(()=>api.command(role.id,clip.value === '__auto__' ? 'auto':'play',clip.value === '__auto__' ? undefined:clip.value)));
  element.querySelector('.more-button').addEventListener('click',()=>perform(()=>state.preferences.mode==='single'?api.selection({type:'solo',value:role.id}):api.details(role.id)));
  element.querySelector('.card-loading button').addEventListener('click',()=>perform(()=>api.retry(role.id)));
  element.querySelector('.install-student').addEventListener('click',()=>perform(()=>api.install(role.id)));
  element.querySelector('.remove-student').addEventListener('click',()=>openRemoval(role.id));
  element.querySelector('.cancel-download').addEventListener('click',()=>perform(()=>api.cancelInstall(role.id)));
  $('cards').append(element);
  const image = element.querySelector('img');image.alt = role.name+' · 当前服装与动作';
  const source = document.createElement('canvas'),output = document.createElement('canvas');
  output.width = PREVIEW_FRAME.width;output.height = PREVIEW_FRAME.height;
  const card = {element,visible,skin,clip,image,shadow,source,output,sourceContext:source.getContext('2d',{willReadFrequently:true}),outputContext:output.getContext('2d'),previewTicket:0};
  cards.set(role.id,card);return card;
}
async function openRemoval(id){
  const role=state?.roles.find(value=>value.id===id);
  if(!role?.installation?.removable||['downloading','verifying','installing','removing'].includes(role.installation.phase)||removalBusy)return;
  try{if(!await api.removalPrompt(id))return;}catch(error){toast(error.message);return;}
  removalId=id;$('removeName').textContent=role.name;
  const portrait=$('removePortrait');portrait.hidden=!role.thumbnail;if(role.thumbnail)portrait.src=role.thumbnail;else portrait.removeAttribute('src');
  $('removeDescription').textContent=role.visible?'将关闭桌面上的这名学生，并移除她的模型、动作与语音。':'将从这台电脑移除这名学生的模型、动作与语音。';
  $('removeError').hidden=true;setRemovalBusy(false);$('removeDialog').showModal();$('cancelRemove').focus();
}
function setRemovalBusy(value){
  removalBusy=value;$('removeDialog').setAttribute('aria-busy',String(value));
  $('cancelRemove').disabled=value;$('confirmRemove').disabled=value;
  $('confirmRemove').querySelector('.download-spinner').hidden=!value;
  $('confirmRemove').querySelector('.remove-label').textContent=value?'正在删除…':'删除学生';
}
function closeRemoval(){
  if(removalBusy)return;const id=removalId;removalId=null;$('removeDialog').close();api.removalPrompt(null).catch(error=>toast(error.message));
  const card=cards.get(id);if(card){const button=card.element.querySelector(card.element.querySelector('.remove-student').hidden?'.install-student':'.remove-student');if(!button.hidden)button.focus();}
}
$('cancelRemove').addEventListener('click',closeRemoval);
$('removeDialog').addEventListener('cancel',event=>{event.preventDefault();closeRemoval();});
$('confirmRemove').addEventListener('click',async()=>{
  if(!removalId||removalBusy)return;setRemovalBusy(true);$('removeError').hidden=true;
  try{
    const result=await api.remove(removalId);if(result?.roles)render(result);
    if(!result?.operation?.ok)throw Error(result?.operation?.message||'删除未完成，学生文件已保留，请重试。');
    setRemovalBusy(false);closeRemoval();toast(result.operation.message);
  }catch(error){setRemovalBusy(false);$('removeError').textContent=userMessage(error,'删除未完成，学生文件已保留，请重试。');$('removeError').hidden=false;}
});
function filterCards() {
  if (!state) return;
  const query = $('roleSearch').value;
  const previewTargets = [];
  let count = 0;
  for (const role of state.roles) {
    const match = matchesCharacter(role, query), card = cards.get(role.id);
    if (card) card.element.hidden = !match;
    if (match) { count++; if(role.installed)previewTargets.push(role.id); }
  }
  $('clearSearch').hidden = query.length === 0;
  const summary = query.trim() ? `找到 ${count} / ${state.roles.length} 名学生` : `${state.roles.length} 名学生`;
  if ($('searchSummary').textContent !== summary) $('searchSummary').textContent = summary;
  $('searchEmptyState').hidden = count > 0;
  $('emptyState').hidden = count === 0 || state.roles.some(role => role.visible);
  document.body.dataset.matchedCount = String(count);
  const targetKey = previewTargets.join('|');
  if (targetKey !== previewTargetsKey) { previewTargetsKey = targetKey; api.previewTargets(previewTargets); }
}
function clearSearch() { $('roleSearch').value = ''; filterCards(); $('roleSearch').focus(); }
function render(next) {
  state = next;
  document.documentElement.dataset.theme = next.presentation.theme;
  document.documentElement.dataset.productVersion = next.presentation.version;
  document.documentElement.dataset.author = next.presentation.author;
  const themeNames = {system:'跟随系统',light:'浅色',dark:'深色'};
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    const active = button.dataset.themeChoice === next.preferences.theme;
    button.setAttribute('aria-pressed',String(active));
    if (active) {
      button.title = `${themeNames[button.dataset.themeChoice]}主题，点击切换`;
      button.setAttribute('aria-label',`${themeNames[button.dataset.themeChoice]}主题，点击切换`);
    }
  }
  $('versionLabel').textContent = 'v' + next.presentation.version;
  $('updateSettingsDot').hidden = !next.updateReminder;
  $('moreSettings').setAttribute('aria-label', next.updateReminder ? '更多设置，有可用更新' : '更多设置');
  $('moreSettings').title = next.updateReminder ? '更多设置 · 有可用更新' : '更多设置';
  document.title = 'DSH 白子桌宠';
  document.body.dataset.mode = next.preferences.mode;
  document.body.dataset.detailsRole = next.detailsRole || '';
  const libraryOnly = !next.roles.some(role=>role.installed);
  $('multiContent').hidden = Boolean(next.detailsRole) || next.preferences.mode === 'single' && !next.libraryOpen;
  $('singlePlaceholder').hidden = !$('multiContent').hidden;
  $('soloPicker').hidden = next.preferences.mode !== 'single' || libraryOnly;
  $('manageStudents').hidden=next.preferences.mode!=='single';
  $('manageStudents').textContent=next.libraryOpen?(next.preferences.soloId?'← 返回陪伴':'← 返回单人陪伴'):'学生目录';
  $('manageStudents').disabled=false;
  $('backToCards').hidden = !next.detailsRole || next.preferences.mode !== 'multi';
  const visibleCount = next.roles.filter(role=>role.visible).length;
  const detailsName = next.roles.find(role=>role.id === next.detailsRole)?.name;
  $('contextText').textContent = next.detailsRole ? `${detailsName || '学生'} · 动作与视角` : `桌面已显示 ${visibleCount} 名学生`;
  $('contextHint').textContent = libraryOnly ? '下载喜欢的学生，开始桌面陪伴' : next.preferences.mode === 'single' ? '动作、视角和设置，与桌面实时同步' : '勾选学生，让桌面热闹一点';
  const work = next.codex;
  $('acknowledgeTask').hidden = !['review','failed'].includes(work.state);
  $('workState').dataset.state = work.state;
  $('workState').textContent = work.connected ? work.label : '任务未连接';
  $('workState').title = work.detail || (work.connected ? '只读跟随 Harness；完成提示保留 60 秒，也可点击已查看' : '请打开 DeepSeek Harness，开始一个任务');
  volumeControl.render(next.preferences.volume);
  const solo=studentOptions(next.roles);options($('soloRole'),solo.entries,next.preferences.soloId || '',solo.signature);
  const catalog=next.catalogStatus||{};$('refreshCatalog').disabled=Boolean(catalog.busy);$('refreshCatalog').textContent=catalog.busy?'刷新中…':'刷新目录';$('catalogStatus').textContent=catalog.message||'';$('catalogStatus').hidden=!catalog.message;$('catalogStatus').dataset.phase=catalog.phase||'idle';
  const singleError = next.roles.find(role=>role.id===next.preferences.soloId)?.error;
  const singleEmpty=!next.preferences.soloId&&!next.detailsRole;
  $('singleTitle').textContent=singleEmpty?'暂未选择学生':singleError?'学生载入遇到问题':'正在迎接学生…';
  $('singleMessage').textContent = singleError || (!singleEmpty ? '正在打开动作与视角面板…' : libraryOnly ? '先下载喜欢的学生，再开始单人陪伴。' : '在上方选择一名学生，开始单人陪伴。');
  $('browseStudents').hidden=!singleEmpty;
  $('browseStudents').textContent=libraryOnly?'下载学生':'管理与下载学生';
  $('retrySingle').hidden = !singleError;
  $('emptyState').hidden = visibleCount > 0;
  for (const [index,role] of next.roles.entries()) {
    const card = cards.get(role.id) || makeCard(role,index);
    const key = [role.config?.variant,role.activeClip || role.manualClip || ''].join('|');
    if (card.previewKey !== key) { card.previewKey = key;card.previewFit = null;card.previewTicket++; }
    card.element.classList.toggle('selected',Boolean(role.visible));card.visible.checked = next.preferences.mode==='single'?next.preferences.soloId===role.id:next.preferences.selectedIds.includes(role.id);
    card.element.dataset.ready = String(Boolean(role.ready && !role.error));
    card.element.dataset.error = String(Boolean(role.error));
    const install=role.installation||{phase:'idle',percent:'0.00'},busy=['downloading','verifying','installing','removing'].includes(install.phase);
    const removeButton=card.element.querySelector('.remove-student');removeButton.hidden=!install.removable;removeButton.disabled=busy;removeButton.title='删除'+role.name;removeButton.setAttribute('aria-label','删除已下载的'+role.name);
    card.element.dataset.installed=String(Boolean(role.installed));
    const panel=card.element.querySelector('.package-actions'),progress=panel.querySelector('.package-progress'),installButton=panel.querySelector('.install-student'),cancel=panel.querySelector('.cancel-download'),error=panel.querySelector('.package-error');
    panel.hidden=Boolean(role.installed&&!install.updateAvailable&&!busy&&!install.error);card.element.dataset.packageActive=String(!panel.hidden);
    progress.hidden=!busy;progress.querySelector('output').hidden=install.phase==='removing';progress.querySelector('output').textContent=Number(install.percent||0).toFixed(2)+'%';
    progress.querySelector('.package-phase').textContent={downloading:'正在下载',verifying:'正在校验',installing:'正在安装',removing:'正在删除'}[install.phase]||'';
    installButton.hidden=busy;cancel.hidden=!['downloading','verifying'].includes(install.phase);
    installButton.textContent=role.installed?'更新并重启':install.error?'重新下载':'下载学生'+(install.downloadBytes?' · '+(install.downloadBytes/1048576).toFixed(2)+' MiB':'');
    error.hidden=!install.error;error.textContent=install.error||'';
    if(role.thumbnail&&(!role.installed||!card.image.hasAttribute('src'))&&(card.wasInstalled||card.staticThumbnail!==role.thumbnail||!card.image.hasAttribute('src'))){card.staticThumbnail=role.thumbnail;card.image.src=role.thumbnail;}
    card.wasInstalled=Boolean(role.installed);
    card.image.alt=role.name+(role.installed?' · 当前服装与动作':' · 学生预览');
    card.visible.disabled = !role.installed||busy;

    card.element.querySelector('.visibility-toggle span').textContent = role.visible ? '已显示':'显示';
    const loader = card.element.querySelector('.card-loading');loader.hidden = !role.installed || Boolean(role.ready && !role.error && card.image.hasAttribute('src')) || next.preferences.mode==='single'&&!role.loading&&!role.error;
    loader.querySelector('span').textContent = role.error || '正在载入学生…';loader.querySelector('button').hidden = !role.error;
    card.element.querySelector('.card-status').textContent = !role.installed ? '尚未下载' : role.error ? '载入失败' : role.ready ? role.manualClip ? '自选动作' : role.config.codexFollow ? work.label : '独立陪伴' : next.preferences.mode==='single'&&!role.loading ? '等待选择' : '准备中';
    const variants = role.variants || [],variant = variants.find(entry=>entry.id === role.config?.variant) || variants[0];
    card.element.querySelector('.card-inventory').textContent = `${variants.length || role.variantCount || 0} 套服装 · ${variants.reduce((sum,entry)=>sum+(entry.animations?.length || 0),0) || role.animationCount || 0} 个动作`;
    options(card.skin,variants.map(entry=>({id:entry.id,name:labels[entry.id] || entry.name})),variant?.id || '',variants.map(entry=>entry.id).join('|'));
    const animations = variant?.animations || [];
    options(card.clip,[{id:'__auto__',name:'自动陪伴'},...animations.map(entry=>({id:entry.name,name:entry.name}))],role.manualClip || '__auto__',(variant?.id || '')+'|'+animations.map(entry=>entry.name).join('|'));
    card.skin.disabled = busy || !role.ready || Boolean(role.error);card.clip.disabled = busy || !role.ready || Boolean(role.error);
    card.element.querySelector('.more-button').disabled = busy || !role.installed || next.preferences.mode==='multi'&&!role.ready || Boolean(role.error);
  }
  const needed=next.preferences.mode==='single'?next.roles.filter(role=>role.id===next.preferences.soloId):next.roles;
  document.body.dataset.ready = String(needed.every(role=>!role.installed || role.ready || role.error));
  document.body.dataset.visibleCount = String(visibleCount);
  filterCards();
}
api.onState(render);
api.onPreview(({id,dataUrl,variant,clip})=>{
  const card = cards.get(id),role = state?.roles.find(entry=>entry.id===id);
  if (!card || card.element.hidden || !role?.ready || role.error || !dataUrl?.startsWith('data:image/png;base64,') ||
      state.preferences.mode !== 'multi' || state.detailsRole) return;
  const key = [variant,clip || ''].join('|');
  if (key !== card.previewKey) return;
  const ticket = ++card.previewTicket,sourceImage = new Image();
  sourceImage.onload = () => {
    const currentRole = state.roles.find(entry=>entry.id===id);
    if (card.element.hidden || ticket !== card.previewTicket || key !== card.previewKey || !currentRole?.ready || currentRole.error ||
        state.preferences.mode !== 'multi' || state.detailsRole) return;
    const {source,sourceContext,output,outputContext} = card;
    source.width = sourceImage.naturalWidth;source.height = sourceImage.naturalHeight;
    sourceContext.drawImage(sourceImage,0,0);
    const bounds = visibleBounds(sourceContext.getImageData(0,0,source.width,source.height).data,source.width,source.height);
    const fit = fitPreview(bounds,card.previewFit,`${key}|${source.width}x${source.height}`);
    if (!fit) return; // A transient empty frame must not erase a valid preview.
    card.previewFit = fit;
    const ground = projectBounds(fit.envelope, fit);
    const visible = projectBounds(bounds, fit);
    card.shadow.setAttribute('cx', (visible.left + visible.right) / 2);
    card.shadow.setAttribute('cy', ground.bottom + 3);
    card.shadow.setAttribute('rx', Math.max(60, Math.min(100, (ground.right - ground.left) * .45)));
    outputContext.clearRect(0,0,output.width,output.height);
    outputContext.drawImage(source,fit.x,fit.y,source.width*fit.scale,source.height*fit.scale);
    card.image.src = output.toDataURL('image/png');
    card.element.dataset.previewKey = key;
    card.element.dataset.previewBounds = JSON.stringify(projectBounds(bounds,fit));
    card.element.dataset.previewScale = String(fit.scale);
    card.element.dataset.previewRevision = String((Number(card.element.dataset.previewRevision) || 0)+1);
    card.element.querySelector('.card-loading').hidden = true;
  };
  sourceImage.src = dataUrl;
});
$('refreshCatalog').addEventListener('click',()=>perform(async()=>{const button=$('refreshCatalog');button.disabled=true;try{return await api.refreshCatalog();}finally{button.disabled=false;}}));
const themeOrder = ['system','light','dark'];
for (const button of document.querySelectorAll('[data-theme-choice]')) button.addEventListener('click',()=>{
  const index = themeOrder.indexOf(button.dataset.themeChoice);
  perform(()=>api.theme(themeOrder[(index + 1) % themeOrder.length]));
});
$('soloRole').addEventListener('change',()=>perform(()=>api.selection({type:'solo',value:$('soloRole').value || null})));
$('manageStudents').addEventListener('click',()=>perform(()=>api.library(!state.libraryOpen)));
$('browseStudents').addEventListener('click',()=>perform(()=>api.library(true)));
$('backToCards').addEventListener('click',()=>perform(()=>api.back()));
$('moreSettings').addEventListener('click', () => {
  $('moreSettings').setAttribute('aria-expanded', 'true');
  perform(async () => { const result = await api.settings('menu'); if (!result) $('moreSettings').setAttribute('aria-expanded', 'false'); return result; });
});
api.onSettingsClosed(() => $('moreSettings').setAttribute('aria-expanded', 'false'));
api.onSettingsFocus(() => $('moreSettings').focus());
$('retrySingle').addEventListener('click',()=>{if(state.preferences.soloId)perform(()=>api.retry(state.preferences.soloId));});
$('roleSearch').addEventListener('input', filterCards);
$('roleSearch').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); clearSearch(); } });
$('clearSearch').addEventListener('click', clearSearch);
$('resetSearch').addEventListener('click', clearSearch);
api.initial().then(render).catch(error=>toast(error.message));

$('acknowledgeTask').addEventListener('click', () => perform(() => api.acknowledge()));
initConversationHistory({api,toast,getState:()=>state});
initAssistantPanel({api});
