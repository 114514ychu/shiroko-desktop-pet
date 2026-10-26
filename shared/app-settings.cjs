const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = { endpoint:'https://api.deepseek.com/chat/completions', model:'deepseek-chat', speechEnabled:false, speechEngine:'gsv', speechEndpoint:'http://127.0.0.1:9881/synthesize', gsvDirectory:'', voiceDirectory:'', followEnabled:false, harnessExecutable:'', harnessHome:'' };
function normalize(value = {}) {
  const result = { ...DEFAULTS };
  for (const key of ['endpoint','model','speechEndpoint','gsvDirectory','voiceDirectory','harnessExecutable','harnessHome']) if (typeof value[key] === 'string') result[key] = value[key].trim().slice(0,2048);
  if (value.speechEngine === 'legacy' || value.speechEngine === 'gsv') result.speechEngine = value.speechEngine;
  for (const key of ['speechEnabled','followEnabled']) result[key] = value[key] === true;
  const url = new URL(result.endpoint);
  if (url.username || url.password || url.hash || url.search || !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw Error('聊天地址须使用 HTTPS，或本机 HTTP 地址。');
  if (!url.pathname.endsWith('/chat/completions')) url.pathname = url.pathname.replace(/\/$/,'') + '/chat/completions';
  result.endpoint = url.href;
  if (!result.model || result.model.length > 160 || /[\r\n]/.test(result.model)) throw Error('请填写有效的模型名称。');
  const speech = new URL(result.speechEndpoint);
  if (speech.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(speech.hostname) || speech.username || speech.password || speech.search || speech.hash) throw Error('语音地址须为本机 HTTP 服务。');
  if (value.speechEngine !== 'legacy' && value.speechEngine !== 'gsv') {
    const oldDefault = speech.href.replace(/\/$/, '') === 'http://127.0.0.1:9880/tts';
    result.speechEngine = oldDefault || speech.pathname === '/synthesize' ? 'gsv' : 'legacy';
  }
  if(result.speechEngine==='gsv'&&speech.href.replace(/\/$/,'')==='http://127.0.0.1:9880/tts')result.speechEndpoint=DEFAULTS.speechEndpoint;
  return result;
}
function createSettings(directory,defaults={}) {
  const file = path.join(directory,'services.json');
  let value; try { value = normalize(JSON.parse(fs.readFileSync(file,'utf8'))); } catch { value = normalize({...DEFAULTS,...defaults}); }
  return { get:() => ({ ...value }), save(input) { const next = normalize(input); fs.mkdirSync(directory,{recursive:true}); fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)); fs.renameSync(file+'.tmp',file); value=next; return this.get(); } };
}
module.exports = { createSettings, normalize, DEFAULTS };
