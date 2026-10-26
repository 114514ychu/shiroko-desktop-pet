export function tailLoopPolicy(name, duration, profiles = {}) {
  const configured = profiles[name];
  if (!configured || !Number.isFinite(duration) || duration <= 0) return null;
  const start = Math.max(0, Number(configured.start));
  const end = Math.min(duration - 0.001, Number(configured.end ?? duration - 0.03));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 0.2) return null;
  const blend = Math.max(0.02, Math.min(Number(configured.blend) || 0.16, (end - start) / 4));
  const proposedAmplitude = Number(configured.amplitude ?? 0.4);
  const amplitude = Number.isFinite(proposedAmplitude) ? Math.max(0.05, Math.min(1, proposedAmplitude)) : 0.4;
  const selectedParts = Array.isArray(configured.parts) ? [...new Set(configured.parts.filter(part => typeof part === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(part)))] : [];
  const parts = selectedParts.length ? selectedParts : ['hair', 'coat', 'skirt'];
  const poseTime = Math.max(0, Math.min(duration - 0.001, Number(configured.poseTime ?? duration - 0.001)));
  if (!Number.isFinite(poseTime)) return null;
  return { start, end, blend, speed: 1, amplitude, parts, poseTime };
}
export function tailTransitionDue(time, delta, policy, timeScale = 1) { return Boolean(policy && delta > 0 && time + delta * timeScale >= policy.end - policy.blend * timeScale); }
export function isAmbientBone(name, parts, boneGroups = {}) {
  return (parts ?? Object.keys(boneGroups)).some(part => Array.isArray(boneGroups[part]) && boneGroups[part].includes(name));
}
export function isAmbientTrack(name, parts, boneGroups) {
  const separator = name.lastIndexOf('.');
  return separator > 0 && isAmbientBone(name.slice(0, separator), parts, boneGroups) && ['position', 'quaternion'].includes(name.slice(separator + 1));
}
