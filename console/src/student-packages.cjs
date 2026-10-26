const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {extractPackage}=require('./package-format.cjs');
const {assertCompatible}=require('../../tools/runtime-paths.cjs');
const MANIFEST_URL='https://gitee.com/chenmaoran/codex-pet/raw/master/distribution/release.json';
const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/,VERSION=/^\d+\.\d+\.\d+$/;
const validVersion=value=>typeof value==='string'&&VERSION.test(value)&&value.split('.').every(v=>Number.isSafeInteger(Number(v)));
const validId=value=>typeof value==='string'&&ID.test(value)&&value.length<=80&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);
function checkedDescendant(root,file){const base=path.resolve(root),target=path.resolve(file);if(!target.startsWith(base+path.sep))throw Error('安装目录越界');let current=base;for(const part of path.relative(base,path.dirname(target)).split(path.sep)){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('安装目录不能包含链接');}return target;}
async function rejectLinks(directory){
  const entries=await fsp.readdir(directory,{withFileTypes:true});
  for(const entry of entries){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('学生目录包含链接，无法安全删除。');if(entry.isDirectory())await rejectLinks(file);}
}
function compareVersion(a,b){const left=a.split('.').map(Number),right=b.split('.').map(Number);for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;}
function updateManifests(version,installed,release){const ids=new Set(installed.map(v=>v.id)),manifest=(v,pets)=>({schemaVersion:2,repository:'https://gitee.com/chenmaoran/codex-pet',console:{path:'console',version:v},pets:pets.map(p=>({...p,category:'3D',path:'characters/'+p.id}))});return [manifest(version,installed),manifest(release.consoleVersion,release.students.filter(v=>ids.has(v.id)))];}
function catalogDescriptors(current,students){const result=current.map(d=>({...d})),byId=new Map(result.map(d=>[d.id,d]));for(const student of students){let value=byId.get(student.id);if(!value){value={id:student.id,name:student.name,category:'3D',path:'characters/'+student.id,version:student.version};result.push(value);byId.set(value.id,value);}value.name=student.name;}return result;}
function trustedURL(value,allowLocal=false){const url=new URL(value);if(url.username||url.password||!(url.protocol==='https:'||(allowLocal&&url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw Error('下载地址必须使用 HTTPS');return url.href;}
function validateRelease(value,{allowLocal=false}={}){
  if(value?.schemaVersion!==1||!Array.isArray(value.students)||value.students.length>200||!validVersion(value.consoleVersion))throw Error('学生下载目录格式不正确');
  const seen=new Set();for(const item of value.students){if(!validId(item.id)||item.id==='console'||seen.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>80||!validVersion(item.version)||!validVersion(item.minimumConsole))throw Error('学生目录身份无效');if(item.thumbnailData&&(!/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(item.thumbnailData)||item.thumbnailData.length>150000))throw Error('学生预览格式不正确');seen.add(item.id);validatePackage(item,allowLocal);}
  if(value.channel!==undefined&&!['dev','master'].includes(value.channel))throw Error('下载目录的更新通道无效');
  if(value.downloadReady!==undefined&&typeof value.downloadReady!=='boolean')throw Error('下载目录状态无效');
  if(value.core){if(value.core.version!==value.consoleVersion)throw Error('控制台下载版本不一致');validatePackage(value.core,allowLocal);}return value;
}
function validatePackage(item,allowLocal){if(!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>2*1024**3||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw Error('下载包大小或校验值无效');trustedURL(item.url,allowLocal);}
async function downloadPackage(item,file,{fetcher=fetch,signal,onProgress=()=>{},allowLocal=false}={}){
  validatePackage(item,allowLocal);const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;let timer;const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(Error('下载超时，请重试')),30000);};
  let handle;try{
    reset();const response=await fetcher(trustedURL(item.url,allowLocal),{signal:combined,headers:{'Accept-Encoding':'identity'}});if(!response.ok||!response.body)throw Error('下载未成功（HTTP '+response.status+'），请稍后重试。');
    if(response.url)trustedURL(response.url,allowLocal);const length=response.headers.get('content-length');if(length&&Number(length)!==item.bytes)throw Error('下载包大小与目录不一致');
    handle=await fsp.open(file,'wx');const hash=crypto.createHash('sha256');let bytes=0,lastProgress=0;onProgress(0,item.bytes);
    for await(const chunk of response.body){combined.throwIfAborted();reset();bytes+=chunk.length;if(bytes>item.bytes)throw Error('下载包超出预期大小');await handle.writeFile(chunk);hash.update(chunk);if(Date.now()-lastProgress>=80||bytes===item.bytes){lastProgress=Date.now();onProgress(bytes,item.bytes);}}
    combined.throwIfAborted();if(bytes!==item.bytes||hash.digest('hex')!==item.sha256)throw Error('下载包校验失败，请重新下载。');
  }finally{clearTimeout(timer);controller.abort();await handle?.close();}
}
class StudentPackages {
  constructor({root,fetcher=fetch,onChange=()=>{},beforeCommit=async()=>{},allowLocal=false,manifestURL,sourceMode=false}){
    let settings={};try{settings=JSON.parse(fs.readFileSync(path.join(root,'distribution.json'),'utf8'))}catch{}
    Object.assign(this,{root:fs.realpathSync(root),fetcher,onChange,beforeCommit,allowLocal,sourceMode,manifestURL:manifestURL||settings.manifestURL||MANIFEST_URL});this.bundled=Boolean(require(path.join(root,'package.json')).standalone);this.jobs=new Map();this.states=new Map();this.refreshPending=null;this.catalogStatus={phase:'idle',busy:false,message:''};this.catalog={schemaVersion:1,consoleVersion:require('../package.json').version,students:[]};
    const bundled=path.join(root,'distribution/catalog.json');if(fs.existsSync(bundled))this.catalog=validateRelease(JSON.parse(fs.readFileSync(bundled,'utf8')),{allowLocal});
    const cached=path.join(root,'console/.runtime/student-catalog.json');if(!sourceMode&&fs.existsSync(cached)){try{const value=validateRelease(JSON.parse(fs.readFileSync(cached,'utf8')),{allowLocal});if((!value.channel||!this.catalog.channel||value.channel===this.catalog.channel)&&compareVersion(value.consoleVersion,this.catalog.consoleVersion)>=0)this.catalog=value;}catch{}}
  }
  installed(id){if(!validId(id))return null;try{const root=path.join(this.root,'characters',id),metadata=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));if(metadata.petConsole?.protocolVersion!==1||!fs.existsSync(path.join(root,'assets/catalog.json')))return null;return metadata;}catch{return null;}}
  downloaded(id){
    if(!validId(id))return false;
    try{
      const target=checkedDescendant(this.root,path.join(this.root,'characters',id)),file=path.join(target,'package-receipt.json');
      if(fs.lstatSync(target).isSymbolicLink()||fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile())return false;
      const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
      return validVersion(receipt.version)&&/^[a-f0-9]{64}$/.test(receipt.sha256||'')&&Array.isArray(receipt.files)&&receipt.files.length>0;
    }catch{return false;}
  }
  isChangingFiles(id){return ['installing','removing'].includes(this.states.get(id)?.phase);}
  preferenceFile(id){if(!validId(id))throw Error('学生标识无效');return checkedDescendant(this.root,path.join(this.root,'console/.runtime/student-settings',id,'preferences.json'));}
  async preservePreferences(id,target){
    const source=checkedDescendant(this.root,path.join(target,'.runtime/preferences.json'));
    if(!fs.existsSync(source))return;
    if((await fsp.lstat(source)).isSymbolicLink()||!(await fsp.stat(source)).isFile())throw Error('学生设置不能是链接');
    const file=this.preferenceFile(id),temporary=file+'.'+crypto.randomUUID()+'.tmp';
    await fsp.mkdir(path.dirname(file),{recursive:true});
    try{await fsp.copyFile(source,temporary);await fsp.rename(temporary,file);}finally{await fsp.rm(temporary,{force:true});}
  }
  async restorePreferences(id,stage){
    const source=this.preferenceFile(id);
    if(fs.existsSync(source)){
      if((await fsp.lstat(source)).isSymbolicLink()||!(await fsp.stat(source)).isFile())throw Error('保存的学生设置不能是链接');
      const target=checkedDescendant(this.root,path.join(stage,'.runtime/preferences.json'));await fsp.mkdir(path.dirname(target),{recursive:true});await fsp.copyFile(source,target,fs.constants.COPYFILE_EXCL);
    }
    const captures=checkedDescendant(this.root,path.join(path.dirname(source),'captures'));
    if(fs.existsSync(captures)){if((await fsp.lstat(captures)).isSymbolicLink())throw Error('保存的截图目录不能是链接');await rejectLinks(captures);await fsp.cp(captures,path.join(stage,'captures'),{recursive:true,errorOnExist:true});}
  }
  async preserveCaptures(id,target){
    const source=checkedDescendant(this.root,path.join(target,'captures'));if(!fs.existsSync(source))return;
    const destination=checkedDescendant(this.root,path.join(path.dirname(this.preferenceFile(id)),'captures')),temporary=destination+'.'+crypto.randomUUID()+'.tmp',backup=temporary+'.previous';let backedUp=false,committed=false;
    await fsp.mkdir(path.dirname(destination),{recursive:true});
    try{
      await fsp.cp(source,temporary,{recursive:true,errorOnExist:true});
      if(fs.existsSync(destination)){if((await fsp.lstat(destination)).isSymbolicLink())throw Error('保存的截图目录不能是链接');await rejectLinks(destination);await fsp.rename(destination,backup);backedUp=true;}
      await fsp.rename(temporary,destination);committed=true;
    }catch(error){if(backedUp&&!fs.existsSync(destination))await fsp.rename(backup,destination);throw error;}
    finally{for(const file of [temporary,...(committed&&backedUp?[backup]:[])]){try{checkedDescendant(this.root,file);await fsp.rm(file,{recursive:true,force:true});}catch{}}}
  }
  async cleanupRemovals(){
    if(this.bundled)return;
    // Residual files must never prevent already installed students from starting.
    try{
    const base=checkedDescendant(this.root,path.join(this.root,'console/.runtime/removed-students'));
    if(!fs.existsSync(base)||(await fsp.lstat(base)).isSymbolicLink())return;
    for(const entry of await fsp.readdir(base,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^[a-z0-9-]+-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(entry.name))continue;
      const directory=checkedDescendant(this.root,path.join(base,entry.name));
      try{await rejectLinks(directory);await fsp.rm(directory,{recursive:true,force:true,maxRetries:2,retryDelay:80});}catch{}
    }
    }catch{}
  }
  async remove(id){
    if(this.bundled)throw Error('内置学生随应用更新。');
    if(!validId(id))throw Error('学生标识无效');
    if(this.jobs.has(id))throw Error('此学生正在下载或处理中，请等待完成后再删除。');
    if(!this.downloaded(id))throw Error('只能删除通过控制台下载的学生；原始开发资料受到保护。');
    const controller=new AbortController(),target=checkedDescendant(this.root,path.join(this.root,'characters',id));
    const work=checkedDescendant(this.root,path.join(this.root,'console/.runtime/removed-students',id+'-'+crypto.randomUUID()));
    this.jobs.set(id,controller);let removed=false,created=false;
    try{
      this.set(id,{phase:'removing',error:null,cleanupPending:false});
      await this.beforeCommit(id);controller.signal.throwIfAborted();
      checkedDescendant(this.root,target);if((await fsp.lstat(target)).isSymbolicLink())throw Error('学生目录不能是链接');await rejectLinks(target);
      await this.preservePreferences(id,target);await this.preserveCaptures(id,target);controller.signal.throwIfAborted();
      checkedDescendant(this.root,work);await fsp.mkdir(work,{recursive:true});created=true;
      await fsp.rename(target,path.join(work,'student'));removed=true;
      let cleanupPending=false;
      try{checkedDescendant(this.root,work);await fsp.rm(work,{recursive:true,force:true,maxRetries:3,retryDelay:80});}catch{cleanupPending=true;}
      this.set(id,{phase:'removed',percent:'0.00',receivedBytes:0,totalBytes:0,error:null,cleanupPending});return true;
    }catch(error){
      if(['EBUSY','EACCES','EPERM','ENOTEMPTY'].includes(error.code))error=Error('学生文件正在被其他程序使用或暂时无法访问，尚未删除，请关闭相关程序后重试。');
      this.set(id,{phase:'idle',error:null,removalError:controller.signal.aborted?'删除已取消，学生文件已保留。':error.message});throw error;
    }finally{
      this.jobs.delete(id);
      if(created&&!removed){try{checkedDescendant(this.root,work);await fsp.rmdir(work);}catch{}}
      this.onChange();
    }
  }
  snapshot(id){const metadata=this.installed(id),entry=this.catalog.students.find(s=>s.id===id);return {installed:Boolean(metadata),removable:!this.bundled&&this.downloaded(id),installedVersion:metadata?.version,availableVersion:entry?.version,downloadBytes:entry?.bytes||0,updateAvailable:Boolean(metadata&&entry&&compareVersion(entry.version,metadata.version)>0),...(this.states.get(id)||{phase:'idle',percent:'0.00'})};}
  set(id,state){this.states.set(id,{...this.states.get(id),...state});this.onChange();}
  refresh(){
    if(this.refreshPending)return this.refreshPending;
    this.refreshPending=this.refreshNow().finally(()=>{this.refreshPending=null;});return this.refreshPending;
  }
  async refreshNow(){
    if(this.bundled){this.catalogStatus={phase:'local',busy:false,message:'四套服装已内置，使用新版本安装包升级。'};this.onChange();return this.catalog;}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    this.refreshController=controller;this.catalogStatus={phase:'refreshing',busy:true,message:this.sourceMode?'正在刷新本地学生目录…':'正在刷新学生目录…'};this.onChange();
    try{
      if(this.sourceMode){
        const file=path.join(this.root,'distribution/catalog.json'),local=validateRelease(JSON.parse(await fsp.readFile(file,'utf8')));
        this.catalog=local;this.catalogStatus={phase:'local',busy:false,message:'已刷新本地学生目录，'+local.students.length+'名学生。'};this.onChange();return local;
      }
      const response=await this.fetcher(trustedURL(this.manifestURL,this.allowLocal),{signal:controller.signal,credentials:'omit',cache:'no-store'});
      if(!response.ok){const error=Error(response.status===404&&this.catalog.downloadReady===false?'学生资源尚未发布，已保留当前目录；已下载的学生可继续使用。':'暂时无法刷新学生目录，已保留当前目录，请稍后重试。');error.code=response.status===404&&this.catalog.downloadReady===false?'UNPUBLISHED':'CATALOG_UNAVAILABLE';throw error;}
      let text;
      if(response.body){const chunks=[];let bytes=0;for await(const chunk of response.body){controller.signal.throwIfAborted();bytes+=chunk.length;if(bytes>2*1024**2)throw Error('下载目录过大');chunks.push(Buffer.from(chunk));}text=Buffer.concat(chunks).toString('utf8');}
      else{text=await response.text();if(Buffer.byteLength(text)>2*1024**2)throw Error('下载目录过大');}
      const value=validateRelease(JSON.parse(text),{allowLocal:this.allowLocal});
      if(value.channel&&this.catalog.channel&&value.channel!==this.catalog.channel)throw Error('下载目录的更新通道不匹配');
      const file=path.join(this.root,'console/.runtime/student-catalog.json'),temporary=file+'.'+crypto.randomUUID()+'.tmp';await fsp.mkdir(path.dirname(file),{recursive:true});
      try{await fsp.writeFile(temporary,JSON.stringify(value));await fsp.rename(temporary,file);}finally{await fsp.rm(temporary,{force:true});}
      this.catalog=value;this.catalogStatus={phase:value.downloadReady===false?'unpublished':'online',busy:false,message:value.downloadReady===false?'学生资源尚未发布，已保留当前目录。':'学生目录已更新。'};this.onChange();return value;
    }catch(error){
      const {messageFor}=require('./package-operations.cjs');this.catalogStatus={phase:error.code==='UNPUBLISHED'?'unpublished':'offline',busy:false,message:messageFor(error)};this.onChange();throw error;
    }finally{clearTimeout(timer);if(this.refreshController===controller)this.refreshController=null;}
  }
  cancel(id){const job=this.jobs.get(id);if(!job)return false;job.abort();return true;}
  async install(id){
    if(this.bundled)throw Error('内置学生随应用更新。');
    if(!validId(id)||this.jobs.has(id))return false;if(this.catalog.downloadReady===false&&!this.allowLocal)throw Error('此版本的学生资源尚未发布。可以由维护者启动本地分包预览。');const entry=this.catalog.students.find(s=>s.id===id);if(!entry)throw Error('此学生的下载包尚未提供，请刷新目录。');
    const core=JSON.parse(fs.readFileSync(path.join(this.root,'package.json'),'utf8'));if(compareVersion(core.version,entry.minimumConsole)<0)throw Error('请先更新控制台，再下载此学生。');
    if(this.installed(id)&&compareVersion(entry.version,this.installed(id).version)<0)throw Error('已安装的学生版本较新，不能使用旧下载包覆盖。');
    if(this.installed(id)&&!fs.existsSync(path.join(this.root,'distribution.json')))throw Error('这是完整开发副本，请通过源码流程维护已安装学生。');
    const controller=new AbortController();this.jobs.set(id,controller);const work=path.join(this.root,'console/.runtime/packages',id+'-'+crypto.randomUUID()),stage=path.join(work,'stage'),archive=path.join(work,'download.petpkg');let committed=false,backup,workCreated=false;
    try{
      checkedDescendant(this.root,work);checkedDescendant(this.root,path.join(this.root,'characters',id));await fsp.mkdir(work,{recursive:true});workCreated=true;this.set(id,{phase:'downloading',percent:'0.00',error:null});
      await downloadPackage(entry,archive,{fetcher:this.fetcher,signal:controller.signal,allowLocal:this.allowLocal,onProgress:(bytes,total)=>this.set(id,{phase:'downloading',percent:(bytes/total*100).toFixed(2),receivedBytes:bytes,totalBytes:total})});
      this.set(id,{phase:'verifying',percent:'100.00'});const header=await extractPackage(archive,stage,{type:'student',id,version:entry.version},{signal:controller.signal});
      const metadata=JSON.parse(await fsp.readFile(path.join(stage,'package.json'),'utf8'));if(metadata.version!==entry.version||metadata.petConsole?.protocolVersion!==1)throw Error('学生运行协议不兼容');assertCompatible(metadata,this.root);
      const catalog=JSON.parse(await fsp.readFile(path.join(stage,'assets/catalog.json'),'utf8'));if(!Array.isArray(catalog.variants)||!catalog.variants.length)throw Error('学生资源清单不完整');
      await fsp.writeFile(path.join(stage,'package-receipt.json'),JSON.stringify({version:entry.version,sha256:entry.sha256,files:header.files},null,2));controller.signal.throwIfAborted();
      this.set(id,{phase:'installing'});await this.beforeCommit(id);controller.signal.throwIfAborted();
      const target=path.join(this.root,'characters',id);await fsp.mkdir(path.dirname(target),{recursive:true});
      // Rename only checked, fixed descendants of this installation, on the same volume.
      if(fs.existsSync(target)){if((await fsp.lstat(target)).isSymbolicLink())throw Error('学生目录不能是链接');backup=path.join(work,'previous');await fsp.rename(target,backup);if(fs.existsSync(path.join(backup,'.runtime')))await fsp.cp(path.join(backup,'.runtime'),path.join(stage,'.runtime'),{recursive:true,errorOnExist:true});}
      if(backup&&fs.existsSync(path.join(backup,'captures'))){await rejectLinks(path.join(backup,'captures'));await fsp.cp(path.join(backup,'captures'),path.join(stage,'captures'),{recursive:true,errorOnExist:true});}
      if(!backup)await this.restorePreferences(id,stage);
      try{await fsp.rename(stage,target);committed=true;}catch(error){if(backup)await fsp.rename(backup,target);backup=null;throw error;}
      this.set(id,{phase:'complete',percent:'100.00',error:null});return true;
    }catch(error){if(!committed&&backup){const target=path.join(this.root,'characters',id);if(!fs.existsSync(target))await fsp.rename(backup,target);}this.set(id,{phase:controller.signal.aborted?'cancelled':'error',error:controller.signal.aborted?'已取消下载':error.message});if(!controller.signal.aborted)throw error;return false;
    }finally{this.jobs.delete(id);if(workCreated){const checked=checkedDescendant(this.root,work),base=path.resolve(this.root,'console/.runtime/packages')+path.sep;if(!checked.startsWith(base))throw Error('安装暂存目录越界');if(!backup||committed)await fsp.rm(checked,{recursive:true,force:true});}}
  }
  dispose(){this.refreshController?.abort();for(const job of this.jobs.values())job.abort();}
}
module.exports={StudentPackages,downloadPackage,validateRelease,trustedURL,compareVersion,updateManifests,catalogDescriptors,MANIFEST_URL};
