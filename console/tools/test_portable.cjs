const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
exports.run=async(c,runtime,out)=>{
 assert.equal(c.app.isPackaged,true);assert.equal(c.APP_PATHS.portable,true);
 assert.equal(c.APP_PATHS.bundleRoot,path.dirname(process.execPath));
 assert.equal(c.services.status().running,false,'opening pet must not load speech models');
 assert.equal(c.appSettings.get().speechEnabled,true);assert.equal(c.appSettings.get().gsvDirectory,'');assert.equal(c.appSettings.get().voiceDirectory,'');
 assert.equal(fs.existsSync(path.join(c.APP_PATHS.root,'chat/deepseek-api-key.bin')),false);
 for(const variant of ['default','riding','swimsuit','terror']){
  runtime.command({name:'variant',value:variant});
  const deadline=Date.now()+20000;while(Date.now()<deadline&&(!runtime.snapshot().ready||runtime.snapshot().config.variant!==variant))await new Promise(r=>setTimeout(r,50));
  assert.equal(runtime.snapshot().config.variant,variant);assert.equal(runtime.snapshot().ready,true);
 }
 await require('./test_microphone.cjs').run(c,runtime,out);
 await require('./test_voice.cjs').run(c,runtime,out);
 assert.ok(c.services.status().directory.startsWith(c.APP_PATHS.bundleRoot+path.sep));
 fs.writeFileSync(path.join(out,'portable-validation.json'),JSON.stringify({ok:true,packaged:true,portableProfile:c.APP_PATHS.root,bundleRoot:c.APP_PATHS.bundleRoot,cleanKey:true,onDemandStartup:true,allFourOutfits:true,offlineASR:true,bothVoices:true,englishSpeech:true,externalChatRequests:0},null,2));
};
