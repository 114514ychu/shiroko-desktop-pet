const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto');
const {downloadPackage,compareVersion}=require('./student-packages.cjs');
const {extractPackage,sha256,validateHeader}=require('./package-format.cjs');
function within(root,file){const base=path.resolve(root)+path.sep,target=path.resolve(file);if(!target.startsWith(base))throw Error('更新文件超出安装目录');return target;}
async function prepareCoreUpdate({root,release,fetcher=fetch,progress=()=>{},allowLocal=false}){
  if(!fs.existsSync(path.join(root,'distribution.json')))throw Error('开发副本使用源码更新流程');
  const current=JSON.parse(await fsp.readFile(path.join(root,'package.json'),'utf8')).version,item=release.core;
  if(!item||item.version!==release.consoleVersion||compareVersion(item.version,current)<=0)throw Error('没有可用的控制台更新');
  const directory=within(root,path.join(root,'console/.runtime/core-updates',crypto.randomUUID())),archive=path.join(directory,'core.petpkg'),stage=path.join(directory,'stage');await fsp.mkdir(directory,{recursive:true});
  try{
  await downloadPackage(item,archive,{fetcher,allowLocal,onProgress:(bytes,total)=>progress('正在下载控制台 '+(bytes/total*100).toFixed(2)+'%')});
  progress('正在校验控制台更新…');const header=await extractPackage(archive,stage,{type:'core',version:item.version});
  const installed=JSON.parse(await fsp.readFile(path.join(root,'distribution.json'),'utf8')),next=JSON.parse(await fsp.readFile(path.join(stage,'distribution.json'),'utf8'));
  if(next.type!=='portable-console'||next.version!==item.version||installed.channel&&next.channel!==installed.channel)throw Error('控制台安装包身份或更新通道不匹配');
  return {root:path.resolve(root),stage,directory,version:item.version,files:header.files};
  }catch(error){await fsp.rm(within(root,directory),{recursive:true,force:true});throw error;}
}
async function applyCoreUpdate(plan){
  validateHeader({schemaVersion:1,type:'core',platform:'windows-x64',version:plan.version,files:plan.files});
  const root=path.resolve(plan.root),base=within(root,path.join(root,'console/.runtime/core-updates')),directory=within(base,plan.directory),stage=within(directory,plan.stage),backup=within(directory,path.join(directory,'backup')),changes=[];
  if(!fs.existsSync(path.join(root,'distribution.json')))throw Error('更新目标不是用户安装包');
  await fsp.mkdir(backup,{recursive:true});
  try{
    for(const entry of plan.files){const from=within(stage,path.join(stage,entry.path)),target=within(root,path.join(root,entry.path));
      if(await sha256(from)!==entry.sha256)throw Error('暂存更新校验失败');
      if(fs.existsSync(target)&&(await sha256(target))===entry.sha256)continue;
      let ancestor=path.dirname(target);while(ancestor!==root){if(fs.existsSync(ancestor)&&(await fsp.lstat(ancestor)).isSymbolicLink())throw Error('更新目标包含链接目录');ancestor=path.dirname(ancestor);}
      if(fs.existsSync(target)&&(await fsp.lstat(target)).isSymbolicLink())throw Error('更新目标不能是链接');
      const previous=within(backup,path.join(backup,entry.path)),existed=fs.existsSync(target);if(existed){await fsp.mkdir(path.dirname(previous),{recursive:true});await fsp.copyFile(target,previous);}
      await fsp.mkdir(path.dirname(target),{recursive:true});changes.push({target,previous,existed});await fsp.copyFile(from,target+'.update.tmp');await fsp.rename(target+'.update.tmp',target);
    }
    return {ok:true,version:plan.version};
  }catch(error){const rollbackErrors=[];for(const item of changes.reverse()){try{if(item.existed){if(!fs.existsSync(item.target)||await sha256(item.target)!==await sha256(item.previous)){await fsp.copyFile(item.previous,item.target+'.rollback.tmp');await fsp.rename(item.target+'.rollback.tmp',item.target);}}else await fsp.rm(item.target,{force:true});await fsp.rm(item.target+'.update.tmp',{force:true});}catch(failure){rollbackErrors.push(failure.message);}}return {ok:false,rolledBack:rollbackErrors.length===0,message:error.message+(rollbackErrors.length?'；回退未完成，备份保留：'+rollbackErrors.join('；'):'')};}
}
module.exports={prepareCoreUpdate,applyCoreUpdate,within};
