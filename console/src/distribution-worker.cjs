const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {applyCoreUpdate}=require('./distribution-update.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(file){const job=JSON.parse(fs.readFileSync(file,'utf8')),start=Date.now();let result;try{while(true){let alive=true;try{process.kill(job.parentPid,0);}catch{alive=false;}if(!alive)break;if(Date.now()-start>30000)throw Error('控制台未退出，更新已停止');await delay(200);}result=await applyCoreUpdate(job.plan);}catch(error){result={ok:false,message:error.message};}
  fs.writeFileSync(path.join(path.dirname(file),'result.json'),JSON.stringify(result,null,2));const data=path.join(job.plan.root,'console/.runtime');fs.mkdirSync(data,{recursive:true});fs.writeFileSync(path.join(data,'update-notice.json'),JSON.stringify(result));
  const launcher=path.join(job.plan.root,'启动桌宠控制台.exe'),native=fs.existsSync(launcher),exe=native?launcher:require('../../tools/runtime-paths.cjs').electronPath(job.plan.root),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(exe,native?[]:[path.join(job.plan.root,'console')],{cwd:job.plan.root,env,detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();
}
if(require.main===module)run(process.argv[2]).catch(error=>{process.stderr.write(error.stack);process.exitCode=1});
module.exports={run};
