const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await delay(30);}throw Error('Timed out: '+label);}
exports.run=async c=>{
  const out=path.join(c.QA,'standalone');fs.mkdirSync(out,{recursive:true});
  assert.equal(c.snapshot().roles.length,1);assert.equal(c.snapshot().codex.connected,false);
  const runtime=c.runtimes.get('sunaookami-shiroko');
  try{await until(()=>runtime?.snapshot().ready,'initial model');}catch(error){const wc=runtime.petWindow().webContents;let page;try{page=await wc.executeJavaScript("(async()=>({url:location.href,title:document.title,bridge:typeof kisakiDesktop,body:document.body.innerText.slice(0,6000),resources:performance.getEntriesByType('resource').map(r=>({name:r.name,bytes:r.transferSize})),initial:typeof kisakiDesktop==='object'?await kisakiDesktop.initial():null}))()");}catch(e){page={error:e.stack};}fs.writeFileSync(path.join(out,'startup-failure.json'),JSON.stringify({snapshot:runtime.snapshot(),page},null,2));throw error;}
  assert.equal(runtime.snapshot().visible,true);assert.equal(runtime.petWindow().isVisible(),true);
  assert.equal(c.chatService.status().configured,false);
  assert.ok(!c.APP_PATHS.root.startsWith(c.app.getAppPath()));
  if(process.argv.includes('--self-test-portable-only')){await require('./test_portable.cjs').run(c,runtime,out);return;}
  if(process.argv.includes('--self-test-companion-only')){await require('./test_companion.cjs').run(c,runtime);return;}
  if(process.argv.includes('--self-test-assistant-only')){await require('./test_assistant.cjs').run(c,runtime);return;}
  if(process.argv.includes('--self-test-conversations-only')){await require('./test_conversations.cjs').run(c,runtime);return;}
  if(process.argv.includes('--self-test-voice-only')){await require('./test_voice.cjs').run(c,runtime,out);return;}
  if(process.argv.includes('--self-test-microphone-only')){await require('./test_microphone.cjs').run(c,runtime,out);return;}
  runtime.petWindow().webContents.setAudioMuted(true);
  await require('./test_display_interaction.cjs').run(c,runtime);
  await require('./test_pointer_bubbles.cjs').run(c,runtime);
  runtime.command({name:'variant',value:'default'});await until(()=>runtime.snapshot().ready,'default restored');
  const win=c.openAppSettings();await until(()=>!win.webContents.isLoading(),'settings load');
  const js=script=>win.webContents.executeJavaScript(script);
  await until(async()=>await js("document.getElementById('endpoint').value.length>0"),'settings state');
  assert.equal(await js("document.getElementById('speechEnabled').checked"),false);
  for(const size of [[720,760],[600,560]]){win.setContentSize(...size);await delay(150);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);fs.writeFileSync(path.join(out,'settings-'+size.join('x')+'.png'),(await win.capturePage()).toPNG());}
  const original=c.appSettings.get();
  const invalid=await js("appSettings.invoke('save',{...Object.fromEntries(['endpoint','model','speechEndpoint','voiceDirectory','harnessExecutable','harnessHome'].map(k=>[k,document.getElementById(k).value])),endpoint:'http://example.org/v1'})");
  assert.equal(invalid.ok,false);assert.equal(c.appSettings.get().endpoint,original.endpoint);
  let requests=0;const server=http.createServer((req,res)=>{requests++;assert.equal(req.headers.authorization,undefined);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'连接成功'}}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const next={...original,endpoint:'http://127.0.0.1:'+server.address().port+'/v1',model:'local-test'};const saved=await js("appSettings.invoke('save',"+JSON.stringify(next)+")");assert.equal(saved.ok,true);assert.equal(c.appSettings.get().endpoint,next.endpoint+'/chat/completions');const tested=await js("appSettings.invoke('test-chat')");assert.equal(tested.ok,true);assert.ok(tested.message.includes('连接成功'));assert.equal(requests,1);assert.equal(require('../../shared/app-settings.cjs').createSettings(c.APP_PATHS.root).get().model,'local-test');
    const overlay=runtime.chatWindow(),chatJs=script=>overlay.webContents.executeJavaScript(script);
    await chatJs("open();document.getElementById('message').value='你好';document.getElementById('composer').requestSubmit();true");
    await until(async()=>await chatJs("!pending&&document.getElementById('reply').textContent==='连接成功'"),'native chat reply');
    await delay(16300);
    assert.equal(await chatJs('expanded&&composing&&!document.getElementById("composer").hidden'),true,'chat stays open past the former idle deadline');
    win.focus();await delay(200);
    assert.equal(await chatJs('expanded&&composing'),true,'focus loss keeps chat open');
    fs.writeFileSync(path.join(out,'persistent-chat.png'),(await overlay.capturePage()).toPNG());
    await chatJs("document.getElementById('panelClose').click();true");
    assert.equal(await chatJs('expanded||composing'),false,'user close still collapses chat');assert.equal(requests,2);
  }
  finally{await new Promise(r=>server.close(r));c.appSettings.save(original);}
  await require('./test_conversations.cjs').run(c,runtime);
  await require('./test_assistant.cjs').run(c,runtime);
  await require('./test_companion.cjs').run(c,runtime);
  if(process.argv.includes('--self-test-voice'))await require('./test_voice.cjs').run(c,runtime,out);
  await assert.rejects(c.packageManager.install('sunaookami-shiroko'),/随应用更新/);
  await assert.rejects(c.packageManager.remove('sunaookami-shiroko'),/随应用更新/);
  win.destroy();c.win.show();await delay(250);fs.writeFileSync(path.join(out,'application.png'),(await c.win.capturePage()).toPNG());
  const report={ok:true,at:new Date().toISOString(),packaged:c.app.isPackaged,version:c.app.getVersion(),application:c.app.getAppPath(),profile:c.APP_PATHS.root,variants:runtime.snapshot().variants.map(v=>v.id),tests:['fresh startup','four outfits','native GPU loss and reload recovery','click and held pickup with audio/subtitles','settings layouts','invalid endpoint rejection','local mock chat','chat persists past idle deadline and focus loss until manual close','configuration persistence','bundled resource protection'],mockChatRequests:requests,externalChatRequests:0,externalTtsRequests:0};
  fs.writeFileSync(path.join(out,'validation.json'),JSON.stringify(report,null,2));console.log('Standalone acceptance passed',JSON.stringify(report));
};
