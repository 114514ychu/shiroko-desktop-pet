const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shiroko-native-test-'));
const electron=require('electron');
const root=path.resolve(__dirname,'..');
console.log('Native test profile (kept for diagnostics):',profile);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=cp.spawn(electron,[root,'--self-test-standalone',`--test-profile=${profile}`],{stdio:'inherit',env});
child.on('error',error=>{console.error(error);process.exitCode=1;});
child.on('exit',(code,signal)=>{if(signal)console.error('Electron exited with signal:',signal);process.exitCode=code??1;});
