const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){const end=Date.now()+25000;while(Date.now()<end){if(await fn())return;await delay(35);}throw Error('Timed out: '+label);}
exports.run=async(c,runtime)=>{
 const out=path.join(c.QA,'assistant');fs.mkdirSync(out,{recursive:true});const ui=s=>c.win.webContents.executeJavaScript(s),overlay=runtime.chatWindow(),chat=s=>overlay.webContents.executeJavaScript(s);
 await until(async()=>await ui("Boolean(document.getElementById('assistantOpen').onclick)"),'assistant UI initialization');await until(async()=>await chat('Boolean(sessionId)'),'chat initialized');
 const action=value=>ui('petConsole.assistant('+JSON.stringify(value)+')'),marker=path.join(c.APP_PATHS.root,'assistant-restart.json');
 if(process.argv.includes('--self-test-assistant-restart')){
  const before=JSON.parse(fs.readFileSync(marker,'utf8')),snapshot=(await action({type:'snapshot'})).result;
  assert.ok(snapshot.memories.some(x=>x.id===before.memoryId&&x.text==='验收记忆：喜欢骑车'));
  assert.ok(snapshot.reminders.some(x=>x.id===before.reminderId&&x.status==='pending'));
  assert.equal(snapshot.tools.find(x=>x.name==='calculate').enabled,false);
  assert.ok(c.conversations.get(before.sessionId).messages.length>=before.messages);
  fs.writeFileSync(path.join(out,'restart-validation.json'),JSON.stringify({ok:true,memory:true,reminder:true,toggle:true,history:true,externalChatRequests:0},null,2));return;
 }
 await ui("document.getElementById('historyDialog').close();document.getElementById('assistantOpen').click();true");await until(async()=>await ui("document.getElementById('assistantDialog').open&&document.getElementById('assistantClock').textContent.length>0"),'open assistant');
 assert.equal([...c.views.values()].some(x=>x.attached),false);
 await ui("document.getElementById('memoryText').value='<script>验收记忆</script>';document.getElementById('memoryForm').requestSubmit();true");await until(async()=>await ui("document.getElementById('memoryList').textContent.includes('验收记忆')"),'memory saved');assert.equal(await ui("document.querySelector('#memoryList script')===null"),true);
 await ui("document.querySelector('#memoryList button').click();true");await until(async()=>await ui("!document.getElementById('memoryEditCancel').hidden&&!document.getElementById('memoryText').disabled"),'edit memory');
 await ui("document.getElementById('memoryText').value='验收记忆：喜欢骑车';document.getElementById('memoryForm').requestSubmit();true");await until(async()=>await ui("document.getElementById('memoryList').textContent.includes('喜欢骑车')"),'edited saved');
 for(const theme of ['light','dark']){c.setTheme(theme);await delay(150);assert.equal(await ui("document.getElementById('assistantDialog').scrollWidth<=document.getElementById('assistantDialog').clientWidth"),true);fs.writeFileSync(path.join(out,'assistant-'+theme+'.png'),(await c.win.capturePage()).toPNG());}
 await ui("document.querySelector('[data-assistant-tab=reminders]').click();document.getElementById('reminderText').value='验收提醒';document.getElementById('reminderWhen').value='明天下午三点';document.getElementById('reminderForm').requestSubmit();true");await until(async()=>await ui("document.getElementById('reminderList').textContent.includes('验收提醒')"),'reminder saved');
 const cancelled=await action({type:'reminder-create',text:'取消验收',when:'半小时后'});assert.equal((await action({type:'reminder-cancel',id:cancelled.result.id})).ok,true);
 await ui("document.getElementById('assistantDialog').close();true");
 const independent=await c.historyAction({type:'new'});assert.equal((await c.historyAction({type:'resume',id:independent.session.id})).ok,true);
 async function send(text){const id=await chat('sessionId'),before=c.conversations.get(id).messages.length;await chat("open();document.getElementById('message').value="+JSON.stringify(text)+";document.getElementById('composer').requestSubmit();true");await until(()=>c.conversations.get(id).messages.length>=before+2&&c.conversations.get(id).messages.at(-1).role==='assistant','saved reply');await until(async()=>await chat("!pending&&document.getElementById('bubble').dataset.kind!=='pending'"),'reply');return chat("document.getElementById('reply').textContent");}
 assert.match(await send('现在几点？'),/星期/);assert.match(await send('6*7'),/42/);assert.match(await send('记住：验收偏好是清淡饮食'),/记住了/);
 assert.equal(await chat('expanded&&composing'),true);
 const original=c.appSettings.get();let requests=[];
 const server=http.createServer((req,res)=>{let raw='';req.on('data',x=>raw+=x);req.on('end',()=>{const body=JSON.parse(raw);requests.push(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:body.messages.some(x=>x.role==='tool')?{content:'验收计算结果是81。'}:{content:null,tool_calls:[{id:'native1',type:'function',function:{name:'calculate',arguments:'{"expression":"9*9"}'}}]}}]}));});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{c.appSettings.save({...original,endpoint:'http://127.0.0.1:'+server.address().port,model:'agent-fixture',speechEnabled:false});assert.equal(await send('帮我执行计算工具验收'),'验收计算结果是81。');assert.equal(requests.length,2);assert.equal(JSON.parse(requests[1].messages.at(-1).content).result.result,81);assert.ok(requests[0].messages[0].content.includes('清淡饮食'));}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));c.appSettings.save(original);}
 await action({type:'tool-toggle',name:'calculate',enabled:false});const saved=(await action({type:'snapshot'})).result;const id=await chat('sessionId');
 fs.writeFileSync(marker,JSON.stringify({memoryId:saved.memories.find(x=>x.text==='验收记忆：喜欢骑车').id,reminderId:saved.reminders.find(x=>x.text==='验收提醒').id,sessionId:id,messages:c.conversations.get(id).messages.length}));
 fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify({ok:true,packaged:c.app.isPackaged,tests:['native modal above studio','memory save/edit/text escaping','light and dark layout','reminder create and cancel','clock without API','offline arithmetic','explicit chat memory','tool loop from actual chat renderer','memory prompt context','persistent toggles','restart fixture'],externalChatRequests:0,externalTtsRequests:0,mockRequests:requests.length},null,2));
};
