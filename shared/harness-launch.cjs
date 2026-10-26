const fs = require('node:fs');
const { spawn } = require('node:child_process');
function openHarness() {
  const executable = process.env.DSH_DESKTOP_EXE || '';
  if (!fs.existsSync(executable)) return false;
  const child = spawn(executable, [], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', error => console.error('无法打开 DeepSeek Harness：', error.message));
  child.unref();
  return true;
}
module.exports = { openHarness };
