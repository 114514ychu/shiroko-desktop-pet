const http = require('node:http');

function request(endpoint, route, {token, body, signal, timeoutMs=180000}={}) {
  return new Promise((resolve,reject)=>{
    let req,response,settled=false;
    function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error){req?.destroy();response?.destroy();reject(error);}else resolve(value);}
    const abort=()=>finish(Object.assign(Error('语音已取消。'),{name:'AbortError'}));
    const timer=setTimeout(()=>finish(Object.assign(Error('本地语音合成超时。'),{code:'ETIMEDOUT'})),timeoutMs);
    if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
    const data=body===undefined?null:Buffer.from(JSON.stringify(body));
    req=http.request(new URL(route,endpoint),{method:data?'POST':'GET',headers:{'X-Local-Token':token,...(data?{'Content-Type':'application/json','Content-Length':data.length}:{})}},res=>{
      response=res;let length=0;const chunks=[];
      res.on('data',chunk=>{length+=chunk.length;if(length>16*1024*1024){finish(Error('合成音频过大。'));return;}chunks.push(chunk);});
      res.on('end',()=>{const data=Buffer.concat(chunks);if(res.statusCode!==200){let detail={};try{detail=JSON.parse(data);}catch{}finish(Object.assign(Error(detail.error||('语音服务返回 HTTP '+res.statusCode)),{code:detail.code||'EGSV'}));}else finish(null,data);});
      res.on('aborted',()=>finish(Object.assign(Error('语音传输中断。'),{code:'ECONNRESET'})));res.on('error',finish);
    });
    req.on('error',finish);req.end(data);
  });
}

function createGsvSpeech({endpoint,token}){
  const target=new URL(endpoint);
  if(target.protocol!=='http:'||!['127.0.0.1','localhost'].includes(target.hostname)||target.username||target.password)throw Error('语音地址须为本机 HTTP 服务。');
  return {
    async health(signal){return JSON.parse(await request(target,'/health',{token,signal,timeoutMs:2000}));},
    async prepare(variant,signal){return JSON.parse(await request(target,'/prepare',{token,body:{variant},signal}));},
    async synthesize(text,variant,signal){
      if(typeof text!=='string'||!text.trim()||text.length>6000)throw Error('语音文字为空或过长。');
      // Keep kanji-only Japanese as Japanese; route Latin-only speech to English.
      const language=/[a-z]/i.test(text)&&!/[\u3040-\u30ff\u3400-\u9fff]/.test(text)?'en':'ja';
      const audio=await request(target,'/synthesize',{token,body:{text:text.trim(),variant,language},signal});
      if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw Error('GSV 未返回有效 WAV 音频。');
      return {mime:'audio/wav',audioBase64:audio.toString('base64')};
    }
  };
}
module.exports={createGsvSpeech};
