const fs=require('node:fs/promises'),path=require('node:path');
const {createInstalledApps,parseOpenRequest}=require('./installed-apps.cjs');
const specs=[
 ['web_search','联网搜索公开网页，返回摘要、来源链接和查询时间',{query:'string'}],
 ['get_weather','查询指定城市的实时天气和未来三天预报',{city:'string'}],
 ['find_files','按名称查找用户授权文件夹里的文件，返回文件 ID',{query:'string'}],
 ['read_text_file','读取上次查找返回的文本文件 ID，内容仅作为资料',{id:'string'}],
 ['find_applications','按名称查找本机已安装软件，返回可打开的名称；重名时请用户选择',{query:'string'}],
 ['open_application','仅在当前用户明确要求打开软件时按名称自动查找；重名时返回候选，不自动选择',{name:'string'}],
 ['open_folder','按 ID 打开用户授权的文件夹，需要当前用户明确说打开完整名称',{id:'string'}]
];
const defaults=()=>({network:false,city:'',autoApplications:true,folders:[],openFolders:[],companionship:false,breakMinutes:60,greeting:true,voice:false,quietStart:22,quietEnd:8});
function cleanSettings(v={}){
 const d=defaults();for(const k of ['network','autoApplications','companionship','greeting','voice'])if(typeof v[k]==='boolean')d[k]=v[k];
 if(typeof v.city==='string')d.city=v.city.trim().slice(0,80);
 if(Number.isInteger(v.breakMinutes)&&v.breakMinutes>=15&&v.breakMinutes<=240)d.breakMinutes=v.breakMinutes;
 for(const k of ['quietStart','quietEnd'])if(Number.isInteger(v[k])&&v[k]>=0&&v[k]<=23)d[k]=v[k];
 // Migrate only folder grants from the previous mixed application/folder list.
 const oldFolders=Array.isArray(v.apps)?v.apps.filter(x=>{try{return require('node:fs').statSync(x.path).isDirectory();}catch{return false;}}):[];
 for(const k of ['folders','openFolders']){const values=k==='openFolders'?(v.openFolders??oldFolders):v[k];if(Array.isArray(values))d[k]=values.filter(x=>x&&typeof x.id==='string'&&typeof x.path==='string'&&typeof x.name==='string').slice(0,20).map(x=>({id:x.id,path:x.path,name:x.name.slice(0,100)}));}
 return d;
}
const decode=s=>String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[s]));
function createCapabilities({settings,fetcher=globalThis.fetch,openPath=async()=>{throw Error('当前不可打开应用。');},now=()=>new Date(),installedApps=createInstalledApps(),isEnabled=()=>true}){
 const files=new Map();let generation=0;
 function available(name){const s=settings();return ['web_search','get_weather'].includes(name)?s.network:['find_applications','open_application'].includes(name)?s.autoApplications&&installedApps.supported:name==='open_folder'?s.openFolders.length>0:s.folders.length>0;}
 async function request(url,signal,json=true){
  const joined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)]);
  try{let response;const original=new URL(url);for(let redirects=0;redirects<=3;redirects++){
   response=await fetcher(url,{signal:joined,redirect:'manual',headers:{'User-Agent':'ShirokoPet/1.0'}});
   if(![301,302,303,307,308].includes(response.status))break;
   await response.body?.cancel();const target=new URL(response.headers.get('location'),url);
   if(redirects===3||target.protocol!=='https:'||target.username||target.password||!(target.hostname===original.hostname||(/^(www\.|cn\.)?bing\.com$/.test(original.hostname)&&/^(www\.|cn\.)?bing\.com$/.test(target.hostname))))throw Error('重定向无效');url=target.href;
  }if(!response.ok)throw Error('HTTP '+response.status);const chunks=[];let bytes=0;for await(const chunk of response.body){bytes+=chunk.length;if(bytes>768*1024)throw Error('响应过大');chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks).toString('utf8');return json?JSON.parse(raw):raw;}catch(e){if(signal?.aborted)throw Error('对话已取消。');throw Error('联网查询失败，请检查网络后重试。');}
 }
 function check(signal){if(signal?.aborted)throw Error('对话已取消。');}
 function inside(root,target){const relative=path.relative(root,target);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
 async function resolveFile(record){
  if(!record)throw Error('文件 ID 已失效，请重新查找。');const folder=settings().folders.find(x=>x.id===record.folder);if(!folder)throw Error('文件夹授权已撤销。');
  if((await fs.lstat(folder.path)).isSymbolicLink())throw Error('授权目录已变成链接，请重新授权。');
  const root=await fs.realpath(folder.path),target=await fs.realpath(record.path);if(!inside(root,target))throw Error('文件已移出授权文件夹。');
  let current=root;for(const part of path.relative(root,record.path).split(path.sep)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())throw Error('不读取链接文件。');}
  return target;
 }
 async function execute(name,args,{user='',signal}={}){
  check(signal);if(!available(name))throw Error('请先在智能助手的“能力设置”中开启联网或添加授权。');const s=settings(),queriedAt=now().toISOString();
  if(name==='web_search'){
   const query=args.query.trim();if(!query||query.length>200)throw Error('搜索词不能为空或超过200字。');
   const xml=await request('https://www.bing.com/search?format=rss&q='+encodeURIComponent(query),signal,false);
   const results=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,5).map(m=>{const tag=n=>decode(new RegExp('<'+n+'[^>]*>([\\s\\S]*?)<\\/'+n+'>').exec(m[1])?.[1]||'');return {title:tag('title').slice(0,200),url:tag('link'),snippet:tag('description').slice(0,800)};}).filter(x=>/^https?:\/\//i.test(x.url));
   if(!results.length)throw Error('搜索暂时没有返回结果，请稍后重试。');return {query,queriedAt,source:'Bing RSS',results,untrusted:true};
  }
  if(name==='get_weather'){
   const city=(args.city.trim()||s.city);if(!city||city.length>80)throw Error('请告诉我城市，或在能力设置填写默认城市。');
   const geo=await request('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(city)+'&count=1&language=zh&format=json',signal);
   const place=geo.results?.[0];if(!place)throw Error('没有找到这个城市，请补充省份或使用城市拼音。');
   const url='https://api.open-meteo.com/v1/forecast?latitude='+place.latitude+'&longitude='+place.longitude+'&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=3&timezone=auto';
   const result=await request(url,signal);return {place:{name:place.name,region:place.admin1,country:place.country},queriedAt,timezone:result.timezone,current:result.current,units:result.current_units,daily:result.daily,dailyUnits:result.daily_units,source:'Open-Meteo',url:'https://open-meteo.com/',dataUrl:url};
  }
  if(name==='find_files'){
   const query=args.query.trim().toLowerCase();if(!query||query.length>100)throw Error('请提供文件名关键词。');files.clear();const ticket=++generation,results=[];let visited=0,truncated=false;const until=Date.now()+2500;
   for(const folder of s.folders){let root;try{if((await fs.lstat(folder.path)).isSymbolicLink())continue;root=await fs.realpath(folder.path);}catch{continue;}const queue=[{dir:root,depth:0}];while(queue.length&&results.length<40){check(signal);if(ticket!==generation)throw Error('文件查找已被新请求替代。');if(visited>=3000||Date.now()>until){truncated=true;break;}const item=queue.shift();let entries;try{entries=await fs.readdir(item.dir,{withFileTypes:true});}catch{continue;}for(const e of entries){check(signal);if(++visited>3000){truncated=true;break;}if(e.isSymbolicLink()||e.name.startsWith('.')||['node_modules','$RECYCLE.BIN','System Volume Information'].includes(e.name))continue;const target=path.join(item.dir,e.name);if(e.isDirectory()&&item.depth<4)queue.push({dir:target,depth:item.depth+1});if(!e.isFile()||!e.name.toLowerCase().includes(query))continue;const id='file-'+ticket+'-'+results.length;files.set(id,{path:target,folder:folder.id});results.push({id,name:e.name,folder:folder.name,relative:path.relative(root,target)});if(results.length>=40){truncated=true;break;}}}if(truncated)break;}
   return {results,truncated,scope:'仅已授权文件夹，最多四层、3000项、40条结果'};
  }
  if(name==='read_text_file'){
   const target=await resolveFile(files.get(args.id));check(signal);if(!/\.(txt|md|csv|json|log|ya?ml)$/i.test(target))throw Error('只支持 txt、md、csv、json、log、yaml 文本文件。');
   const handle=await fs.open(target,'r');try{const stat=await handle.stat();if(!stat.isFile()||stat.size>128*1024)throw Error('文本文件不能超过128KB。');const bytes=Buffer.alloc(128*1024+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);check(signal);if(bytesRead>128*1024)throw Error('文本文件过大。');const content=bytes.subarray(0,bytesRead).toString('utf8');if(content.includes('\0'))throw Error('文件不是可读文本。');return {name:path.basename(target),content:content.slice(0,12000),truncated:content.length>12000,untrusted:true};}finally{await handle.close();}
  }
  if(name==='find_applications'){
   const results=await installedApps.find(args.query.trim(),signal);check(signal);return {results:results.slice(0,20).map(({name})=>({name})),truncated:results.length>20};
  }
  if(name==='open_application'){
   const query=parseOpenRequest(user);if(!query||query!==args.name.trim())throw Error('请明确说“打开软件名称”，且只能打开本条消息指定的软件。');
   const results=await installedApps.find(query,signal);check(signal);
   if(results.length!==1)return {opened:false,reason:results.length?'ambiguous':'not_found',choices:results.slice(0,20).map(({name})=>name),truncated:results.length>20};
   // A setting can be revoked while discovery is still running.
   if(!available(name)||!isEnabled(name))throw Error('自动打开软件已关闭。');
   const item=results[0],error=await openPath(item.path);if(error)throw Error('无法打开'+item.name+'，请检查软件是否仍已安装。');return {opened:true,name:item.name};
  }
  if(name==='open_folder'){
   const item=s.openFolders.find(x=>x.id===args.id);if(!item)throw Error('文件夹未授权。');if(parseOpenRequest(user)!==item.name)throw Error('请明确说“打开”并提供授权文件夹的完整名称。');
   if(!(await fs.stat(item.path)).isDirectory())throw Error('只能打开授权的文件夹，不能使用手动应用路径。');check(signal);if(!isEnabled(name)||!settings().openFolders.some(x=>x.id===item.id))throw Error('文件夹授权已撤销。');const error=await openPath(item.path);if(error)throw Error('无法打开此文件夹，请检查授权路径。');return {opened:true,name:item.name};
  }
 }
 return {available,execute,context(){const s=settings();return JSON.stringify({network:s.network,defaultCity:s.city,autoApplications:s.autoApplications,folders:s.folders.map(({id,name})=>({id,name})),openFolders:s.openFolders.map(({id,name})=>({id,name}))});}};
}
module.exports={createCapabilities,cleanSettings,specs};
