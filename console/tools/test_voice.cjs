const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(50);}throw Error('Timed out: '+label);}
exports.run=async(c,runtime,out)=>{
 const gsvDirectory=process.argv.find(v=>v.startsWith('--test-gsv-directory='))?.slice(21);
 const directory=gsvDirectory||process.argv.find(v=>v.startsWith('--test-voice-directory='))?.slice(23);assert.ok(directory,'explicit test component required');
 const original=c.appSettings.get(),overlay=runtime.chatWindow(),evaluate=s=>overlay.webContents.executeJavaScript(s),audit=[];let requests=0,english=false;
 const autoDiscovery=Boolean(gsvDirectory&&process.argv.includes('--test-gsv-autodiscovery'));
 const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{
   requests++;assert.equal(req.headers.authorization,undefined);assert.ok(JSON.parse(body).messages[0].content.includes('[ja]'));assert.equal(JSON.parse(body).stream,true);
   res.setHeader('Content-Type','text/event-stream');
   const delta=text=>res.write('data: '+JSON.stringify({choices:[{delta:{content:text}}]})+'\r\n\r\n');
   if(english)assert.ok(JSON.parse(body).messages[0].content.includes('[en]'));
   delta(english?'[en]Hello, teacher. Have':'[ja]こんにちは、先生。');
   const middle=setTimeout(()=>delta(english?' a nice day![/en][zh]老师，你好。祝你今天愉快！[/zh]':'今日は海に行きましょう。[/ja][zh]老师，你好。今天去海边吧。[/zh]'),1000);
   const finish=setTimeout(()=>res.end('data: [DONE]\r\n\r\n'),1600);
   res.on('close',()=>{clearTimeout(middle);clearTimeout(finish);});
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  c.appSettings.save({...original,endpoint:'http://127.0.0.1:'+server.address().port+'/v1',speechEnabled:true,speechEngine:gsvDirectory?'gsv':'legacy',speechEndpoint:gsvDirectory?'http://127.0.0.1:19881/synthesize':'http://127.0.0.1:19881/tts',...(gsvDirectory?{gsvDirectory:autoDiscovery?'':gsvDirectory}:{voiceDirectory:directory})});
  if(autoDiscovery){
   const settingsWindow=c.openAppSettings(),js=source=>settingsWindow.webContents.executeJavaScript(source);
   await until(()=>!settingsWindow.webContents.isLoading(),'settings window');
   await until(async()=>await js("document.getElementById('speechEndpoint').value.includes('19881')"),'settings populated');
   assert.equal(await js("document.getElementById('gsvDirectory').value"),'');
   await js("document.getElementById('startVoice').click();true");
   await until(async()=>await js("document.getElementById('message').textContent.includes('音色已准备好')"),'one click GSV startup and preparation',180000);
   assert.equal(path.resolve(c.appSettings.get().gsvDirectory),path.resolve(gsvDirectory));
   assert.equal(c.services.status().running,true);
   assert.equal(await js("document.getElementById('gsvDirectory').value"),c.appSettings.get().gsvDirectory);
   fs.writeFileSync(path.join(out,'autostart-validation.json'),JSON.stringify({ok:true,startedWithBlankDirectory:true,clickedStart:true,discoveredDirectory:c.appSettings.get().gsvDirectory,device:c.services.status().device,preparedBeforeSuccess:true},null,2));
   fs.writeFileSync(path.join(out,'autostart-settings.png'),(await settingsWindow.capturePage()).toPNG());settingsWindow.destroy();
  }
  overlay.webContents.setAudioMuted(true);c.win.hide();
  for(const variant of ['default','terror']){
   runtime.command({name:'variant',value:variant});await until(()=>runtime.snapshot().ready&&runtime.snapshot().config.variant===variant,variant);await delay(300);
   const preparing=Date.now();await c.services.warmup();const prepareMs=Date.now()-preparing,device=c.services.status().device;
   await evaluate("close();window.nativeSpeechAudit=[];window.nativeSpeechStart=performance.now();var OriginalAudio=window.NativeSpeechOriginalAudio||Audio;window.NativeSpeechOriginalAudio=OriginalAudio;window.Audio=function(...args){const a=new OriginalAudio(...args);a.addEventListener('playing',()=>nativeSpeechAudit.push({kind:'playing',atMs:Math.round(performance.now()-nativeSpeechStart),duration:a.duration,subtitle:document.getElementById('reply').textContent}));a.addEventListener('ended',()=>nativeSpeechAudit.push({kind:'ended',atMs:Math.round(performance.now()-nativeSpeechStart)}));return a;};open();document.getElementById('message').value='早上好';document.getElementById('composer').requestSubmit();true");
   try{await until(async()=>await evaluate("nativeSpeechAudit.some(v=>v.kind==='playing')"),'native '+variant+' synthesis and playback',240000);}catch(error){fs.writeFileSync(path.join(out,'voice-failure.json'),JSON.stringify(await evaluate("({text:document.body.innerText,composing,pending,speechActive,context,sequence,speechSequence,events:nativeSpeechAudit})"),null,2));throw error;}
   await until(async()=>await evaluate("document.getElementById('reply').textContent==='老师，你好。今天去海边吧。'"),'subtitle during playback');const result=await evaluate('nativeSpeechAudit');assert.ok(result[0].duration>0.1);fs.writeFileSync(path.join(out,'voice-'+variant+'.png'),(await overlay.capturePage()).toPNG());
   await until(async()=>await evaluate("nativeSpeechAudit.filter(v=>v.kind==='ended').length===2&&!speechActive"),'both audio sentences complete',60000);
   const events=await evaluate('nativeSpeechAudit');assert.deepEqual(events.map(v=>v.kind),['playing','ended','playing','ended']);audit.push({variant,device,prepareMs,firstAudioMs:events[0].atMs,gapMs:events[2].atMs-events[1].atMs,events});
  }
  await evaluate("open();document.getElementById('message').value='取消测试';document.getElementById('composer').requestSubmit();true");await until(async()=>await evaluate("nativeSpeechAudit.filter(v=>v.kind==='playing').length===3"),'cancelled reply starts playing');await evaluate('close();true');await delay(3000);assert.equal(await evaluate("nativeSpeechAudit.filter(v=>v.kind==='playing').length"),3);assert.equal(await evaluate('speechActive||pending'),false);
  if(process.argv.includes('--test-english-speech')){
   english=true;const before=requests;
   await evaluate("window.nativeSpeechAudit=[];window.nativeSpeechStart=performance.now();open();document.getElementById('message').value='请用英文说：老师你好，祝你今天愉快';document.getElementById('composer').requestSubmit();true");
   await until(async()=>await evaluate("nativeSpeechAudit.filter(v=>v.kind==='ended').length===2&&!speechActive"),'English synthesis and playback',180000);
   const events=await evaluate('nativeSpeechAudit');assert.equal(requests-before,1,'English reply must not trigger a Japanese translation request');assert.equal(await evaluate("document.getElementById('reply').textContent"),'老师，你好。祝你今天愉快！');
   fs.writeFileSync(path.join(out,'english-playback-validation.json'),JSON.stringify({ok:true,spoken:'Hello, teacher. Have a nice day!',events,chatRequests:requests-before,noJapaneseTranslation:true,device:c.services.status().device},null,2));
  }
  assert.equal(c.services.status().running,true);fs.writeFileSync(path.join(out,'voice-validation.json'),JSON.stringify({ok:true,at:new Date().toISOString(),directory,audit,cancelledReplyStayedSilent:true,mockChatRequests:requests,externalChatRequests:0,externalTtsRequests:0},null,2));console.log('Native retained voice playback passed',JSON.stringify(audit));
 }finally{c.services.stop();c.appSettings.save(original);await new Promise(r=>server.close(r));}
};
