// A timeout releases the preview loop, but cannot cancel executeJavaScript.
// Keep the runtime busy until its actual capture settles to avoid queuing
// unlimited captures behind an unresponsive renderer.
function createThumbnailRequests() {
  const pending = new WeakSet();
  return async function requestThumbnail(runtime, timeoutMs = 3000) {
    if (pending.has(runtime)) return null;
    pending.add(runtime);
    const capture = Promise.resolve().then(() => runtime.thumbnail()).catch(() => null)
      .finally(() => pending.delete(runtime));
    let timer;
    try {
      return await Promise.race([capture, new Promise(resolve => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
}
module.exports = { createThumbnailRequests };
