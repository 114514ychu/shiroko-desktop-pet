const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
function metadata(root=ROOT){return JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));}
function electronPath(root=ROOT){
  const version=metadata(root).dependencies.electron;
  const candidates=[path.join(root,'runtime','electron-'+version,'electron.exe'),path.join(root,'node_modules/electron/dist/electron.exe')];
  const found=candidates.find(file=>fs.existsSync(file));
  if(!found)throw Error('公共运行环境尚未准备，请双击启动桌宠控制台。');
  return found;
}
function threeDirectory(root=ROOT){
  const directory=path.join(root,'node_modules/three'),expected=metadata(root).dependencies.three;
  if(JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8')).version!==expected)throw Error('公共 Three.js 版本不匹配，请重新准备运行环境。');
  return directory;
}
function assertCompatible(student,root=ROOT){
  const shared=metadata(root).runtime || metadata(root).dependencies;
  for(const key of ['electron','three'])if(student.dependencies?.[key]!==shared[key])throw Error('此学生需要不同的公共运行环境，请更新控制台。');
  return threeDirectory(root);
}
module.exports={ROOT,metadata,electronPath,threeDirectory,assertCompatible};
