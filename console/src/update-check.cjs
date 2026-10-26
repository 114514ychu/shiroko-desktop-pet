// Copyright (c) 2026 B站Absdasbdsa. Mulan PSL v2.
const REPOSITORY_URL = 'https://gitee.com/chenmaoran/codex-pet';
const MANIFEST_URL = REPOSITORY_URL + '/raw/master/pets.json';

function versionParts(value) {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) throw new Error('仓库版本格式不正确');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('仓库版本格式不正确');
  return parts;
}
function compareVersions(left, right) {
  const a = versionParts(left), b = versionParts(right);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
function entries(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.repository !== REPOSITORY_URL ||
      manifest.console?.path !== 'console' || !Array.isArray(manifest.pets)) throw new Error('仓库版本清单不正确');
  const values = [{ id: 'console', name: '桌宠控制台', version: manifest.console.version }];
  for (const role of manifest.pets) {
    if (role.category !== '3D') continue;
    if (!/^[a-z0-9-]+$/.test(role.id) || role.id === 'console' || role.path !== 'characters/' + role.id ||
        typeof role.name !== 'string' || role.name.length > 80) throw new Error('仓库学生清单不正确');
    values.push({ id: role.id, name: role.name, version: role.version });
  }
  for (const value of values) versionParts(value.version);
  if (new Set(values.map(value => value.id)).size !== values.length) throw new Error('仓库学生清单包含重复项');
  return values;
}
function compareManifests(local, published) {
  const installed = new Map(entries(local).map(value => [value.id, value]));
  const comparisons = entries(published).map(value => {
    const current = installed.get(value.id);
    return { id: value.id, name: current?.name || value.name, local: current?.version || null,
      published: value.version, relation: current ? compareVersions(value.version, current.version) : 1 };
  });
  const status = comparisons.some(value => value.relation < 0) ? 'ahead' :
    comparisons.some(value => value.relation > 0) ? 'available' : 'current';
  const message = { available: '发现可用更新', ahead: '本地版本高于仓库已发布版本', current: '已是仓库最新版本' }[status];
  return { status, message, repository: REPOSITORY_URL, comparisons,
    detail: comparisons.map(value => value.name + '：' + (value.local ? '本地 v' + value.local : '尚未安装') + ' · 仓库 v' + value.published).join('\n') };
}
async function readPublishedManifest(fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(MANIFEST_URL, {
    signal: AbortSignal.timeout(10000), cache: 'no-store', credentials: 'omit',
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error('仓库请求失败：HTTP ' + response.status);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 512 * 1024) throw new Error('仓库版本清单过大');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('仓库未返回有效的版本清单'); }
  entries(value);
  return value;
}
module.exports = { REPOSITORY_URL, MANIFEST_URL, compareVersions, compareManifests, readPublishedManifest };
