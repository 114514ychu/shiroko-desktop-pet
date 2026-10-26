// C3DPKG1: bounded JSON file table followed by one gzip stream of file bytes.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const MAGIC=Buffer.from('C3DPKG1\n'),MAX_TOTAL=20*1024**3;
function safeRelative(name){
  if(typeof name!=='string'||!name||name.length>220||/[\\\x00-\x1f<>:"|?*]/.test(name)||name.startsWith('/'))throw Error('安装包路径无效');
  const parts=name.split('/');
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)||['.runtime','.git','.tools'].includes(p.toLowerCase())))throw Error('安装包包含受保护路径');
  return name;
}
function validateHeader(header,expected={}){
  if(header?.schemaVersion!==1||header.platform!=='windows-x64'||!['student','core','voice'].includes(header.type)||!/^\d+\.\d+\.\d+$/.test(header.version)||!Array.isArray(header.files)||!header.files.length||header.files.length>100000)throw Error('安装包清单无效');
  for(const [key,value] of Object.entries(expected))if(header[key]!==value)throw Error('安装包身份或版本不匹配');
  let total=0;const names=new Set();
  for(const file of header.files){safeRelative(file.path);const key=file.path.toLowerCase();if(names.has(key)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>2*1024**3||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('安装包文件清单无效');names.add(key);total+=file.bytes;
    if(header.type==='core'&&!/^(?:console\/|tools\/|distribution\/|runtime\/electron-[\d.]+\/|node_modules\/three\/|package(?:-lock)?\.json$|pets\.json$|distribution\.json$|checksums\.json$|启动桌宠控制台\.(?:cmd|exe)$|LICENSE$|ATTRIBUTION\.md$|ASSET_RIGHTS\.md$|README\.md$)/.test(file.path))throw Error('控制台包文件范围不正确');
  }
  if(total>MAX_TOTAL)throw Error('安装包展开体积过大');return total;
}
async function readHeader(file){
  const handle=await fsp.open(file,'r');try{const prefix=Buffer.alloc(12);if((await handle.read(prefix,0,12,0)).bytesRead!==12||!prefix.subarray(0,8).equals(MAGIC))throw Error('安装包格式不正确');const length=prefix.readUInt32LE(8);if(length<2||length>24*1024**2)throw Error('安装包清单大小无效');const data=Buffer.alloc(length);if((await handle.read(data,0,length,12)).bytesRead!==length)throw Error('安装包清单不完整');return {header:JSON.parse(data.toString('utf8')),offset:12+length};}finally{await handle.close();}
}
async function extractPackage(file,directory,expected={},options={}){
  const {header,offset}=await readHeader(file),total=validateHeader(header,expected);
  await fsp.mkdir(directory,{recursive:true});if((await fsp.readdir(directory)).length)throw Error('安装暂存目录必须为空');
  const source=fs.createReadStream(file,{start:offset}),unzip=zlib.createGunzip();unzip.on('error',()=>{});source.on('error',e=>unzip.destroy(e));source.pipe(unzip);
  const abort=()=>{source.destroy();unzip.destroy(options.signal.reason||Error('安装已取消'));};options.signal?.addEventListener('abort',abort,{once:true});
  let index=0,handle=null,hash=null,written=0,processed=0;
  async function next(){const entry=header.files[index];if(!entry)return;const target=path.join(directory,...entry.path.split('/'));await fsp.mkdir(path.dirname(target),{recursive:true});handle=await fsp.open(target,'wx');hash=crypto.createHash('sha256');written=0;}
  async function finish(){const entry=header.files[index];await handle.close();handle=null;if(hash.digest('hex')!==entry.sha256)throw Error('安装包文件校验失败：'+entry.path);index++;await next();}
  try{
    options.signal?.throwIfAborted();await next();
    for await(const chunk of unzip){let pos=0;while(pos<chunk.length){options.signal?.throwIfAborted();while(handle&&header.files[index].bytes===written)await finish();if(!handle)throw Error('安装包存在多余数据');const part=chunk.subarray(pos,pos+Math.min(chunk.length-pos,header.files[index].bytes-written));await handle.writeFile(part);hash.update(part);written+=part.length;processed+=part.length;pos+=part.length;}options.onProgress?.(processed,total);}
    while(handle&&header.files[index].bytes===written)await finish();if(index!==header.files.length)throw Error('安装包文件不完整');return header;
  }finally{options.signal?.removeEventListener('abort',abort);source.destroy();unzip.destroy();await handle?.close();}
}
async function sha256(file){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);return hash.digest('hex');}
module.exports={MAGIC,safeRelative,validateHeader,readHeader,extractPackage,sha256};
