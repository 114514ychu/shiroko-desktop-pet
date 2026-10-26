const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');let count=0;
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','dist','.git','assets'].includes(entry.name))continue;const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else if(/\.(cjs|mjs|js)$/.test(file)){const r=cp.spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(r.status!==0){process.stderr.write(r.stderr||r.stdout);process.exit(r.status||1)}count++}}}
for(const dir of ['console','characters','shared','tools'])walk(path.join(root,dir));
console.log(`Syntax checked ${count} JavaScript files. Game assets and voice runtimes are separate.`);
