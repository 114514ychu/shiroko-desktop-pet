// Runs from an ignored snapshot after the console exits; no host settings change.
const fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {applyPreparedUpdate,setupRuntime,restorePreferences}=require('./repository-update.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(planFile) {
  const job=JSON.parse(fs.readFileSync(planFile,'utf8')),start=Date.now();
  let result;
  try{
    while(true){let alive=true;try{process.kill(job.parentPid,0);}catch{alive=false;}if(!alive)break;if(Date.now()-start>30000)throw new Error('控制台未退出，更新已停止。');await delay(200);}
    result=await applyPreparedUpdate(job.plan,{backup:path.join(path.dirname(planFile),'preferences')});
  }catch(error){result={ok:false,status:'error',message:error.message};}
  if(result.rolledBack){const backup=path.join(path.dirname(planFile),'preferences');try{await setupRuntime(job.plan.root);}catch(error){result.message+='；旧版运行环境准备失败：'+error.message;}finally{restorePreferences(job.plan.root,backup,JSON.parse(fs.readFileSync(path.join(backup,'manifest.json'),'utf8')));}}
  const data=path.join(job.plan.root,'console/.runtime');fs.mkdirSync(data,{recursive:true});
  fs.writeFileSync(path.join(data,'update-notice.json'),JSON.stringify({...result,generatedAt:new Date().toISOString()},null,2));
  fs.writeFileSync(path.join(path.dirname(planFile),'result.json'),JSON.stringify(result,null,2));
  const child=spawn(job.node,[path.join(job.plan.root,'console/tools/launch.cjs')],{cwd:job.plan.root,detached:true,stdio:'ignore',windowsHide:true});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
}
if(require.main===module)run(process.argv[2]).catch(error=>{if(process.argv[2])fs.writeFileSync(path.join(path.dirname(process.argv[2]),'worker-error.json'),JSON.stringify({ok:false,error:error.message}));process.exitCode=1;});
module.exports={run};
