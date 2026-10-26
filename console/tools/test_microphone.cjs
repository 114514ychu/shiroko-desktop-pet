const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BrowserWindow}=require('electron'),{spawn}=require('node:child_process');
const {createPetChatOverlay}=require('../../shared/chat/overlay.cjs');
const {createLocalDictation}=require('../../shared/chat/local-dictation.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=90000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await check())return;await delay(50);}throw Error('Timed out: '+label);}
function pcm16(file){
 const wav=fs.readFileSync(file);let format,data;
 for(let at=12;at+8<=wav.length;){const id=wav.toString('ascii',at,at+4),size=wav.readUInt32LE(at+4),start=at+8;if(id==='fmt ')format={tag:wav.readUInt16LE(start),channels:wav.readUInt16LE(start+2),rate:wav.readUInt32LE(start+4),bits:wav.readUInt16LE(start+14)};if(id==='data')data=wav.subarray(start,start+size);at=start+size+(size&1);}
 assert.equal(format?.tag,1);assert.equal(format.channels,1);assert.equal(format.bits,16);assert.ok(data);
 const out=Buffer.alloc(Math.floor(data.length/2*16000/format.rate)*2);
 for(let i=0;i<out.length/2;i++){const at=i*format.rate/16000,left=Math.floor(at),fraction=at-left,a=data.readInt16LE(left*2),b=data.readInt16LE(Math.min(left+1,data.length/2-1)*2);out.writeInt16LE(Math.round(a+(b-a)*fraction),i*2);}
 return out.toString('base64');
}
exports.run=async(c,runtime,out)=>{
 const option=name=>process.argv.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
 const directory=option('--test-voice-directory'),fixture=option('--test-asr-fixture');assert.ok(directory&&fixture,'explicit local ASR component and synthetic fixture required');
 if(process.argv.includes('--test-microphone-live')){
  const original=c.appSettings.get(),window=runtime.chatWindow(),js=source=>window.webContents.executeJavaScript(source);
  c.appSettings.save({...original,voiceDirectory:directory});
  try{
   await js("open();document.getElementById('message').value='';voiceStatus('麦克风测试：请点“麦”，看到正在听后说：你好，今天星期几');true");
   console.log('LIVE_MIC_WAITING');
   await until(async()=>await js('listening'),'user starts microphone',180000);
   await until(async()=>await js("!listening||microphonePhase==='recording'"),'live microphone ready',100000);
   console.log('LIVE_MIC_RECORDING');
   await until(async()=>await js('!listening'),'live microphone returns',80000);
   const result=await js("({text:document.getElementById('message').value,status:document.getElementById('voiceStatus').textContent,chatOpen:expanded&&composing})");
   fs.writeFileSync(path.join(out,'microphone-live-validation.json'),JSON.stringify({audioSaved:false,...result},null,2));
   console.log('LIVE_MIC_RESULT '+JSON.stringify(result));
  }finally{c.appSettings.save(original);}
  return;
 }
 const audio=pcm16(fixture),captures=[],children=[];
 const service=createLocalDictation({directory:c.APP_PATHS.root,settings:{get:()=>({voiceDirectory:process.argv.includes('--test-asr-autodiscovery')?'':directory})},idleMs:1000,launch(...args){if(process.argv.includes('--test-asr-autodiscovery'))assert.ok(path.resolve(args[0]).startsWith(path.join(path.dirname(process.execPath),'voice-component')+path.sep),'ASR must use the bundled runtime');const child=spawn(...args);children.push(child);return child;},capture(options){
  captures.push(options);return new Promise((resolve,reject)=>{
   const cleanup=()=>{options.signal.removeEventListener('abort',cancel);options.finishSignal.removeEventListener('abort',finish);};
   const cancel=()=>{cleanup();reject(Error('语音输入已取消。'));},finish=()=>{cleanup();resolve(audio);};
   options.signal.addEventListener('abort',cancel,{once:true});options.finishSignal.addEventListener('abort',finish,{once:true});options.onReady({canFinish:true});
  });
 }});
 const pet=new BrowserWindow({show:true,width:100,height:100,opacity:0,skipTaskbar:true,webPreferences:{sandbox:true}});
 const overlay=createPetChatOverlay({pet,name:'白子',getOutfit:()=> 'default',stopVoice(){},dataDirectory:c.APP_PATHS.root,dictation:service.recognize,chatService:{status:()=>({configured:false}),send(){throw Error('microphone must not send chat automatically');}}});
 const js=source=>overlay.window().webContents.executeJavaScript(source);
 try{
  await until(()=>!overlay.window().webContents.isLoading(),'microphone overlay loaded');await delay(200);
  await js("open();document.getElementById('message').value='原草稿';document.getElementById('microphone').click();true");
  await until(()=>captures.length===1,'real offline ASR startup');
  await until(async()=>await js("microphonePhase==='recording'&&document.getElementById('microphone').textContent==='完成'"),'ready microphone button');
  await js("document.getElementById('microphone').click();true");
  await until(async()=>await js("!listening&&document.getElementById('message').value.includes('你好，今天星期几')"),'real recognition result in draft');
  assert.equal(captures[0].signal.aborted,false);assert.equal(captures[0].finishSignal.aborted,true);
  const draft=await js("document.getElementById('message').value");assert.match(draft,/^原草稿 你好，今天星期几/);
  await js("document.getElementById('microphone').click();true");await until(()=>captures.length===2,'second microphone request');
  await js("document.getElementById('interrupt').click();true");await delay(200);
  assert.equal(captures[1].signal.aborted,true);assert.equal(await js("document.getElementById('message').value"),draft);
  assert.equal(await js('expanded&&composing&&!listening'),true);
  await until(()=>children.every(child=>child.exitCode!==null||child.signalCode!==null),'idle ASR worker released',15000);
  fs.writeFileSync(path.join(out,'microphone-validation.json'),JSON.stringify({ok:true,packaged:c.app.isPackaged,actualOfflineRecognition:true,syntheticAudio:true,microphoneOpened:false,audioSaved:false,finishedDraft:draft,cancelPreservesDraft:true,workerReleased:true,externalChatRequests:0},null,2));
  console.log('Microphone finish and native draft validation passed');
 }finally{overlay.dispose();pet.destroy();service.dispose();}
};
