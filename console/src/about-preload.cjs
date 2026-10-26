const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('petAbout',{initial:()=>ipcRenderer.invoke('about:initial'),close:()=>ipcRenderer.send('about:close'),onState:callback=>ipcRenderer.on('about:state',(_event,value)=>callback(value))});
