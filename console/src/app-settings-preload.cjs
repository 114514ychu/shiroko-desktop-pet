const {contextBridge,ipcRenderer}=require('electron');
let resolve;const ready=new Promise(r=>resolve=r);
ipcRenderer.once('app-settings:channel',(_event,channel)=>resolve(channel));
contextBridge.exposeInMainWorld('appSettings',{invoke:async(action,value)=>ipcRenderer.invoke(await ready,action,value)});
