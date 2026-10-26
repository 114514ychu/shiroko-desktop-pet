// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const {BrowserWindow,ipcMain}=require('electron');
const path=require('node:path');
const {canSend}=require('./window-lifecycle.cjs');
const dialogs=new Map();
ipcMain.handle('about:initial',event=>dialogs.get(event.sender.id)?.state||null);
ipcMain.on('about:close',event=>{const value=dialogs.get(event.sender.id);if(value&&!value.window.isDestroyed())value.window.close();});
class AboutDialog {
  constructor({parent,presentation,onClose}) {
    this.state={...presentation};
    this.window=new BrowserWindow({parent,modal:true,width:470,height:300,resizable:false,show:false,title:'关于桌宠控制台',backgroundColor:presentation.theme==='dark'?'#21333d':'#ffffff',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'about-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    this.window.setMenuBarVisibility(false);this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.window.webContents.on('will-navigate',event=>event.preventDefault());
    const id=this.window.webContents.id;dialogs.set(id,this);
    this.window.on('closed',()=>{dialogs.delete(id);onClose?.(this);});
    this.ready=this.window.loadFile(path.join(__dirname,'about.html')).then(()=>{this.publish();if(!this.window.isDestroyed())this.window.show();}).catch(error=>{if(!this.window.isDestroyed())throw error;});
  }
  set(value){this.state={...this.state,...value};this.publish();}
  publish(){if(canSend(this.window))this.window.webContents.send('about:state',this.state);}
  focus(){if(!this.window.isDestroyed())this.window.show();}
}
module.exports={AboutDialog};
