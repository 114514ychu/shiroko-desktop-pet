// Run through console --self-test-dsh --self-test-pointer-bubbles (isolated QA data).
// Exercises native windows with Electron input; physical pointer routing needs a manual check.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await check()) return; await delay(20); }
  throw Error('Timed out: ' + label);
}
exports.run = async (c, runtime) => {
  const output = path.join(c.QA, 'pointer-bubbles'); fs.mkdirSync(output, { recursive: true });
  const pet = runtime.petWindow(), overlay = runtime.chatWindow();
  const evaluate = script => pet.webContents.executeJavaScript(script);
  const bubble = script => overlay.webContents.executeJavaScript(script);
  const audit = [];
  overlay.webContents.setAudioMuted(true);
  c.monitor.stop(); c.monitor.snapshot = { state: 'idle', label: '待机', connected: false };
  c.monitor.emit('change', c.monitor.snapshot);
  runtime.command({ name: 'codexFollow', value: false });
  runtime.command({ name: 'auto' });
  c.win.hide();
  try {
    for (const variant of runtime.snapshot().variants) {
      runtime.command({ name: 'variant', value: variant.id });
      await until(() => runtime.snapshot().ready && runtime.snapshot().config.variant === variant.id, variant.id);
      await until(async () => await evaluate("document.body.dataset.ready==='true' && document.body.dataset.variant===" + JSON.stringify(variant.id)), 'render ready');
      await bubble("close(); window.pointerAudit=[]; if(!window.pointerAuditInstalled){window.pointerAuditInstalled=true;petChat.onEvent(event=>{if(event.type==='task')pointerAudit.push({at:performance.now(),...event.value});});} true");
      await evaluate(`window.pointerAudio=[]; window.pointerEvents=[];
        if(!window.pointerEventsInstalled){window.pointerEventsInstalled=true;for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.getElementById('scene').addEventListener(type,e=>pointerEvents.push({type:e.type,at:performance.now()}));}
        if(!window.PointerNativeAudio){window.PointerNativeAudio=Audio;window.Audio=function(...args){const a=new PointerNativeAudio(...args);a.addEventListener('playing',()=>pointerAudio.push({at:performance.now(),src:a.src}));return a;};}
        true;`);
      const point = await evaluate(`(()=>{const c=document.getElementById('scene'),r=c.getBoundingClientRect(),s=document.createElement('canvas');s.width=c.width;s.height=c.height;const ctx=s.getContext('2d');ctx.drawImage(c,0,0);const b=ctx.getImageData(0,0,s.width,s.height).data;for(let y=Math.round(r.height*.55);y<r.height*.8;y++)for(let x=Math.round(r.width*.5);x<r.width*.7;x++){const px=Math.floor(x*c.width/r.width),py=Math.floor(y*c.height/r.height);if(b[(py*c.width+px)*4+3]>240)return {x:Math.round(r.left+x),y:Math.round(r.top+y)};}throw Error('No hit point');})()`);
      const input = type => pet.webContents.sendInputEvent({ type, button: 'left', clickCount: 1, ...point });
      // Keep the pet focused and avoid further pointer movement during subtitle assertions.
      pet.setIgnoreMouseEvents(false); pet.show(); pet.focus();
      input('mouseMove'); input('mouseDown'); await delay(35); input('mouseUp');
      await until(async () => await evaluate('pointerAudio.length>0'), 'click audio starts');
      await delay(200);
      const clicked = { variant: variant.id, kind: 'click', source: await evaluate("({hidden:document.getElementById('bubble').hidden,text:document.getElementById('bubble').textContent,events:pointerEvents})"), overlay: await bubble("({expanded,text:document.getElementById('reply').textContent,width:innerWidth,frames:pointerAudit})"), bounds: overlay.getBounds() };
      audit.push(clicked); fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
      assert.equal(clicked.source.hidden, false, 'click subtitle is live');
      assert.equal(clicked.overlay.expanded, true, 'click subtitle expands while pointer remains on pet');
      assert.ok(clicked.bounds.width >= 180, 'click subtitle native window resizes without moving pointer');
      fs.writeFileSync(path.join(output, variant.id + '-click.png'), (await overlay.capturePage()).toPNG());
      runtime.command({ name: 'dialogueStop' }); await delay(100);
      await evaluate('pointerAudio.length=0;true');
      pet.focus(); input('mouseDown');
      await until(async () => await evaluate("document.body.dataset.pickupActive==='true'"), 'pickup starts');
      await until(async () => await evaluate('pointerAudio.length>0'), 'pickup audio starts');
      await delay(200);
      const held = { variant: variant.id, kind: 'pickup', source: await evaluate("({hidden:document.getElementById('bubble').hidden,text:document.getElementById('bubble').textContent,pickup:document.body.dataset.pickupActive,events:pointerEvents})"), overlay: await bubble("({expanded,text:document.getElementById('reply').textContent,width:innerWidth,frames:pointerAudit})"), bounds: overlay.getBounds() };
      audit.push(held); fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
      assert.equal(held.source.pickup, 'true', 'subtitle does not steal focus/cancel pickup');
      assert.equal(held.source.hidden, false, 'pickup subtitle is live');
      assert.equal(held.overlay.expanded, true, 'pickup subtitle is visible while held');
      assert.ok(held.bounds.width >= 180, 'pickup subtitle native window expands');
      fs.writeFileSync(path.join(output, variant.id + '-pickup.png'), (await overlay.capturePage()).toPNG());
      input('mouseUp'); runtime.command({ name: 'dialogueStop' });
      await until(async () => await bubble('!expanded'), 'subtitle closes after release/stop');
    }
    fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ ok: true, at: new Date().toISOString(), audit, physicalMouseRoutingTested: false, realApiRequests: 0, realTtsRequests: 0 }, null, 2));
    console.log('Pointer bubble checks passed: click and held pickup, four outfits, real audio/IPC/native windows.');
  } finally {
    pet.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 0, y: 0 });
    runtime.command({ name: 'dialogueStop' });
  }
};
