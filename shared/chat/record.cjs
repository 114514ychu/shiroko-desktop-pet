const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
function record({signal,finishSignal,onReady=()=>{},launch=spawn}={}){
 if(signal?.aborted)return Promise.reject(Error('语音输入已取消。'));
 const cs=fs.readFileSync(path.join(__dirname,'record.cs'),'utf8');
 const script=`$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
Add-Type -TypeDefinition @'
${cs}
'@
$mic=New-Object PetMicrophone
$mic.ListenForFinish()
try {$audio=$mic.Record(); @{ok=$true;audio=[Convert]::ToBase64String($audio)} | ConvertTo-Json -Compress} finally {$mic.Dispose()}
} catch {@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress;exit 1}`;
 return new Promise((resolve,reject)=>{
  const child=launch('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let settled=false,buffer='',bytes=0,stderr='';
  const timer=setTimeout(()=>finish(Error('录音超时，请重试。')),26000);
  const abort=()=>finish(Error('语音输入已取消。'));
  const endRecording=()=>{if(!settled)child.stdin.write('finish\n',error=>{if(error)finish(Error('结束录音失败，请重试。'));});};
  function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);finishSignal?.removeEventListener('abort',endRecording);child.kill();error?reject(error):resolve(value);}
  signal?.addEventListener('abort',abort,{once:true});
  finishSignal?.addEventListener('abort',endRecording,{once:true});
  child.stdin.on('error',()=>finish(Error('录音程序连接已断开，请重试。')));
  if(finishSignal?.aborted)endRecording();
  child.once('error',()=>finish(Error('无法打开录音程序，请检查 Windows 麦克风权限。')));
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-1500);});
  child.stdout.on('data',chunk=>{
   bytes+=Buffer.byteLength(chunk);if(bytes>1200000)return finish(Error('录音内容过大，请分句说话。'));
   buffer+=chunk;let at;
   while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at).trim();buffer=buffer.slice(at+1);if(!line)continue;
    let value;try{value=JSON.parse(line);}catch{return finish(Error('录音返回内容异常。'));}
    if(value.ready)onReady({canFinish:true});
    else if(value.ok&&typeof value.audio==='string')return finish(null,value.audio);
    else if(value.ok===false){const message=String(value.error||'');return finish(Error(message.includes('no signal')?'麦克风没有收到声音，请检查耳机硬件静音和 Windows 录音设备。':message.includes('No clear speech')?'没有检测到清晰语音，请靠近麦克风后重试。':'录音失败，请检查麦克风是否被占用或禁止访问。'));}
   }
  });
  child.once('close',()=>finish(Error(stderr?'无法打开录音设备，请检查麦克风权限。':'录音未完成，请重试。')));
 });
}
module.exports={record};
