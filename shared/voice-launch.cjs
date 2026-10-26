const fs=require('node:fs'),path=require('node:path');

// Keep the optional CUDA packages inside the component so it remains movable.
// The original CPU runtime stays intact and is used after a failed GPU startup.
const bootstrap=String.raw`
import sys, runpy
sys.path.insert(0, sys.argv[1])
sys.argv = sys.argv[2:]
import torch, yaml
device = 'cpu'
try:
    if torch.cuda.is_available():
        probe = torch.ones(1, device='cuda') * 2
        torch.cuda.synchronize()
        del probe
        device = 'cuda'
except Exception as error:
    print('CUDA probe failed; using CPU: ' + str(error), flush=True)
config = sys.argv[sys.argv.index('-c') + 1]
with open(config, 'r', encoding='utf-8') as stream:
    data = yaml.safe_load(stream)
data['custom']['device'] = device
data['custom']['is_half'] = device == 'cuda'
with open(config, 'w', encoding='utf-8') as stream:
    yaml.safe_dump(data, stream, allow_unicode=True)
print('SHIROKO_DEVICE=' + device, flush=True)
runpy.run_path(sys.argv[0], run_name='__main__')
`;

function voiceLaunch({base,script,config,port,forceCpu=false}){
 const args=[script,'-a','127.0.0.1','-p',String(port),'-c',config];
 if(!forceCpu){try{
  const meta=JSON.parse(fs.readFileSync(path.join(base,'accelerator.json'),'utf8'));
  if(meta.schemaVersion!==1||typeof meta.sitePackages!=='string')throw Error('invalid accelerator');
  const packages=path.resolve(base,...meta.sitePackages.split('/'));
  if(!packages.startsWith(path.resolve(base)+path.sep)||!fs.statSync(path.join(packages,'torch','version.py')).isFile()||!fs.statSync(path.join(packages,'torch','lib','torch_cuda.dll')).isFile())throw Error('invalid CUDA packages');
  return {args:['-u','-c',bootstrap,packages,...args],accelerated:true};
 }catch{}}
 return {args:['-u',...args],accelerated:false};
}
module.exports={voiceLaunch};
