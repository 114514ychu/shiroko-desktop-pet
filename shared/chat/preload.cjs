const { contextBridge, ipcRenderer } = require('electron');
const channel = process.argv.find(arg => arg.startsWith('--pet-chat-channel='))?.slice('--pet-chat-channel='.length);
contextBridge.exposeInMainWorld('petChat', {
  invoke: value => ipcRenderer.invoke(channel + ':invoke', value),
  input: value => ipcRenderer.send(channel + ':input', value),
  onEvent: callback => ipcRenderer.on(channel + ':event', (_, value) => callback(value))
});
