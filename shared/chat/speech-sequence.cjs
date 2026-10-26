// Keep synthesis ahead of playback, with at most two completed WAVs in memory.
function splitSpeech(text, final=false, limit=100) {
 const parts=[];let rest=text;
 while(rest.length){
  let end=-1;
  for(let i=0;i<Math.min(rest.length,limit);i++){
   const c=rest[i];
   if(/[。！？!?\n]/.test(c)||(c==='.'&&i>0&&/\s/.test(rest[i+1]||'')&&!/\d/.test(rest[i-1]))){end=i+1;break;}
  }
  if(end<0&&rest.length>limit){
   end=limit;const head=rest.slice(0,limit),soft=Math.max(head.lastIndexOf('、'),head.lastIndexOf('，'),head.lastIndexOf(','),head.lastIndexOf(' '));
   if(soft>=20)end=soft+1;
   if(/[\uD800-\uDBFF]/.test(rest[end-1]))end--;
  }
  if(end<0){if(!final)break;end=rest.length;}
  const part=rest.slice(0,end).trim();if(part)parts.push(part);rest=rest.slice(end);
 }
 return {parts,rest};
}
function streamingReply(raw,japanese){
 if(!japanese)return {spoken:raw,primary:/[\u3040-\u30ff]/.test(raw)?'':raw};
 const spoken=/^\s*\[(ja|en)\]([^[]*)/i.exec(raw),zh=/\[zh\]([^[]*)/i.exec(raw);
 const valid=spoken&&(spoken[1].toLowerCase()==='en'||/[\u3040-\u30ff]/.test(spoken[2])||(/[a-z]/i.test(spoken[2])&&!/[\u3400-\u9fff]/.test(spoken[2])));
 return {spoken:valid?spoken[2].trim():'',primary:zh&&!/[\u3040-\u30ff]/.test(zh[1])?zh[1].trim():''};
}
function createSpeechSequence({synthesize,signal}){
 const active=new AbortController(),waiting=[],ready=[],listeners=new Set();
 let source='',rest='',final=false,running=false,failure=null,delivered=0,taking=false,disposed=false;
 const notify=()=>{for(const resolve of listeners)resolve();listeners.clear();};
 const abort=()=>{disposed=true;active.abort();waiting.length=ready.length=0;notify();};
 if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 const cleanup=()=>signal?.removeEventListener('abort',abort);
 async function pump(){
  if(running||disposed||failure)return;running=true;
  try{while(!disposed&&ready.length<2&&waiting.length){const text=waiting.shift();const audio=await synthesize(text,active.signal);if(!disposed){ready.push(audio);notify();}}}
  catch(error){failure=error;waiting.length=0;notify();}
  finally{running=false;notify();}
 }
 return {
  accepts:text=>typeof text==='string'&&text.startsWith(source),
  update(text,complete=false){
   if(disposed||final)return false;
   if(typeof text!=='string'||!text.startsWith(source))return false;
   rest+=text.slice(source.length);source=text;final=complete;
   const split=splitSpeech(rest,complete);rest=split.rest;waiting.push(...split.parts);notify();void pump();return true;
  },
  async next(index){
   if(!Number.isSafeInteger(index)||index!==delivered||taking)throw Error('语音片段顺序无效。');taking=true;
   try{for(;;){
    if(disposed||signal?.aborted)throw Error('语音已取消。');
    if(ready.length){const audio=ready.shift();delivered++;void pump();return {done:false,index,...audio};}
    if(failure)throw failure;
    if(final&&!running&&!waiting.length){cleanup();return {done:true,index};}
    await new Promise(resolve=>listeners.add(resolve));
   }}finally{taking=false;}
  },
  dispose(){abort();cleanup();}
 };
}
module.exports={splitSpeech,streamingReply,createSpeechSequence};
