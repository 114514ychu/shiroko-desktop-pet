const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg' };

function resolvePublicPath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  if (decoded === '/') decoded = '/src/index.html';
  const allowed = ['/src/index.html', '/src/renderer.js', '/src/dialogue.mjs', '/src/state-actions.mjs', '/src/source-outline.mjs', '/src/render-surface.mjs', '/src/animation-policy.mjs', '/src/source-compatibility.mjs', '/src/style.css', '/assets/', '/node_modules/three/'];
  if (!allowed.some(p => p.endsWith('/') ? decoded.startsWith(p) : decoded === p)) return null;
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  if (decoded.split('/').includes('..')) return null;
  if (decoded.startsWith('/node_modules/three/')) {
    const relative = decoded.slice('/node_modules/three/'.length);
    const shared = require('../../../tools/runtime-paths.cjs').threeDirectory();
    const candidate = path.resolve(shared, relative);
    return candidate.startsWith(shared + path.sep) ? candidate : null;
  }
  const resolved = path.resolve(ROOT, '.' + decoded);
  if (!resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function createServer(port = 0) {
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let pathname;
    try { pathname = new URL(req.url, 'http://127.0.0.1').pathname; } catch { res.writeHead(400); res.end(); return; }
    const file = resolvePublicPath(pathname);
    if (!file) { res.writeHead(404); res.end(); return; }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Content-Length': stat.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': file.includes(path.sep + 'assets' + path.sep) ? 'public,max-age=3600' : 'no-cache',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self'; connect-src 'self' blob: data:; worker-src 'self' blob:"
      });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
module.exports = { createServer, resolvePublicPath, ROOT };
if (require.main === module) createServer(Number(process.env.KISAKI_PREVIEW_PORT || 43127)).then(({ origin }) => console.log(origin + '/?view=studio')).catch(e => { console.error(e.message); process.exitCode = 1; });
