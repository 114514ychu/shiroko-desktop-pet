const {StringDecoder}=require('node:string_decoder');
function createSseReply(onText,{message=false,onToolStart}={}){
 const decoder=new StringDecoder('utf8');let buffer='',reply='',complete=false,started=false;const calls=[];
 function event(block){
  if(complete)return;
  const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data)return;if(data.trim()==='[DONE]'){complete=true;return;}
  let value;try{value=JSON.parse(data);}catch{throw Error('流式回复格式无法识别，请重试。');}
  if(value.error)throw Error('聊天服务返回错误，请稍后重试。');
  const choice=value.choices?.[0],text=choice?.delta?.content;
  for(const part of choice?.delta?.tool_calls||[]){
   if(!message)throw Error('该请求不支持工具调用。');
   if(!Number.isInteger(part.index)||part.index<0||part.index>=8)throw Error('工具调用数量超出限制。');
   if(!started){started=true;onToolStart?.();}
   const call=calls[part.index]||={id:'',type:'function',function:{name:'',arguments:''}};
   if(part.id)call.id+=part.id;
   if(part.function?.name)call.function.name+=part.function.name;
   if(part.function?.arguments)call.function.arguments+=part.function.arguments;
   if(call.id.length>200||call.function.name.length>100||call.function.arguments.length>4000)throw Error('工具参数过长。');
  }
  if(typeof text==='string'&&text){reply=(reply+text).slice(0,6000);if(!started)onText?.(reply);}
  if(choice?.finish_reason)complete=true;
 }
 function process(text){buffer+=text;let boundary;while((boundary=/\r?\n\r?\n/.exec(buffer))){event(buffer.slice(0,boundary.index).replace(/\r\n/g,'\n'));buffer=buffer.slice(boundary.index+boundary[0].length);}}
 return {write:chunk=>process(decoder.write(chunk)),end(){process(decoder.end());if(buffer.trim())event(buffer);if(!complete)throw Error('流式回复连接中断，请重试。');if(!reply.trim()&&!calls.length)throw Error('暂时没有生成回复，请重试。');return message?{role:'assistant',content:reply.trim()||null,...(calls.length?{tool_calls:calls}:{} )}:reply.trim();}};
}
module.exports={createSseReply};
