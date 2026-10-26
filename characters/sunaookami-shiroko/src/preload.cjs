const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kisakiDesktop', {
  bubble: value => ipcRenderer.send('pet-sunaookami-shiroko:bubble', value),
  initial: () => ipcRenderer.invoke('pet-sunaookami-shiroko:initial'),
  layout: value => ipcRenderer.invoke('pet-sunaookami-shiroko:layout', value),
  capture: dataUrl => ipcRenderer.invoke('pet-sunaookami-shiroko:capture', dataUrl),
  qaFrame: (clip, dataUrl, tag, variant) => ipcRenderer.invoke('pet-sunaookami-shiroko:qa-frame', { clip, dataUrl, tag, variant }),
  dialogue: value => ipcRenderer.invoke('pet-sunaookami-shiroko:dialogue', value),
  command: (name, value) => ipcRenderer.send('pet-sunaookami-shiroko:command', { name, value }),
  hitTest: value => ipcRenderer.send('pet-sunaookami-shiroko:hit-test', Boolean(value)),
  drag: phase => ipcRenderer.send('pet-sunaookami-shiroko:drag', phase),
  report: value => ipcRenderer.send('pet-sunaookami-shiroko:renderer-report', value),
  onSnapshotRequest: callback => { ipcRenderer.on('pet-sunaookami-shiroko:snapshot-request', (_, id) => ipcRenderer.send('pet-sunaookami-shiroko:playback-snapshot', { id, player: callback() })); },
  onState: callback => { ipcRenderer.on('pet-sunaookami-shiroko:state', (_, value) => callback(value)); },
  onCommand: callback => { ipcRenderer.on('pet-sunaookami-shiroko:renderer-command', (_, value) => callback(value)); },
  onCursor: callback => { ipcRenderer.on('pet-sunaookami-shiroko:cursor', (_, value) => callback(value)); }
});
