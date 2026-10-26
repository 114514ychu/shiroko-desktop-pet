const fs=require('node:fs'),path=require('node:path');
const mapping=paths=>[['console/.runtime/preferences.json',path.join(paths.console,'preferences.json')],['characters/sunaookami-shiroko/.runtime/preferences.json',path.join(paths.roles,'sunaookami-shiroko/preferences.json')]];
function stageImport(base,paths){
  const records=[];
  for(const [source] of mapping(paths)){const file=path.join(base,source);if(!fs.existsSync(file))continue;const value=JSON.parse(fs.readFileSync(file,'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('旧版设置格式无效。');records.push({source,value});}
  if(records.length){const file=path.join(paths.root,'pending-import.json');fs.writeFileSync(file+'.tmp',JSON.stringify(records));fs.renameSync(file+'.tmp',file);}
  return records.length;
}
function applyPendingImport(paths){
  const file=path.join(paths.root,'pending-import.json');if(!fs.existsSync(file))return;
  const records=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(records))throw Error('待导入设置格式无效。');
  for(const [source,target] of mapping(paths)){const entry=records.find(v=>v.source===source);if(!entry)continue;fs.mkdirSync(path.dirname(target),{recursive:true});if(fs.existsSync(target))fs.copyFileSync(target,target+'.before-import');fs.writeFileSync(target+'.tmp',JSON.stringify(entry.value,null,2));fs.renameSync(target+'.tmp',target);}
  fs.rmSync(file);
}
module.exports={stageImport,applyPendingImport};
