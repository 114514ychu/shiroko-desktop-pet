export function initAssistantPanel({api}){
 const $=id=>document.getElementById(id),dialog=$('assistantDialog');let data,editing=null,busy=false,timer;
 const labels={get_time:'时间日期',calculate:'数学计算',date_difference:'日期计算',search_history:'历史检索',list_memory:'读取记忆',remember_fact:'保存记忆',forget_fact:'删除记忆',create_reminder:'创建提醒',list_reminders:'查看提醒',cancel_reminder:'取消提醒',create_recurring_reminder:'重复提醒',snooze_reminder:'延后提醒',web_search:'联网搜索',get_weather:'城市天气',find_files:'查找文件',read_text_file:'读取文本',find_applications:'查找已安装软件',open_application:'自动打开软件',open_folder:'打开授权文件夹'};
 function error(message=''){$('assistantError').textContent=message;$('assistantError').hidden=!message;}
 async function call(v){const r=await api.assistant(v);if(!r?.ok)throw Error(r?.error||'操作失败。');return r.result;}
 async function run(fn){if(busy)return;busy=true;dialog.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=true);error();try{await fn();}catch(e){error(e.message);}finally{busy=false;dialog.querySelectorAll('button,input,textarea,select').forEach(e=>e.disabled=false);if(data)$('assistantStartup').disabled=!data.startupSupported;}}
 function row(content,actions=[]){const article=document.createElement('article'),p=document.createElement('p'),buttons=document.createElement('div');p.textContent=content;article.append(p);for(const [label,fn] of actions){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>void run(fn);buttons.append(b);}article.append(buttons);return article;}
 function cancelEdit(){editing=null;$('memoryText').value='';$('memorySave').textContent='保存记忆';$('memoryEditCancel').hidden=true;}
 async function refresh(){
  data=await call({type:'snapshot'});if(!dialog.open)return;
  $('assistantClock').textContent=data.clock.local+' · '+data.clock.weekday+' · '+data.clock.timezone;
  if(data.issue)error(data.issue);
  $('memoryList').replaceChildren(...data.memories.map(m=>row(m.text,[['编辑',async()=>{editing=m.id;$('memoryText').value=m.text;$('memorySave').textContent='保存修改';$('memoryEditCancel').hidden=false;$('memoryText').focus();}],['删除',async()=>{if(!confirm('删除这条长期记忆？'))return;await call({type:'memory-delete',id:m.id});if(editing===m.id)cancelEdit();await refresh();}]])));
  if(!data.memories.length)$('memoryList').textContent='还没有保存记忆。';
  $('reminderList').replaceChildren(...[...data.reminders].reverse().map(r=>row(({pending:'待提醒',delivered:'已提醒',missed:'错过',cancelled:'已取消'}[r.status])+' · '+new Date(r.dueAt).toLocaleString('zh-CN',{hour12:false})+(r.repeat?' · '+({daily:'每天',weekdays:'工作日',weekly:'每周'}[r.repeat]):'')+(r.snoozeUntil?' · 延后至'+new Date(r.snoozeUntil).toLocaleTimeString('zh-CN'):'')+'\n'+r.text,[...(r.status!=='cancelled'?[['延后十分钟',async()=>{await call({type:'reminder-snooze',id:r.id,minutes:10});await refresh();}]]:[]),...(r.status==='pending'?[['取消提醒',async()=>{await call({type:'reminder-cancel',id:r.id});await refresh();}]]:[])])));
  if(!data.reminders.length)$('reminderList').textContent='还没有提醒。';
  $('assistantToolList').replaceChildren(...data.tools.map(t=>{const label=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='checkbox';input.checked=t.enabled;input.setAttribute('aria-label',labels[t.name]||t.name);span.textContent=(labels[t.name]||t.name)+' · '+t.description+(t.available===false?'（需要先配置授权）':'');input.onchange=()=>void run(async()=>{try{await call({type:'tool-toggle',name:t.name,enabled:input.checked});}finally{await refresh();}});label.append(input,span);return label;}));
  const s=data.settings||{};
  // Preserve unsaved settings while an external reminder refreshes the lists.
  if(!dialog.contains(document.activeElement)||!document.activeElement.closest('form')){
   for(const [id,key] of [['assistantNetwork','network'],['assistantAutoApplications','autoApplications'],['assistantCompanionship','companionship'],['assistantGreeting','greeting'],['assistantAmbientVoice','voice']])$(id).checked=Boolean(s[key]);
   for(const [id,key] of [['assistantCity','city'],['assistantBreak','breakMinutes'],['assistantQuietStart','quietStart'],['assistantQuietEnd','quietEnd']])$(id).value=s[key]??'';
  }
  $('assistantStartup').checked=Boolean(data.startup);$('assistantStartup').disabled=!data.startupSupported;
  for(const [id,kind] of [['assistantFolders','folders'],['assistantOpenFolders','openFolders']]){$(id).replaceChildren(...(s[kind]||[]).map(x=>row(x.name+'\n'+x.path,[['撤销',async()=>{await call({type:'grant-remove',kind,id:x.id});await refresh();}]])));}
 }
 async function open(){if(!dialog.open){await call({type:'visibility',value:true});dialog.showModal();}await refresh();}
 $('assistantOpen').onclick=()=>void run(open);$('assistantClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{void api.assistant({type:'visibility',value:false});$('assistantOpen').focus();});
 document.querySelectorAll('[data-assistant-tab]').forEach(button=>button.onclick=()=>{for(const b of document.querySelectorAll('[data-assistant-tab]')){const selected=b===button;b.setAttribute('aria-pressed',String(selected));$('assistant-'+b.dataset.assistantTab).hidden=!selected;}});
 $('memoryEditCancel').onclick=cancelEdit;
 $('memoryForm').onsubmit=e=>{e.preventDefault();void run(async()=>{await call({type:'memory-save',id:editing,text:$('memoryText').value});cancelEdit();await refresh();});};
 $('reminderForm').onsubmit=e=>{e.preventDefault();void run(async()=>{await call({type:'reminder-create',text:$('reminderText').value,when:$('reminderWhen').value,repeat:$('reminderRepeat').value});$('reminderText').value='';$('reminderWhen').value='';await refresh();});};
 $('capabilitiesForm').onsubmit=e=>{e.preventDefault();void run(async()=>{await call({type:'settings-save',settings:{network:$('assistantNetwork').checked,city:$('assistantCity').value}});await refresh();});};
 $('applicationsForm').onsubmit=e=>{e.preventDefault();void run(async()=>{await call({type:'settings-save',settings:{autoApplications:$('assistantAutoApplications').checked}});await refresh();});};
 $('companionForm').onsubmit=e=>{e.preventDefault();void run(async()=>{await call({type:'settings-save',settings:{companionship:$('assistantCompanionship').checked,greeting:$('assistantGreeting').checked,voice:$('assistantAmbientVoice').checked,breakMinutes:Number($('assistantBreak').value),quietStart:Number($('assistantQuietStart').value),quietEnd:Number($('assistantQuietEnd').value)}});await refresh();});};
 for(const [id,type] of [['assistantFolderAdd','choose-folder'],['assistantOpenFolderAdd','choose-open-folder']])$(id).onclick=()=>void run(async()=>{await call({type});await refresh();});
 $('assistantClipboard').onclick=()=>void run(async()=>{await call({type:'clipboard-draft'});dialog.close();});
 $('assistantStartup').onchange=()=>void run(async()=>{try{await call({type:'startup',enabled:$('assistantStartup').checked});}finally{await refresh();}});
 api.onAssistantChanged(()=>{if(!dialog.open||busy)return;clearTimeout(timer);timer=setTimeout(()=>void refresh().catch(e=>error(e.message)),120);});
 api.onAssistantOpen(()=>void run(open));
 return {open};
}
