const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process');
const {voiceLaunch}=require('./voice-launch.cjs');
const {createVariantSpeech}=require('./chat/variant-speech.cjs');
const {extractPackage,safeRelative,readHeader,validateHeader}=require('../console/src/package-format.cjs');
function localFile(base,name){safeRelative(name);const file=path.resolve(base,...name.split('/'));if(!file.startsWith(path.resolve(base)+path.sep))throw Error('语音组件路径无效。');return file;}
function assertNoLinks(target){for(let part=path.resolve(target);;part=path.dirname(part)){if(fs.existsSync(part)&&fs.lstatSync(part).isSymbolicLink())throw Error('组件目录及父目录不能是链接。');if(part===path.dirname(part))break;}}
function component(base){
 const meta=JSON.parse(fs.readFileSync(path.join(base,'voice-component.json'),'utf8'));
 if(meta.schemaVersion!==1||meta.id!=='shiroko-voice'||meta.platform!=='windows-x64')throw Error('语音组件清单无效。');
 for(const key of ['python','script','config'])if(!fs.statSync(localFile(base,meta[key])).isFile())throw Error('语音组件不完整。');
 const voices=JSON.parse(fs.readFileSync(path.join(base,'voices.json'),'utf8'));
 for(const key of ['default','terror']){if(!voices[key])throw Error('语音组件缺少音色。');for(const field of ['gpt_weights','sovits_weights','ref_audio_path']){voices[key][field]=localFile(base,voices[key][field]);if(!fs.statSync(voices[key][field]).isFile())throw Error('语音组件缺少模型或参考音频。');}}
 return {meta,voices};
}
function createLegacyServices({directory,settings}){
 let child=null,speech=null,speechKey='',activeVariant='default',installing=false,lastError='',progress=0,startPending,initialVariant=null,generation=0,runtimeDevice='cpu',serviceReady=false;
 let preferredVariant=()=> 'default';
 let cpuFallback=false;
 const voiceKey=value=>value==='terror'?'terror':'default';
 const root=()=>settings.get().voiceDirectory||path.join(directory,'voice-component');
 function status(){let installed=false;try{component(root());installed=true;}catch{}return {installed,running:Boolean(child&&child.exitCode===null),installing,progress,directory:root(),lastError,device:runtimeDevice};}
 async function probe(){const url=new URL(settings.get().speechEndpoint);url.pathname='/openapi.json';return new Promise(resolve=>{const req=http.get(url,{timeout:2000},res=>{res.resume();resolve(res.statusCode===200);});req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false);});});}
 function stop(){generation++;startPending=null;const previous=child;child=null;initialVariant=null;runtimeDevice='cpu';serviceReady=false;cpuFallback=false;if(previous&&previous.exitCode===null)previous.kill();speech=null;speechKey='';}
 async function start(variant='default'){
  if(startPending)return startPending;
  const startedGeneration=generation;
  startPending=(async()=>{const available=await probe();if(startedGeneration!==generation)throw Error('语音配置已更改，请重试。');if(available)return {ok:true,message:'本地语音服务已就绪。'};if(child&&child.exitCode===null)return {ok:true,message:'语音组件正在加载，请稍后检查。'};
   const base=root(),{meta,voices}=component(base),selected=voiceKey(variant),endpoint=new URL(settings.get().speechEndpoint);fs.mkdirSync(directory,{recursive:true});
   const config=localFile(base,meta.config);
   fs.writeFileSync(config,'custom:\n  bert_base_path: GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large\n  cnhuhbert_base_path: GPT_SoVITS/pretrained_models/chinese-hubert-base\n  device: cpu\n  is_half: false\n  version: v2ProPlus\n  t2s_weights_path: '+JSON.stringify(voices[selected].gpt_weights)+'\n  vits_weights_path: '+JSON.stringify(voices[selected].sovits_weights)+'\n');
   const python=localFile(base,meta.python),env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HOME:path.join(directory,'model-cache'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'};for(const name of ['VIRTUAL_ENV','PYTHONHOME','PYTHONPATH','PYTHONSTARTUP'])delete env[name];
   env.PATH=path.dirname(python)+path.delimiter+(env.PATH||'');
   function launch(forceCpu=false){
    if(forceCpu){const yaml=fs.readFileSync(config,'utf8').replace(/device: cuda/g,'device: cpu').replace(/is_half: true/g,'is_half: false');fs.writeFileSync(config,yaml);}
    const plan=voiceLaunch({base,script:localFile(base,meta.script),config,port:endpoint.port||'9880',forceCpu});
    const log=fs.createWriteStream(path.join(directory,'voice-service.log'),{flags:'a'});
    const launched=spawn(python,plan.args,{cwd:base,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child=launched;initialVariant=selected;speech=null;speechKey='';lastError='';serviceReady=false;runtimeDevice=plan.accelerated?'auto':'cpu';
    launched.stdout.pipe(log,{end:false});launched.stderr.pipe(log,{end:false});
    let output='';launched.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-1024);if(child!==launched)return;if(output.includes('SHIROKO_DEVICE=cuda'))runtimeDevice='cuda';else if(output.includes('SHIROKO_DEVICE=cpu'))runtimeDevice='cpu';});
    let handled=false;function ended(code,error){if(handled)return;handled=true;if(child===launched){child=null;initialVariant=null;speech=null;speechKey='';serviceReady=false;log.write('Voice process exited: code='+String(code)+(code==null?'':' (0x'+(code>>>0).toString(16)+')')+(error?' error='+error.message:'')+'\n');if(plan.accelerated&&startedGeneration===generation){cpuFallback=true;log.write('GPU voice service failed; retrying with original CPU runtime.\n');try{launch(true);}catch(failure){lastError='语音组件启动失败：'+failure.message;}}else lastError=error?'语音组件启动失败：'+error.message:'语音组件已退出，可打开日志查看原因。';}log.end();}
    launched.once('error',error=>ended(1,error));launched.once('exit',code=>ended(code));
   }
   launch(cpuFallback);
   return {ok:true,message:'正在后台加载音色，首次准备需要一些时间。'};
  })();const pending=startPending;try{return await pending;}finally{if(startPending===pending)startPending=null;}
 }
 async function ready(signal,variant){signal?.throwIfAborted();const current=generation;await start(variant);const end=Date.now()+115000;while(Date.now()<end){signal?.throwIfAborted();if(current!==generation)throw Error('语音配置已更改，请重试。');if(await probe()){if(current!==generation)throw Error('语音配置已更改，请重试。');serviceReady=true;return;}if(lastError)throw Error(lastError);await new Promise(r=>setTimeout(r,750));}throw Error('语音模型仍未就绪，请查看日志后重试。');}
 async function install(file,destination){
  if(installing)throw Error('语音组件正在安装。');
  const target=path.resolve(destination||root());if(target===path.parse(target).root)throw Error('请选择组件安装目录。');assertNoLinks(target);
  if(fs.existsSync(target)){if(fs.lstatSync(target).isSymbolicLink())throw Error('组件目录不能是链接。');component(target);}
  installing=true;try{return await performInstall(file,target);}finally{installing=false;}
 }
 async function performInstall(file,target){
  const {header}=await readHeader(file),total=validateHeader(header,{type:'voice',id:'shiroko-voice',platform:'windows-x64'});
  fs.mkdirSync(path.dirname(target),{recursive:true});const space=fs.statfsSync(path.dirname(target));if(space.bavail*space.bsize<total+256*1024**2)throw Error('该磁盘剩余空间不足，请选择其他磁盘。');
  installing=true;progress=0;lastError='';stop();const stage=target+'.stage-'+Date.now(),backup=target+'.previous-'+Date.now();let moved=false,committed=false,saved=false;
  try{await extractPackage(file,stage,{type:'voice',id:'shiroko-voice',platform:'windows-x64'},{onProgress:(done,size)=>progress=Math.floor(done/size*100)});component(stage);if(fs.existsSync(target)){await fs.promises.rename(target,backup);moved=true;}await fs.promises.rename(stage,target);committed=true;settings.save({...settings.get(),voiceDirectory:target,speechEngine:'legacy',speechEndpoint:settings.get().speechEngine==='gsv'?'http://127.0.0.1:9880/tts':settings.get().speechEndpoint});saved=true;if(moved)await fs.promises.rm(backup,{recursive:true,force:true}).catch(()=>{});return {ok:true,message:'白子与黑子音色组件已安装，可以启动。'};}
  catch(error){if(committed&&!saved)await fs.promises.rm(target,{recursive:true,force:true});if(moved&&!saved)await fs.promises.rename(backup,target);lastError=error.message;throw error;}finally{installing=false;await fs.promises.rm(stage,{recursive:true,force:true});}
 }
 async function client(getVariant,signal){const config=settings.get(),variant=voiceKey(getVariant());await ready(signal,variant);activeVariant=variant;const key=config.speechEndpoint+'|'+root();if(key!==speechKey){const {voices}=component(root());speech=createVariantSpeech({endpoint:config.speechEndpoint,variants:voices,getVariant:()=>activeVariant,initialVariant:child&&child.exitCode===null?initialVariant:null});speechKey=key;}return {speech,variant,owner:child,device:runtimeDevice,generation};}
 async function withRecovery(getVariant,signal,run){
  const prepared=await client(getVariant,signal);
  try{return await run(prepared.speech);}catch(error){
   signal?.throwIfAborted();
   if(prepared.generation!==generation||!prepared.owner||!['ECONNRESET','ECONNREFUSED','EPIPE','ECUDA'].includes(error.code))throw error;
   const cudaFailure=error.code==='ECUDA';
   if(cudaFailure){
    if(prepared.device!=='cuda')throw error;
    if(child===prepared.owner&&child.exitCode===null){
     fs.appendFileSync(path.join(directory,'voice-service.log'),'GPU synthesis failed (ECUDA); restarting with original CPU runtime.\n');
     cpuFallback=true;
     prepared.owner.kill();
    }
   }
   // Windows can report the broken socket before the Python exit event arrives.
   // A slow health check alone must never terminate a live GPU process.
   if(child===prepared.owner)await new Promise(resolve=>{const owner=prepared.owner;const done=()=>{clearTimeout(timer);owner.removeListener('exit',done);owner.removeListener('error',done);signal?.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,cudaFailure?3000:750);owner.once('exit',done);owner.once('error',done);signal?.addEventListener('abort',done,{once:true});});
   signal?.throwIfAborted();
   if(prepared.generation!==generation)throw error;
   // A single stale HTTP connection is retried without discarding a healthy model.
   if(child===prepared.owner&&child.exitCode===null){if(cudaFailure)throw error;return run(prepared.speech);}
   const recovered=await client(()=>prepared.variant,signal);
   return run(recovered.speech);
  }
 }
 function forVariant(getVariant){preferredVariant=getVariant;return {enabled:()=>settings.get().speechEnabled,async prepare(signal){if(!settings.get().speechEnabled)return {skipped:true};return withRecovery(getVariant,signal,async current=>{await current.prepare(signal);if(runtimeDevice==='cuda')await current.warmup('こんにちは、先生。',signal);});},async synthesize(text,signal){if(!settings.get().speechEnabled)throw Error('语音合成未开启。');return withRecovery(getVariant,signal,current=>current.synthesize(text,signal));}};}
 function warmup(){return forVariant(preferredVariant).prepare();}
 return {status,probe,start,stop,install,forVariant,warmup,dispose:stop};
}
function createServices(options){
 const {createGsvServices,usesGsv}=require('./gsv-runtime.cjs'),legacy=createLegacyServices(options),gsv=createGsvServices(options);
 const current=()=>usesGsv(options.settings.get())?gsv:legacy;
 return {status:()=>current().status(),probe:()=>current().probe(),start:(...args)=>current().start(...args),stop(){legacy.stop();return gsv.stop();},install:(...args)=>legacy.install(...args),warmup:()=>current().warmup(),forVariant(getVariant){return {enabled:()=>current().forVariant(getVariant).enabled(),prepare:signal=>current().forVariant(getVariant).prepare(signal),synthesize:(text,signal)=>current().forVariant(getVariant).synthesize(text,signal)};},dispose(){legacy.dispose();return gsv.dispose();}};
}
module.exports={createServices,component,localFile,assertNoLinks};
