const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {createGsvSpeech}=require('./gsv-speech.cjs');

const bootstrap="import sys,runpy; sys.path.insert(0,sys.argv[1]); sys.path.insert(0,sys.argv[2]); sys.argv=sys.argv[3:]; runpy.run_path(sys.argv[0],run_name='__main__')";
function usesGsv(config){return config.speechEngine==='gsv'||(!config.speechEngine&&/\/synthesize\/?$/.test(config.speechEndpoint||''));}
function locate(config,directory,{executable=process.execPath,driveRoots}={}){
 const roots=driveRoots||[executable,directory,config.voiceDirectory,config.gsvDirectory].filter(Boolean).map(value=>path.parse(path.resolve(value)).root);
 const bundled=fs.existsSync(path.join(path.dirname(executable),'portable.json'))?path.join(path.dirname(executable),'GSV-TTS-Lite'):null;
 const candidates=[bundled,config.gsvDirectory,path.join(directory,'gsv-tts-lite'),path.join(path.dirname(executable),'GSV-TTS-Lite'),path.join(path.dirname(directory),'GSV-TTS-Lite'),...roots.map(root=>path.join(root,'GSV-TTS-Lite'))].filter(Boolean);
 for(const value of new Set(candidates)){try{const root=path.resolve(value);if(!fs.existsSync(path.join(root,'engine.py')))continue;
  const site=path.join(root,'.venv','Lib','site-packages');
  // Launch the actual interpreter, not the Windows venv redirector, so killing
  // the owned process also frees the model rather than orphaning a child.
  const pythonRoot=path.join(root,'python');
  if(!fs.existsSync(pythonRoot))continue;
  const entries=fs.readdirSync(pythonRoot,{withFileTypes:true});
  const python=entries.filter(entry=>entry.isDirectory()).concat(entries.filter(entry=>entry.isSymbolicLink())).map(entry=>path.join(pythonRoot,entry.name,'python.exe')).find(file=>fs.existsSync(file));
  if(python&&fs.existsSync(site))return {root,site,python};
 }catch{ /* A stale folder or broken runtime link must not hide a valid install. */ }
 }
 throw Error('找不到 GSV-TTS-Lite 运行环境，请在应用设置中选择它的文件夹。');
}
function createGsvServices({directory,settings,idleMs=300000,launch=spawn}={}){
 let owner=null,starting=null,stopping=Promise.resolve(),queue=Promise.resolve(),pending=0,idleTimer,generation=0,disposed=false,lastError='',device='auto',cpuFallback=false;
 const variant=value=>value==='terror'?'terror':'default';
 function status(){let installed=false,root='';try{root=locate(settings.get(),directory).root;installed=true;}catch{}return {installed,running:Boolean(owner&&owner.child.exitCode===null),installing:false,progress:0,directory:root,lastError,device,engine:'gsv',idleMinutes:idleMs/60000};}
 function cancelIdle(){clearTimeout(idleTimer);idleTimer=null;}
 function armIdle(){cancelIdle();if(disposed||pending||!owner)return;idleTimer=setTimeout(async()=>{const observed=owner;if(pending||!observed)return;try{const state=await observed.client.health();if(state.busy){armIdle();return;}}catch{}if(owner===observed&&!pending)await stop();},idleMs);idleTimer.unref?.();}
 function stop(){cancelIdle();generation++;starting=null;cpuFallback=false;lastError='';device='auto';const previous=owner;owner=null;if(previous){previous.intentional=true;previous.child.kill();stopping=previous.closed;}return stopping;}
 async function start(){
  if(disposed)throw Error('语音服务已关闭。');
  if(owner&&owner.child.exitCode===null&&owner.ready){armIdle();return {ok:true,message:'GSV 语音服务已就绪。'};}
  if(starting)return starting;
  const current=generation;
  const work=(async()=>{
   await stopping;if(current!==generation)throw Error('语音配置已更改，请重试。');
   const config=settings.get(),plan=locate(config,directory);fs.mkdirSync(directory,{recursive:true});
   if(config.gsvDirectory!==plan.root&&typeof settings.save==='function')settings.save({...config,gsvDirectory:plan.root});
   const workerFile=path.join(directory,'gsv-managed.py');fs.writeFileSync(workerFile,fs.readFileSync(path.join(__dirname,'gsv-managed.py')));
   const endpoint=new URL(settings.get().speechEndpoint||'http://127.0.0.1:9881/synthesize');
   if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost'].includes(endpoint.hostname))throw Error('语音地址须为本机 HTTP 服务。');
   const token=crypto.randomBytes(32).toString('hex'),env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',SHIROKO_GSV_TOKEN:token};
   for(const key of ['PYTHONHOME','PYTHONPATH','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[key];
   if(cpuFallback)env.CUDA_VISIBLE_DEVICES='-1';
   const args=['-u','-c',bootstrap,plan.site,plan.root,workerFile,'--port',endpoint.port||'9881','--device',cpuFallback?'cpu':'auto','--parent-pid',String(process.pid)];
   const child=launch(plan.python,args,{cwd:plan.root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
   const state={child,client:createGsvSpeech({endpoint:endpoint.href,token}),ready:false,intentional:false,forcedCpu:cpuFallback};
   owner=state;lastError='';device=cpuFallback?'cpu':'auto';
   const log=fs.createWriteStream(path.join(directory,'voice-service.log'),{flags:'a'});log.write('Starting GSV-TTS-Lite ('+(cpuFallback?'CPU fallback':'GPU preferred')+')\n');
   child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
   let output='';child.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-2048);if(owner!==state)return;const found=output.match(/GSV_DEVICE=(cuda|cpu)/g);if(found)device=found.at(-1).split('=')[1];});
   state.closed=new Promise(resolve=>{let ended=false;const finish=(code,error)=>{if(ended)return;ended=true;state.error=error;state.exitCode=code;if(owner===state)owner=null;if(!state.intentional){lastError='GSV 语音进程退出：'+(error?.message||code);log.write(lastError+'\n');}log.end();resolve();};child.once('error',error=>finish(null,error));child.once('exit',code=>finish(code));});
   const end=Date.now()+180000;
   while(Date.now()<end){if(current!==generation)throw Error('语音配置已更改，请重试。');if(owner!==state)throw Object.assign(Error(lastError||'GSV 启动失败。'),{code:'EGSVEXIT'});try{const health=await state.client.health();if(health.engine==='gsv-managed'){state.ready=true;armIdle();return {ok:true,message:'GSV 语音服务已就绪。'};}}catch{}await new Promise(r=>setTimeout(r,250));}
   state.intentional=true;child.kill();owner=null;await state.closed;throw Error('GSV 语音启动超时，请检查端口或查看日志。');
  })();starting=work;try{return await work;}finally{if(starting===work)starting=null;}
 }
 async function runOperation(operation,signal,current){
  let retry=false;
  while(true){signal?.throwIfAborted();if(current!==generation)throw Error('语音服务已停止。');let observed;
   try{await start();signal?.throwIfAborted();if(current!==generation)throw Error('语音服务已停止。');observed=owner;return await operation(observed.client);}
   catch(error){signal?.throwIfAborted();if(current!==generation||retry)throw error;
    // Windows may break the HTTP socket before reporting the process exit.
    if(observed&&['ECONNRESET','ECONNREFUSED','EPIPE'].includes(error.code))await Promise.race([observed.closed,new Promise(r=>setTimeout(r,300))]);
    signal?.throwIfAborted();if(current!==generation)throw error;
    const crashed=observed?owner!==observed:error.code==='EGSVEXIT';
    if(error.code==='ECUDA'||crashed){if(cpuFallback||observed?.forcedCpu)throw error;cpuFallback=true;if(observed&&owner===observed){owner=null;observed.intentional=true;observed.child.kill();await observed.closed;}}
    else if(!['ECONNRESET','ECONNREFUSED','EPIPE'].includes(error.code))throw error;
    retry=true;
   }
  }
 }
 function enqueue(operation,signal){const current=generation;pending++;cancelIdle();const work=queue.then(()=>runOperation(operation,signal,current));queue=work.catch(()=>{});return work.finally(()=>{pending--;armIdle();});}
 let preferredVariant=()=> 'default';
 function forVariant(getVariant){preferredVariant=getVariant;return {enabled:()=>settings.get().speechEnabled,prepare(signal){if(!settings.get().speechEnabled)return Promise.resolve({skipped:true});const selected=variant(getVariant());return enqueue(client=>client.prepare(selected,signal),signal);},synthesize(text,signal){if(!settings.get().speechEnabled)return Promise.reject(Error('语音合成未开启。'));const selected=variant(getVariant());return enqueue(client=>client.synthesize(text,selected,signal),signal);}};}
 async function probe(){if(!owner)return false;try{return (await owner.client.health()).engine==='gsv-managed';}catch{return false;}}
 return {status,start,stop,probe,forVariant,warmup:()=>forVariant(preferredVariant).prepare(),async install(){throw Error('请选择已安装的 GSV-TTS-Lite 文件夹。');},dispose(){disposed=true;return stop();}};
}
module.exports={createGsvServices,usesGsv,locate};
