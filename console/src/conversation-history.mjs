export function initConversationHistory({api,toast,getState}) {
  const $=id=>document.getElementById(id),dialog=$('historyDialog');
  let items=[],total=0,selected=null,query='',listTicket=0,detailTicket=0,searchTimer,refreshTimer,shown=100,busy=false;
  const date=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
  const persona=value=>value.persona.endsWith(':terror')?'白子 Terror':'白子 · 常服 / 骑行 / 泳装';
  function error(message=''){$('historyError').textContent=message;$('historyError').hidden=!message;}
  async function call(value){const result=await api.history(value);if(!result?.ok)throw Error(result?.error||'操作未完成，请重试。');return result;}
  async function run(fn){if(busy)return;busy=true;for(const id of ['historyResume','historyNew','historyRename','historyDelete','historyDeleteYes'])$(id).disabled=true;error();try{await fn();}catch(e){error(e.message);}finally{busy=false;for(const id of ['historyResume','historyNew','historyRename','historyDelete','historyDeleteYes'])$(id).disabled=false;}}
  function renderList(){
    const list=$('historyList');list.replaceChildren();
    if(!items.length){const p=document.createElement('p');p.className='history-empty';p.textContent=query?'没有找到匹配的聊天记录。':'还没有聊天记录。发送第一条消息后，会自动保存。';list.append(p);}
    for(const item of items){
      const button=document.createElement('button');button.type='button';button.dataset.sessionId=item.id;button.setAttribute('aria-current',String(selected?.id===item.id));
      const title=document.createElement('strong'),meta=document.createElement('small'),preview=document.createElement('span');title.textContent=item.title;meta.textContent=persona(item)+' · '+date(item.updatedAt);preview.className='history-preview';preview.textContent=item.preview;button.append(title,meta,preview);button.onclick=()=>{if(!busy)void select(item.id).catch(e=>error(e.message));};list.append(button);
    }
    $('historyMore').hidden=items.length>=total;
  }
  async function list(more=false){
    const ticket=++listTicket,result=await call({type:'list',query,offset:more?items.length:0});if(ticket!==listTicket||!dialog.open)return;
    items=more?[...items,...result.items]:result.items;total=result.total;renderList();if(result.issues.length)error(result.issues.join('\n'));
  }
  function renderTranscript(){
    const area=$('historyTranscript');area.replaceChildren();if(!selected)return;
    const messages=selected.messages,start=Math.max(0,messages.length-shown);
    if(start){const button=document.createElement('button');button.type='button';button.textContent='查看更早的 '+Math.min(100,start)+' 条消息';button.onclick=()=>{shown+=100;renderTranscript();};area.append(button);}
    for(const message of messages.slice(start)){
      const article=document.createElement('article');article.className='history-message';article.dataset.role=message.role;const header=document.createElement('header'),content=document.createElement('p');header.textContent=(message.role==='user'?'我':selected.name)+' · '+date(message.at);content.textContent=message.content;article.append(header,content);
      if(message.status!=='completed'){const status=document.createElement('p');status.className='history-message-status';status.textContent=message.status==='pending'?'正在回复…':message.error||'这条回复未完成，可以在桌宠中重试。';article.append(status);}area.append(article);
    }
    if(!messages.length){const p=document.createElement('p');p.className='history-empty';p.textContent='这是一段新对话，还没有消息。';area.append(p);}
    if(selected.draft){const p=document.createElement('p');p.className='history-empty';p.textContent='有未发送的草稿，继续对话时会恢复。';area.append(p);}
    $('historyCount').textContent=messages.length+' 条消息 · 本地保存';
  }
  function renderDetail(){
    $('historyEmpty').hidden=Boolean(selected);$('historySelected').hidden=!selected;
    $('historyRenameForm').hidden=true;$('historyDeleteConfirm').hidden=true;
    if(selected){$('historyTitle').textContent=selected.title;$('historyIdentity').textContent=persona(selected)+' · '+date(selected.updatedAt);renderTranscript();}
    renderList();
  }
  async function select(id){const ticket=++detailTicket;const result=await call({type:'get',id});if(ticket!==detailTicket||!dialog.open)return;selected=result.session;shown=100;renderDetail();$('historyTranscript').scrollTop=$('historyTranscript').scrollHeight;}
  async function open(id){
    if(!dialog.open){await call({type:'visibility',value:true});dialog.showModal();}
    error();await list();if(id)await select(id);else if(selected)await select(selected.id);else if(items.length)await select(items[0].id);else renderDetail();
    $('historySearch').focus();
  }
  async function resume(id){await call({type:'resume',id});dialog.close();toast('已恢复对话，可以在桌宠里继续聊。');}
  $('chatHistory').onclick=()=>void open().catch(e=>error(e.message));
  $('historyClose').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{listTicket++;detailTicket++;clearTimeout(searchTimer);void call({type:'visibility',value:false}).catch(e=>toast(e.message));$('chatHistory').focus();});
  $('historySearch').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{query=$('historySearch').value.trim();void list().catch(e=>error(e.message));},250);});
  $('historyMore').onclick=()=>void list(true).catch(e=>error(e.message));
  $('historyNew').onclick=()=>void run(async()=>{const state=getState();const roleId=selected?.roleId||state?.preferences.soloId||state?.roles.find(item=>item.visible)?.id;const result=await call({type:'new',roleId});selected=result.session;await list();renderDetail();await resume(result.session.id);});
  $('historyResume').onclick=()=>void run(()=>resume(selected.id));
  $('historyRename').onclick=()=>{$('historyDeleteConfirm').hidden=true;$('historyTitleInput').value=selected.title;$('historyRenameForm').hidden=false;$('historyTitleInput').focus();$('historyTitleInput').select();};
  $('historyRenameCancel').onclick=()=>{$('historyRenameForm').hidden=true;};
  $('historyRenameForm').onsubmit=event=>{event.preventDefault();void run(async()=>{const result=await call({type:'rename',id:selected.id,title:$('historyTitleInput').value});selected=result.session;await list();renderDetail();});};
  $('historyDelete').onclick=()=>{$('historyRenameForm').hidden=true;$('historyDeleteConfirm').hidden=false;$('historyDeleteNo').focus();};
  $('historyDeleteNo').onclick=()=>{$('historyDeleteConfirm').hidden=true;};
  $('historyDeleteYes').onclick=()=>void run(async()=>{await call({type:'delete',id:selected.id});selected=null;detailTicket++;await list();if(items.length)await select(items[0].id);else renderDetail();});
  api.onHistoryOpen(id=>void open(id).catch(e=>error(e.message)));
  api.onHistoryChanged(()=>{if(!dialog.open||busy)return;clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{try{await list();if(!dialog.open||busy||!$('historyRenameForm').hidden||!$('historyDeleteConfirm').hidden)return;if(selected){const id=selected.id,ticket=detailTicket;const result=await call({type:'get',id});if(dialog.open&&ticket===detailTicket&&selected?.id===id){const area=$('historyTranscript'),position=area.scrollTop,atEnd=area.scrollHeight-area.clientHeight-position<30;selected=result.session;renderTranscript();area.scrollTop=atEnd?area.scrollHeight:position;}}}catch(e){error(e.message);}},180);});
  return {open};
}
