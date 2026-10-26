const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await delay(40);}throw Error('Timed out: '+label);}
exports.run=async(c,runtime)=>{
  const out=path.join(c.QA,'conversations');fs.mkdirSync(out,{recursive:true});
  const overlay=runtime.chatWindow(),chat=script=>overlay.webContents.executeJavaScript(script),ui=script=>c.win.webContents.executeJavaScript(script);
  await until(async()=>await ui("Boolean(document.getElementById('chatHistory')?.onclick)"),'history UI initialization');
  await until(async()=>await chat('Boolean(sessionId)'),'initial session');
  const marker=path.join(c.APP_PATHS.root,'history-qa-restart.json');
  if(process.argv.includes('--self-test-history-restart')){
    const saved=JSON.parse(fs.readFileSync(marker,'utf8'));assert.equal(c.conversations.get(saved.id).draft,'重启后恢复的草稿');
    await ui("document.getElementById('chatHistory').click();true");await until(async()=>await ui("document.getElementById('historyDialog').open&&document.getElementById('historyList').children.length>0"),'restart history list');
    assert.equal((await c.historyAction({type:'resume',id:saved.id})).ok,true);
    await until(async()=>await chat('sessionId==='+JSON.stringify(saved.id)+'&&composing'),'restart continued session');
    assert.equal(await chat("document.getElementById('message').value"),'重启后恢复的草稿');
    assert.equal(c.conversations.get(saved.id).messages.length,saved.messages);assert.equal(await chat('speechActive'),false);
    fs.writeFileSync(path.join(out,'restart-validation.json'),JSON.stringify({ok:true,persistedMessages:saved.messages,recoveredDraft:true,automaticHistoricalAudio:false},null,2));return;
  }
  let mode='reply',gate,requests=[];const original=c.appSettings.get();
  const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
    const payload=JSON.parse(raw);requests.push(payload);assert.equal(req.headers.authorization,undefined);res.setHeader('Content-Type','application/json');
    if(mode==='fail'){res.statusCode=503;res.end('{}');return;}
    if(mode==='hold'){gate=()=>{if(!res.destroyed)res.end(JSON.stringify({choices:[{message:{content:'旧回复不应保存'}}]}));};return;}
    const remembers=payload.messages.some(item=>item.content==='我的昵称是小海，喜欢海边。');
    res.end(JSON.stringify({choices:[{message:{content:remembers?'小海，记得你喜欢海边。':'老师，你好。'}}]}));
  });});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    c.appSettings.save({...original,endpoint:'http://127.0.0.1:'+server.address().port+'/v1',model:'history-test',speechEnabled:false});
    async function send(text){const before=requests.length;await chat("open();document.getElementById('message').value="+JSON.stringify(text)+";document.getElementById('composer').requestSubmit();true");await until(()=>requests.length>before,'mock request received');await until(async()=>await chat("!pending&&document.getElementById('bubble').dataset.kind!=='pending'"),'chat reply');}
    await send('我的昵称是小海，喜欢海边。');const firstId=await chat('sessionId');assert.equal(c.conversations.get(firstId).messages.length>=2,true);
    await chat("document.getElementById('message').value='切换前的草稿';document.getElementById('message').dispatchEvent(new Event('input'));true");
    await ui("document.getElementById('chatHistory').click();true");await until(async()=>await ui("document.getElementById('historyDialog').open&&document.getElementById('historyTitle').textContent.length>0"),'history dialog');
    assert.equal([...c.views.values()].some(v=>v.attached),false,'native studio must not cover the history dialog');
    await ui("document.getElementById('historyNew').click();true");await until(async()=>await chat('sessionId!=='+JSON.stringify(firstId)),'new session');
    const secondId=await chat('sessionId');await until(()=>c.conversations.get(firstId).draft==='切换前的草稿','old draft saved');
    assert.equal(await chat("document.getElementById('message').value"),'');await send('另一段独立聊天');
    assert.equal(requests.at(-1).messages.some(item=>item.content==='我的昵称是小海，喜欢海边。'),false,'independent sessions must not leak context');
    await ui("document.getElementById('chatHistory').click();true");await until(async()=>await ui("document.getElementById('historyDialog').open"),'open history again');
    await ui("document.querySelector('[data-session-id=\""+firstId+"\"]').click();true");await until(async()=>await ui("document.getElementById('historyTranscript').textContent.includes('我的昵称是小海')"),'full transcript');
    await ui("document.getElementById('historyRename').click();document.getElementById('historyTitleInput').value='<img src=x onerror=alert(1)> 海边计划';document.getElementById('historyRenameForm').requestSubmit();true");
    await until(()=>c.conversations.get(firstId).customTitle,'rename');assert.equal(await ui("document.querySelector('#historyTitle img')===null"),true,'titles must be plain text');
    await ui("document.getElementById('historySearch').value='昵称';document.getElementById('historySearch').dispatchEvent(new Event('input'));true");
    await until(async()=>await ui("document.querySelectorAll('#historyList [data-session-id]').length===1"),'search full transcript');
    for(const theme of ['light','dark']){c.setTheme(theme);await delay(160);assert.equal(await ui("document.getElementById('historyDialog').scrollWidth<=document.getElementById('historyDialog').clientWidth"),true);fs.writeFileSync(path.join(out,'history-'+theme+'.png'),(await c.win.capturePage()).toPNG());}
    await ui("document.getElementById('historyResume').click();true");await until(async()=>await chat('sessionId==='+JSON.stringify(firstId)+'&&composing'),'resume selected');assert.equal(await chat("document.getElementById('message').value"),'切换前的草稿');assert.equal(await chat('speechActive'),false);
    await send('你还记得我的昵称吗？');assert.equal(await chat("document.getElementById('reply').textContent"),'小海，记得你喜欢海边。');
    mode='fail';await send('失败后原句重试');await until(()=>c.conversations.get(firstId).messages.at(-1).status==='failed','failed message persisted');const count=c.conversations.get(firstId).messages.length;
    mode='reply';await send('失败后原句重试');assert.equal(c.conversations.get(firstId).messages.length,count+1,'retry must reuse failed user message');
    await chat("document.getElementById('message').value='换装未发送草稿';document.getElementById('message').dispatchEvent(new Event('input'));true");
    runtime.command({name:'variant',value:'swimsuit'});await until(()=>runtime.snapshot().ready,'swimsuit ready');assert.equal(await chat('sessionId'),firstId);assert.equal(await chat("document.getElementById('message').value"),'换装未发送草稿');
    runtime.command({name:'variant',value:'terror'});await until(()=>runtime.snapshot().ready,'Terror ready');await until(async()=>await chat('sessionId!=='+JSON.stringify(firstId)),'Terror isolated');const terrorId=await chat('sessionId');
    runtime.command({name:'variant',value:'default'});await until(()=>runtime.snapshot().ready,'default ready');await until(async()=>await chat('sessionId==='+JSON.stringify(firstId)),'shared normal persona');assert.notEqual(terrorId,firstId);
    mode='hold';await chat("open();document.getElementById('message').value='被切换取消的请求';document.getElementById('composer').requestSubmit();true");await until(()=>Boolean(gate),'pending request');
    assert.equal((await c.historyAction({type:'resume',id:secondId})).ok,true);gate();await until(()=>c.conversations.get(firstId).messages.at(-1).status==='cancelled','cancel stale turn');assert.equal(c.conversations.get(secondId).messages.some(item=>item.content==='旧回复不应保存'),false);
    mode='reply';await ui("document.getElementById('chatHistory').click();true");await until(async()=>await ui("document.getElementById('historyDialog').open"),'delete dialog');
    await ui("document.getElementById('historySearch').value='';document.getElementById('historySearch').dispatchEvent(new Event('input'));true");await until(async()=>await ui("Boolean(document.querySelector('[data-session-id=\""+secondId+"\"]'))"),'unfiltered list');
    await ui("document.querySelector('[data-session-id=\""+secondId+"\"]').click();true");await until(async()=>await ui("document.getElementById('historyTranscript').textContent.includes('另一段独立聊天')"),'select deletion target');
    await ui("document.getElementById('historyDelete').click();document.getElementById('historyDeleteNo').click();true");assert.doesNotThrow(()=>c.conversations.get(secondId));
    await ui("document.getElementById('historyDelete').click();document.getElementById('historyDeleteYes').click();true");await until(()=>!c.conversations.list().items.some(item=>item.id===secondId),'confirmed deletion');
    assert.equal((await c.historyAction({type:'resume',id:firstId})).ok,true);await chat("document.getElementById('message').value='重启后恢复的草稿';document.getElementById('message').dispatchEvent(new Event('input'));true");await until(()=>c.conversations.get(firstId).draft==='重启后恢复的草稿','restart draft persisted');
    fs.writeFileSync(marker,JSON.stringify({id:firstId,messages:c.conversations.get(firstId).messages.length}));
    fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({ok:true,packaged:c.app.isPackaged,tests:['history dialog above native view','new session','automatic save','full transcript search','rename text escaping','light and dark layouts','resume with previous context','drafts on switch','failed request retry without duplicate','shared outfit persona','separate Terror persona','cancel stale replies','delete confirmation','restart fixture saved'],mockChatRequests:requests.length,externalChatRequests:0,historicalAudioReplayed:false},null,2));
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));c.appSettings.save(original);}
};
