const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {record}=require('./record.cjs');
const {recognize:windowsRecognize}=require('./dictation.cjs');

function createLocalDictation({directory,settings,launch=spawn,capture=record,legacy=windowsRecognize,idleMs=60000,executable=process.execPath}={}){
 let worker,loading,active,key='',nextId=0,disposed=false,idleTimer,using=0;
 function armIdle(){clearTimeout(idleTimer);if(disposed||using||loading||active||!worker)return;idleTimer=setTimeout(()=>{if(!using&&!loading&&!active)stop();else armIdle();},idleMs);idleTimer.unref?.();}
 function plan(){
  const bundled=fs.existsSync(path.join(path.dirname(executable),'portable.json'))?path.join(path.dirname(executable),'voice-component'):null;
  const candidates=[bundled,settings.get().voiceDirectory,path.join(directory,'voice-component'),path.join(path.dirname(executable),'voice-component'),path.join(path.dirname(executable),'ShirokoVoice')].filter(Boolean).map(value=>path.resolve(value));
  const base=candidates.find(value=>fs.existsSync(path.join(value,'asr-model','model.pt')));
  if(!base)return null;
  const meta=JSON.parse(fs.readFileSync(path.join(base,'voice-component.json'),'utf8'));
  const python=path.resolve(base,...String(meta.python).split('/'));
  if(!python.startsWith(base+path.sep)||!fs.statSync(python).isFile())throw Error('本地语音识别运行时不完整。');
  return {base,python,model:path.join(base,'asr-model')};
 }
 function stop(){
  clearTimeout(idleTimer);
  const previous=worker;worker=null;key='';
  if(previous){previous.fail(Error('语音识别服务已停止，请重试。'));previous.child.kill();}
 }
 async function prepare(){
  clearTimeout(idleTimer);
  if(disposed)throw Error('语音识别服务已关闭。');
  const p=plan();if(!p)return null;
  const selected=p.python+'|'+p.model;
  if(worker&&key===selected){armIdle();return worker.ready;}
  if(loading)return loading;
  stop();key=selected;
  const work=(async()=>{
   const temp=path.join(p.base,'asr-temp');fs.mkdirSync(temp,{recursive:true});
   const workerFile=path.join(temp,'asr-worker.py');
   fs.writeFileSync(workerFile,fs.readFileSync(path.join(__dirname,'asr-worker.py')));
   const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',MODELSCOPE_CACHE:path.join(p.base,'asr-cache'),HF_HOME:path.join(p.base,'asr-cache'),TEMP:temp,TMP:temp};
   for(const name of ['VIRTUAL_ENV','PYTHONHOME','PYTHONPATH','PYTHONSTARTUP'])delete env[name];
   env.PATH=path.dirname(p.python)+path.delimiter+(env.PATH||'');
   // Run the worker as a file so FunASR's registration layer can inspect the
   // tokenizer class. Python's -c mode has no source filename and torch's
   // package importer rejects inspect.getfile() during registration.
   const child=launch(p.python,['-u',workerFile,p.model],{cwd:p.base,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
   let resolveReady,rejectReady,settled=false,buffer='',errorTail='';
   const ready=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
   const state={child,ready,fail(error){if(!settled){settled=true;clearTimeout(timer);rejectReady(error);}if(active?.owner===state)active.finish(error);}};
   worker=state;
   const timer=setTimeout(()=>{state.fail(Error('首次加载语音识别模型超时，请重试。'));if(worker===state){worker=null;key='';}child.kill();},90000);
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
   child.stderr.on('data',chunk=>{errorTail=(errorTail+chunk).slice(-1000);});
   child.stdout.on('data',chunk=>{
    buffer+=chunk;if(buffer.length>65536){state.fail(Error('语音识别返回内容异常。'));child.kill();return;}
    let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!line)continue;
     let value;try{value=JSON.parse(line);}catch{state.fail(Error('语音识别返回内容异常。'));child.kill();return;}
     if(value.ready&&!settled){settled=true;clearTimeout(timer);resolveReady(state);}
     else if(!settled&&value.error)state.fail(Error(value.error+(process.env.PET_ASR_DEBUG&&errorTail?'\n'+errorTail:'')));
     else if(active?.owner===state&&value.id===active.id){
      if(value.error)active.finish(Error(value.error));
      else if(typeof value.text==='string'&&value.text.trim())active.finish(null,{text:value.text.trim().slice(0,6000)});
      else active.finish(Error('没有识别到清晰语音，请靠近麦克风并减少旁边的人声后重试。'));
     }
    }
   });
   child.once('error',()=>state.fail(Error('无法启动本地语音识别，请检查语音组件。')));
   child.once('close',()=>{state.fail(Error('本地语音识别服务异常退出，请重试。'));if(worker===state){worker=null;key='';}});
   return ready;
  })();loading=work;try{return await work;}finally{if(loading===work)loading=null;armIdle();}
 }
 async function transcribe(audio,{signal}={}){
  signal?.throwIfAborted();const owner=await prepare();signal?.throwIfAborted();
  if(!owner)throw Error('尚未安装本地中文语音识别模型。');
  if(active)throw Error('上一条语音仍在识别，请稍后重试。');
  if(typeof audio!=='string'||audio.length>900000)throw Error('录音长度无效。');
  return new Promise((resolve,reject)=>{
   const id=++nextId;let settled=false;
   const abort=()=>finish(Error('语音输入已取消。'));
   const timer=setTimeout(()=>finish(Error('语音识别超时，请分句说话后重试。')),45000);
   function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(active?.id===id)active=null;armIdle();error?reject(error):resolve(value);}
   active={owner,id,finish};signal?.addEventListener('abort',abort,{once:true});
   owner.child.stdin.write(JSON.stringify({id,audio})+'\n',error=>{if(error)finish(Error('语音识别服务连接已断开，请重试。'));});
  });
 }
 async function recognize(options={}){
  if(!plan())return legacy(options);
  using++;clearTimeout(idleTimer);
  try{await prepare();options.signal?.throwIfAborted();
   const audio=await capture(options);options.signal?.throwIfAborted();
   options.onProcessing?.();
   return await transcribe(audio,options);
  }finally{using--;armIdle();}
 }
 recognize.prepare=prepare;
 return {recognize,prepare,transcribe,stop,dispose(){disposed=true;stop();}};
}
module.exports={createLocalDictation};
