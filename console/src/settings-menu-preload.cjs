const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('petSettingsMenu', {
  initial: () => ipcRenderer.invoke('settings-menu:initial'),
  action: value => ipcRenderer.invoke('settings-menu:action', value),
  close: () => ipcRenderer.send('settings-menu:close'),
  onState: callback => ipcRenderer.on('settings-menu:state', (_event, value) => callback(value))
});
