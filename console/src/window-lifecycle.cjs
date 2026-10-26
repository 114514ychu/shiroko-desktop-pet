// A BrowserWindow can still exist after its WebContents has been destroyed.
function canSend(window,quitting=false){return !quitting&&Boolean(window)&&!window.isDestroyed()&&!window.webContents.isDestroyed();}
module.exports={canSend};
