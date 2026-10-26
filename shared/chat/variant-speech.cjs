const http = require('node:http');
const { createLocalSpeech } = require('../local-speech.cjs');

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 120000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(Error('语音权重切换失败（HTTP ' + res.statusCode + '）')); return; }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(Error('语音权重切换超时。')));
  });
}

// 同一个本地 GPT-SoVITS 服务（9880）按当前服装热切换音色权重：
// 默认/骑行/泳装 -> 默认白子权重；恐怖的服装 -> 恐怖白子权重。
function createVariantSpeech({ endpoint, variants, getVariant, initialVariant = null }) {
  if (!endpoint || !variants || typeof getVariant !== 'function') throw Error('createVariantSpeech 参数不完整。');
  const root = String(endpoint).replace(/\/+$/, '').replace(/\/tts$/, '');
  const speech = new Map();
  // Only the service that launched Python may attest to its initial weights.
  let loaded = initialVariant && variants[initialVariant] ? initialVariant : null;
  let warmed = null;
  let queue = Promise.resolve();
  function speechFor(key) {
    if (!speech.has(key)) {
      const v = variants[key];
      speech.set(key, createLocalSpeech({
        endpoint, ref_audio_path: v.ref_audio_path, prompt_text: v.prompt_text,
        prompt_lang: v.prompt_lang || 'ja', text_lang: v.text_lang || 'ja'
      }));
    }
    return speech.get(key);
  }
  async function switchTo(key) {
    if (key === loaded) return;
    const v = variants[key];
    loaded = null;
    warmed = null;
    await getJson(root + '/set_gpt_weights?weights_path=' + encodeURIComponent(v.gpt_weights));
    await getJson(root + '/set_sovits_weights?weights_path=' + encodeURIComponent(v.sovits_weights));
    loaded = key;
  }
  function variantKey() {
    try { const key = getVariant(); if (key && variants[key]) return key; } catch {}
    return 'default';
  }
  return {
    prepare(signal) {
      const key = variantKey();
      const run = queue.then(async () => { signal?.throwIfAborted(); await switchTo(key); signal?.throwIfAborted(); });
      queue = run.then(() => {}, () => {});
      return run;
    },
    warmup(text, signal) {
      const key = variantKey();
      const run = queue.then(async () => { signal?.throwIfAborted(); await switchTo(key); signal?.throwIfAborted(); if (warmed !== key) { await speechFor(key).synthesize(text, signal); warmed = key; } });
      queue = run.then(() => {}, () => {});
      return run;
    },
    synthesize(text, signal) {
      const key = variantKey();
      const run = queue.then(async () => { signal?.throwIfAborted(); await switchTo(key); signal?.throwIfAborted(); const result = await speechFor(key).synthesize(text, signal); warmed = key; return result; });
      queue = run.then(() => {}, () => {});
      return run;
    },
    reset() { return queue.then(() => switchTo('default')).catch(() => {}); }
  };
}

module.exports = { createVariantSpeech };
