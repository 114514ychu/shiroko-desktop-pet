const fs=require('node:fs'),path=require('node:path'),{execFile}=require('node:child_process'),{createHash}=require('node:crypto');
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s._()（）-]/g,'');
const aliasGroups=[['微信','weixin','wechat'],['QQ','腾讯QQ'],['Microsoft Edge','msedge','Edge','微软浏览器'],['Google Chrome','chrome','谷歌浏览器'],['Firefox','火狐浏览器'],['Visual Studio Code','Code','VS Code','vscode'],['计算器','calc','calculator'],['记事本','notepad']];
function parseOpenRequest(value){
 const m=/^(?:请\s*)?(?:帮我\s*|给我\s*)?(?:打开|启动|运行)(?:一下)?[：:\s]*(.+?)\s*(?:吧|好吗|可以吗)?[。！!？?]*$/u.exec(String(value).trim());
 if(!m)return null;const query=m[1].trim().replace(/(?:这个|这款)?(?:软件|应用)$/u,'').trim();
 if(!query||query.length>100||/[\r\n\\/:;；`<>|&]/.test(query)||/(?:然后|并且|同时|不要|别打开|怎么|如何|和.+(?:QQ|微信|浏览器)|以及)/.test(query))return null;
 return query;
}
function catalog(records){
 const entries=new Map();
 for(const raw of records){
  if(!raw||typeof raw.name!=='string'||typeof raw.path!=='string'||typeof raw.executable!=='string')continue;
  const executable=path.win32.normalize(raw.executable),launch=path.win32.normalize(raw.path),base=path.win32.basename(executable,'.exe');
  if(!path.win32.isAbsolute(executable)||!path.win32.isAbsolute(launch)||!/\.exe$/i.test(executable)||!/\.(exe|lnk)$/i.test(launch))continue;
  if(/^(?:unins.*|uninstall.*|update.*|setup.*|installer.*|cmd|powershell|pwsh|rundll32|mshta|wscript|cscript)$/i.test(base)||/(?:卸载|卸除|uninstall|unins000)/i.test(raw.name))continue;
  const key=executable.toLowerCase(),existing=entries.get(key),aliases=[raw.name,base];
  if(existing){existing.aliases.push(...aliases);continue;}
  entries.set(key,{id:createHash('sha256').update(key).digest('hex').slice(0,20),name:raw.name.trim().slice(0,100),path:launch,executable,aliases});
 }
 const result=[...entries.values()].filter(item=>!(/\\WindowsApps\\Microsoft\.WindowsNotepad_/i.test(item.executable)&&[...entries.values()].some(other=>/\\System32\\notepad\.exe$/i.test(other.executable))));
 for(const item of result){
  for(const group of aliasGroups)if(group.some(a=>item.aliases.some(b=>normalize(a)===normalize(b))))item.aliases.push(...group);
  if(/^(msedge|chrome|firefox|brave|opera)$/i.test(path.win32.basename(item.executable,'.exe')))item.aliases.push('浏览器');
  item.aliases=[...new Set(item.aliases.map(normalize))];
 }
 const counts=new Map();for(const item of result)counts.set(normalize(item.name),(counts.get(normalize(item.name))||0)+1);
 for(const item of result)if(counts.get(normalize(item.name))>1){item.name+='（'+path.win32.basename(path.win32.dirname(item.executable))+' · '+item.id.slice(0,4)+'）';item.aliases.push(normalize(item.name));}
 return result.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
function matches(items,query){
 const key=normalize(query);if(!key)return [];
 const exact=items.filter(item=>item.aliases.includes(key));if(exact.length)return exact;
 return key.length>=3?items.filter(item=>item.aliases.some(alias=>alias.includes(key))):[];
}
function scanWindows(){
 const script=fs.readFileSync(path.join(__dirname,'installed-apps.ps1'),'utf8'),executable=path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 return new Promise((resolve,reject)=>execFile(executable,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,encoding:'utf8'},(error,stdout)=>{
  if(error)return reject(Error('读取已安装软件失败，请稍后重试。'));
  try{const records=JSON.parse(stdout.replace(/^\uFEFF/,''));if(!Array.isArray(records)||records.length>2000)throw Error();resolve(records);}catch{reject(Error('已安装软件列表读取异常，请稍后重试。'));}
 }));
}
function createInstalledApps({scanner=scanWindows,platform=process.platform,now=Date.now}={}){
 let cached,expires=0,pending;
 async function list(signal){
  if(signal?.aborted)throw Error('对话已取消。');if(platform!=='win32')throw Error('自动查找软件目前支持 Windows。');
  if(!cached||now()>=expires){if(!pending)pending=Promise.resolve().then(scanner).then(records=>{cached=catalog(records);expires=now()+60000;return cached;}).finally(()=>{pending=null;});await pending;}
  if(signal?.aborted)throw Error('对话已取消。');return cached;
 }
 return {supported:platform==='win32',async find(query,signal){return matches(await list(signal),query);}};
}
module.exports={createInstalledApps,parseOpenRequest,catalog,matches};
