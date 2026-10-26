const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
// Microphone access exists only for one explicit request; cancellation kills its owner process.
function recognize({signal,onReady=()=>{},probe=false,launch=spawn,platform=process.platform}={}){
 if(platform!=='win32')return Promise.reject(Error('当前离线语音输入仅支持 Windows。'));
 if(signal?.aborted)return Promise.reject(Error('语音输入已取消。'));
 const script=path.join(__dirname,'dictation.ps1');
 return new Promise((resolve,reject)=>{
  let settled=false,buffer='',bytes=0,result,timer;
  const source=fs.readFileSync(script,'utf8').replace('param([switch]$Probe)',probe?'$Probe=$true':'$Probe=$false');
  const child=launch('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);child.kill();error?reject(error):resolve(value);}
  const abort=()=>finish(Error('语音输入已取消。'));
  timer=setTimeout(()=>finish(Error('语音输入超时，请重试。')),30000);
  signal?.addEventListener('abort',abort,{once:true});
  child.once('error',error=>finish(Error(`无法启动 Windows 语音输入：${error?.message||'PowerShell 启动失败'}`)));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>32768){finish(Error('语音输入返回内容异常。'));return;}buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim().replace(/^\uFEFF/,'');buffer=buffer.slice(at+1);if(!line)continue;try{const v=JSON.parse(line);if(v.ready)onReady();else if(v.ok===false)finish(Error(String(v.error||'没有听清，请重试。').slice(0,300)));else if(v.ok===true)result=v;}catch{finish(Error('语音输入返回内容异常。'));}}});
  let stderr='';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr+=chunk.slice(0,4096);});
  child.once('close',(code)=>{
    if(probe&&result?.ok) return finish(null,{culture:result.culture});
    if(result?.ok&&typeof result.text==='string'&&result.text.trim()) return finish(null,{text:result.text.trim().slice(0,6000),...(Number.isFinite(result.confidence)&&result.confidence<0.25?{uncertain:true}:{})});
    const detail=stderr.replace(/\s+/g,' ').trim();
    finish(Error(detail ? `语音输入失败：${detail.slice(0,240)}` : (code ? '语音输入进程异常退出，请检查 Windows 麦克风权限。' : '没有识别到语音。请确认麦克风未静音，并在“正在听”后说话。')));
  });
 });
}
module.exports={recognize};
