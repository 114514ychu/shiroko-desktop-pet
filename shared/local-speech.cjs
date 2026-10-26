const http = require('node:http');

function connectionError(message, cause) {
  return Object.assign(new Error(message, { cause }), { code: cause?.code || 'ECONNRESET' });
}

function createLocalSpeech({ endpoint, ref_audio_path, prompt_text, prompt_lang = 'ja', text_lang = 'zh', timeoutMs = 120000, maxBytes = 16 * 1024 * 1024 }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || url.username || url.password) throw Error('语音接口必须是本机 HTTP 服务。');
  function synthesize(text, signal) {
    if (typeof text !== 'string' || !text.trim() || text.length > 6000) return Promise.reject(Error('语音文字为空或过长。'));
    return new Promise((resolve, reject) => {
      let req, response, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) { req?.destroy(); response?.destroy(); reject(error); } else resolve(value);
      };
      const abort = () => finish(Error('语音已取消。'));
      const timer = setTimeout(() => finish(Error('语音合成超时，文字回复仍可查看。')), timeoutMs);
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      const body = JSON.stringify({ text: text.trim(), text_lang, ref_audio_path, prompt_text, prompt_lang, media_type: 'wav', streaming_mode: false });
      req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        response = res;
        const httpError = res.statusCode !== 200 ? Error('本地语音合成失败（HTTP ' + res.statusCode + '），文字回复仍可查看。') : null;
        let length = 0; const chunks = [];
        res.on('data', chunk => {
          if (settled) return;
          length += chunk.length;
          if (length > (httpError ? 16384 : maxBytes)) { finish(httpError || Error('合成音频过大，已停止播放。')); return; }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          const audio = Buffer.concat(chunks);
          if (httpError) {
            // GPT-SoVITS can keep HTTP alive after its CUDA context has failed.
            // Only explicit backend CUDA exceptions qualify for device fallback.
            try {
              const detail = JSON.parse(audio.toString('utf8')).Exception;
              if (typeof detail === 'string' && /^(?:CUDA (?:error:|out of memory\b)|cuDNN error:|cuBLAS error:)/i.test(detail)) {
                httpError.code = 'ECUDA';
                httpError.cause = new Error(detail);
              }
            } catch {}
            finish(httpError); return;
          }
          if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') { finish(Error('语音服务未返回有效 WAV 音频。')); return; }
          finish(null, { mime: 'audio/wav', audioBase64: audio.toString('base64') });
        });
        res.on('aborted', () => finish(connectionError('语音传输中断，请重试。')));
        res.on('error', error => finish(connectionError('语音传输失败，请重试。', error)));
      });
      req.on('error', error => finish(connectionError(error.code === 'ECONNREFUSED' ? '本地语音服务未启动，请启动 9880 服务。' : '连接本地语音服务失败，文字回复仍可查看。', error)));
      req.end(body);
    });
  }
  return { synthesize };
}
module.exports = { createLocalSpeech };
