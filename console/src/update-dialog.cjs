// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const {BrowserWindow,ipcMain,shell}=require('electron');
const path=require('node:path');
const {REPOSITORY_URL}=require('./update-check.cjs');
const {canSend}=require('./window-lifecycle.cjs');
const dialogs=new Map();
ipcMain.handle('update:initial',event=>dialogs.get(event.sender.id)?.state||null);
ipcMain.handle('update:apply',event=>{const dialog=dialogs.get(event.sender.id);if(!dialog||dialog.state.status!=='available')return false;return dialog.apply();});
ipcMain.handle('update:repository',event=>dialogs.has(event.sender.id)?shell.openExternal(REPOSITORY_URL):false);
ipcMain.handle('update:ignore-reminders',(event,value)=>{const dialog=dialogs.get(event.sender.id);return dialog&&typeof value==='boolean'&&typeof dialog.onIgnoreReminders==='function'?dialog.onIgnoreReminders(value):false;});
ipcMain.on('update:close',event=>{const dialog=dialogs.get(event.sender.id);if(dialog&&dialog.state.status!=='updating')dialog.window.close();});
class UpdateDialog {
  constructor({parent,presentation,ignoreUpdateReminders=false,onIgnoreReminders,onApply,onClose}) {
    this.state={status:'checking',message:'正在检查更新…',comparisons:[],theme:presentation.theme,ignoreUpdateReminders};this.onApply=onApply;this.onIgnoreReminders=onIgnoreReminders;
    this.window=new BrowserWindow({parent,modal:true,width:470,height:480,resizable:false,show:false,title:'检查更新',backgroundColor:presentation.theme==='dark'?'#21333d':'#ffffff',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'update-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    this.window.setMenuBarVisibility(false);this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.window.webContents.on('will-navigate',event=>event.preventDefault());
    dialogs.set(this.window.webContents.id,this);const id=this.window.webContents.id;
    this.window.on('closed',()=>{dialogs.delete(id);onClose?.(this);});
    this.ready=this.window.loadFile(path.join(__dirname,'update.html')).then(()=>{this.publish();if(!this.window.isDestroyed())this.window.show();}).catch(error=>{if(!this.window.isDestroyed())throw error;});
  }
  set(value){this.state={...this.state,...value};if(!this.window.isDestroyed())this.window.setClosable(this.state.status!=='updating');this.publish();}
  publish(){if(canSend(this.window))this.window.webContents.send('update:state',this.state);}
  focus(){if(!this.window.isDestroyed())this.window.show();}
  async apply(){if(this.state.status!=='available')return false;this.set({status:'updating',message:'正在准备更新…'});try{return await this.onApply(this);}catch(error){this.set({status:'error',message:'更新未完成',detail:error.message});return false;}}
}
module.exports={UpdateDialog};
