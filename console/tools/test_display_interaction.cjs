// Native desktop regression, using console's isolated QA profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
exports.run = async (c, runtime) => {
  const output = path.join(c.QA, 'display-interaction');
  fs.mkdirSync(output, { recursive: true });
  const pet = runtime.petWindow();
  const read = () => pet.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('scene'), probe = document.createElement('canvas');
    probe.width = 100; probe.height = 100;
    const ctx = probe.getContext('2d'); ctx.drawImage(canvas, 0, 0, 100, 100);
    const pixels = ctx.getImageData(0, 0, 100, 100).data;
    let visible = 0; for(let i=3;i<pixels.length;i+=4) if(pixels[i]>32) visible++;
    return {visible, ...document.body.dataset, hidden:document.hidden};
  })()`);
  const audit = [];
  async function sample(label) {
    const data = {label, nativeVisible:pet.isVisible(), ...await read()};
    audit.push(data);
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
    assert.ok(data.visible > 100, label + ': visible model pixels, got ' + data.visible);
    fs.writeFileSync(path.join(output, label + '.png'), (await pet.capturePage()).toPNG());
    return data;
  }
  await delay(500);
  await sample('startup');
  const contextLoss = await pet.webContents.executeJavaScript(`(() => {
    const canvas = document.getElementById('scene');
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext(); return true;
  })()`);
  assert.ok(contextLoss, 'native GPU context-loss extension available');
  await delay(100);
  const lost = await read();
  assert.equal(lost.visible, 0, 'context loss reproduces the transparent/vanished model');
  const recoveryDeadline = Date.now() + 7000;
  let recovered;
  while (Date.now() < recoveryDeadline) {
    try { recovered = await read(); if (recovered.visible > 100) break; } catch {}
    await delay(50);
  }
  assert.ok(recovered?.visible > 100, 'model automatically recovers after native GPU context loss');
  assert.equal(recovered.renderContext, 'restored', 'native GPU context is restored without reloading');
  assert.equal(recovered.contextRecoveries, '1', 'one GPU restoration completed');
  await sample('context-recovered');
  const blockedRestore = await pet.webContents.executeJavaScript(`(() => {
    const extension = document.getElementById('scene').getContext('webgl2').getExtension('WEBGL_lose_context');
    const blocked = () => {};
    extension.restoreContext = blocked;
    if (extension.restoreContext !== blocked) return false;
    window.__contextRecoveryTestPage = true;
    extension.loseContext(); return true;
  })()`);
  assert.ok(blockedRestore, 'driver-refusal fallback can be exercised');
  await delay(100);
  assert.equal((await read()).visible, 0, 'blocked restoration leaves the model transparent');
  const fallbackDeadline = Date.now() + 7000;
  let fallback;
  while (Date.now() < fallbackDeadline) {
    try { fallback = await read(); if (fallback.visible > 100) break; } catch {}
    await delay(50);
  }
  assert.ok(fallback?.visible > 100, 'model recovers even when the driver refuses restoration');
  assert.equal(await pet.webContents.executeJavaScript('Boolean(window.__contextRecoveryTestPage)'), false, 'fallback recreates the view');
  await sample('context-reload-recovered');
  for (const variant of runtime.snapshot().variants) {
    runtime.command({name:'variant',value:variant.id});
    const deadline = Date.now()+15000;
    while(!runtime.snapshot().ready && Date.now()<deadline) await delay(20);
    assert.ok(runtime.snapshot().ready, variant.id + ': ready');
    await delay(250); await sample(variant.id+'-visible');
    runtime.setVisible(false); await delay(150);
    runtime.setVisible(true); await delay(350);
    const before = await sample(variant.id+'-restored');
    await delay(350);
    const after = await read();
    assert.ok(Number(after.renderFrames)>Number(before.renderFrames), variant.id+': animation advances without focus');
  }
  fs.writeFileSync(path.join(output,'validation.json'),JSON.stringify({ok:true,at:new Date().toISOString(),audit},null,2));
  console.log('Native display checks passed: GPU restoration, reload fallback, four outfits, hide/show, inactive animation.');
};
