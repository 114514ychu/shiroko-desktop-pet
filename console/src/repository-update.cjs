// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { REPOSITORY_URL, compareManifests } = require('./update-check.cjs');
const REMOTE = REPOSITORY_URL + '.git';
async function git(root, args) {
  try {
    const {stdout}=await execute('git',args,{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:4*1024*1024,timeout:120000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
    return stdout.trim();
  } catch(error) {
    const failure=new Error('Git操作失败：'+String(error.stderr||error.message).trim().slice(0,500));
    failure.code=error.code;throw failure;
  }
}
function samePath(left,right){return path.resolve(left).toLowerCase()===path.resolve(right).toLowerCase();}
async function clean(root) {
  if(await git(root,['status','--porcelain=v1','--untracked-files=normal'])) throw new Error('本地有代码改动，请先处理这些改动再更新。个人设置不会影响此检查。');
}
async function prepareUpdate({root,remote=REMOTE,fixture=false,progress=()=>{}}) {
  if(remote!==REMOTE&&!fixture)throw new Error('更新来源不正确');
  progress('正在检查本地项目…');
  let top;
  try{top=await git(root,['rev-parse','--show-toplevel']);}catch{throw new Error('这个安装目录不支持自动拉取，请通过“打开仓库”下载新版。');}
  if(!samePath(root,top))throw new Error('当前目录不是桌宠仓库根目录');
  const origin=await git(root,['remote','get-url','origin']);
  if(!fixture&&origin.replace(/\/$/,'').replace(/\.git$/,'')!==REPOSITORY_URL)throw new Error('仓库来源不匹配，请通过“打开仓库”获取官方副本。');
  const branch=await git(root,['symbolic-ref','--short','HEAD']);
  if(branch!=='master')throw new Error('当前处于开发分支，请回到master后更新。');
  await clean(root);
  const before=await git(root,['rev-parse','HEAD']);
  progress('正在拉取仓库更新…');
  await git(root,['fetch','--no-tags',remote,'master']);
  const target=await git(root,['rev-parse','FETCH_HEAD']);
  try{await git(root,['merge-base','--is-ancestor',before,target]);}catch{throw new Error('本地包含独立提交，无法直接更新；请先处理分支差异。');}
  const local=JSON.parse(fs.readFileSync(path.join(root,'pets.json'),'utf8'));
  const published=JSON.parse(await git(root,['show',target+':pets.json']));
  const comparison=compareManifests(local,published);
  if(comparison.status!=='available')throw new Error('当前没有可拉取的新版本。');
  return {root:path.resolve(root),before,target,branch,comparison};
}
function preferenceFiles(root) {
  const index=JSON.parse(fs.readFileSync(path.join(root,'pets.json'),'utf8'));
  const names=['console/.runtime/preferences.json'];
  for(const role of index.pets) {
    if(!/^[a-z0-9-]+$/.test(role.id)||role.path!=='characters/'+role.id)throw new Error('学生路径不正确');
    names.push(role.path+'/.runtime/preferences.json');
  }
  return names;
}
function snapshotPreferences(root,backup) {
  const records=preferenceFiles(root).map(name=>{
    const source=path.join(root,name),destination=path.join(backup,name),exists=fs.existsSync(source);
    if(exists){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
    return {name,exists};
  });
  fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify(records,null,2));return records;
}
function restorePreferences(root,backup,records) {
  for(const entry of records){const destination=path.join(root,entry.name);if(entry.exists){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.join(backup,entry.name),destination);}else fs.rmSync(destination,{force:true});}
}
async function setupRuntime(root) {
  const env={...process.env};
  // Windows PowerShell must build its own module path instead of inheriting
  // an incompatible PowerShell 7 path from the launcher. Process-local only.
  for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];
  await execute('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'tools/setup.ps1')],{cwd:root,windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,timeout:900000,env});
}
async function applyPreparedUpdate(plan,{backup,prepare=setupRuntime,progress=()=>{}}) {
  const {root,before,target}=plan;
  if(!/^[a-f0-9]{40,64}$/.test(before)||!/^[a-f0-9]{40,64}$/.test(target))throw new Error('更新提交不正确');
  if(await git(root,['rev-parse','HEAD'])!==before)throw new Error('执行期间本地版本发生变化，请重新检查更新。');
  await clean(root);
  const preferences=snapshotPreferences(root,backup);let merged=false;
  try {
    await git(root,['merge','--ff-only',target]);merged=true;progress('正在准备运行环境…');
    await prepare(root);return {ok:true,status:'applied',before,target};
  } catch(error) {
    let rolledBack=false;
    if(merged&&await git(root,['rev-parse','HEAD'])===target){try{await git(root,['reset','--keep',before]);rolledBack=true;}catch{}}
    return {ok:false,status:'error',message:error.message,rolledBack,before,target};
  } finally {restorePreferences(root,backup,preferences);}
}
module.exports={REMOTE,git,prepareUpdate,applyPreparedUpdate,snapshotPreferences,restorePreferences,setupRuntime};
