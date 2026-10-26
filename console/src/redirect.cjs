const { app } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
function redirect(roleId) {
  const args = [path.resolve(__dirname,'..'),'--role='+roleId,...process.argv.filter(value=>value.startsWith('--variant=') || value.startsWith('--clip='))];
  const child = spawn(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true});
  child.once('spawn',()=>{child.unref();app.quit();});
  child.once('error',error=>{console.error('无法启动桌宠控制台：'+error.message);app.exit(1);});
}
module.exports = { redirect };
