const {BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
function createSettingsWindow({parent,settings,services,chat,paths,onChange}) {
  const win=new BrowserWindow({parent,modal:true,width:720,height:760,minWidth:600,minHeight:560,show:false,title:'白子桌宠 · 应用设置',backgroundColor:'#15232b',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'app-settings-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenuBarVisibility(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',event=>event.preventDefault());
  const channel='app-settings:'+win.webContents.id;
  const state=()=>({settings:settings.get(),chat:chat.status(),voice:services.status(),dataDirectory:paths.root});
  ipcMain.handle(channel,async(event,action,value)=>{
    if(event.sender!==win.webContents)return null;
    try {
      if(action==='state')return {ok:true,...state()};
      if(action==='save'){const next=require('../../shared/app-settings.cjs').normalize(value),previous=settings.get();if(value.apiKey?.trim()&&value.clearKey)throw Error('请在保存密钥与删除密钥之间选择一项。');if(value.apiKey?.trim())chat.validateKey(value.apiKey);settings.save(next);try{if(value.apiKey?.trim())chat.saveKey(value.apiKey,next.endpoint);if(value.clearKey)chat.clearKey();}catch(error){settings.save(previous);throw error;}onChange(previous,next);return {ok:true,...state(),message:'设置已保存。'};}
      if(action==='test-chat'){const reply=await chat.send([{role:'user',content:'请只回复“连接成功”。'}]);return {ok:true,message:'聊天服务连接成功：'+reply.slice(0,80)};}
      if(action==='probe')return {ok:true,...state(),message:await services.probe()?'本地语音服务已就绪。':'尚未连接到语音服务。'};
      if(action==='start'){await services.start();if(settings.get().speechEnabled){await services.warmup();return {ok:true,...state(),message:'语音服务与音色已准备好，可以开始聊天。'};}return {ok:true,...state(),message:'语音服务已启动。勾选“为聊天回复合成声音”并保存后即可使用。'};}
      if(action==='stop'){services.stop();return {ok:true,...state(),message:'已停止由本软件启动的语音进程。'};}
      if(action==='voice-file'){const result=await dialog.showOpenDialog(win,{title:'安装白子语音组件',filters:[{name:'白子语音组件',extensions:['petpkg']}],properties:['openFile']});if(result.canceled)return {ok:true,...state()};const place=await dialog.showOpenDialog(win,{title:'选择存放语音组件的文件夹（需要约 5 GB 空间）',properties:['openDirectory','createDirectory']});if(place.canceled)return {ok:true,...state()};const target=path.join(place.filePaths[0],'ShirokoVoice');return {...await services.install(result.filePaths[0],target),...state()};}
      if(action==='pick-gsv'||action==='pick-voice'||action==='pick-harness-home'){const result=await dialog.showOpenDialog(win,{properties:['openDirectory']});return {ok:true,path:result.filePaths[0]||''};}
      if(action==='pick-harness'){const result=await dialog.showOpenDialog(win,{filters:[{name:'Windows 应用',extensions:['exe']}],properties:['openFile']});return {ok:true,path:result.filePaths[0]||''};}
      if(action==='data'){await shell.openPath(paths.root);return {ok:true};}
      if(action==='log'){const file=path.join(paths.root,'voice-service.log');if(!fs.existsSync(file))throw Error('尚无语音日志。');await shell.openPath(file);return {ok:true};}
      if(action==='import'){const result=await dialog.showOpenDialog(win,{title:'选择旧版桌宠目录',properties:['openDirectory']});if(result.canceled)return {ok:true};const imported=require('../../shared/preferences-import.cjs').stageImport(result.filePaths[0],paths);return {ok:true,message:imported?'旧版外观与位置设置已导入。退出软件后重新打开生效。':'该目录没有可导入的旧版设置。'};}
    } catch(error){return {ok:false,error:error.message};}
    return {ok:false,error:'未知操作。'};
  });
  win.webContents.on('did-finish-load',()=>{win.webContents.send('app-settings:channel',channel);win.show();});
  win.on('closed',()=>ipcMain.removeHandler(channel));
  win.loadFile(path.join(__dirname,'app-settings.html'));
  return win;
}
module.exports={createSettingsWindow};
