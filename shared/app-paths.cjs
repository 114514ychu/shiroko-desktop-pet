const path = require('node:path');
const fs = require('node:fs');
function applicationPaths(app, argv=process.argv) {
  const testing = argv.some(a=>a.startsWith('--self-test'));
  const profile = testing && argv.find(a=>a.startsWith('--test-profile='))?.slice(15);
  const bundleRoot=path.dirname(app.getPath('exe')),marker=path.join(bundleRoot,'portable.json');let portable=false,portableRoot;
  if(fs.existsSync(marker)){
    const config=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(config.schemaVersion!==1||config.dataDirectory!=='Data')throw Error('便携版配置无效，请保留原始 portable.json。');
    portable=true;portableRoot=path.join(bundleRoot,'Data');
  }
  const root = profile ? path.resolve(profile) : portableRoot || path.join(app.getPath('appData'),'ShirokoPet');
  const result = { root, console:path.join(root,'console'), roles:path.join(root,'students'), qa:path.join(root,'diagnostics') };
  for (const value of Object.values(result)) fs.mkdirSync(value,{recursive:true});
  Object.assign(result,{portable,bundleRoot});
  return result;
}
module.exports={ applicationPaths };
