import { createDialogueController, loadDialogue } from './dialogue.mjs';
import * as THREE from 'three';
import { STATE_ACTION_LABELS, resolveStateActions } from './state-actions.mjs';
import { createSourceOutlines } from './source-outline.mjs';
import { createRenderSurface } from './render-surface.mjs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { tailLoopPolicy, tailTransitionDue, isAmbientBone, isAmbientTrack } from './animation-policy.mjs';
import { restoreOriginalCubicCurves, restoreOriginalNormals } from './source-compatibility.mjs';

const $ = id => document.getElementById(id);
const desktop = window.kisakiDesktop;
const view = new URLSearchParams(location.search).get('view') || (desktop ? 'pet' : 'studio');
const studio = view === 'studio';
document.body.classList.toggle('studio', studio);
const initial = desktop ? await desktop.initial() : {
  catalog: await fetch('/assets/catalog.json').then(r => r.json()),
  config: { variant: 'default', gaze: true, codexFollow: false, quality: 'high' },
  state: { state: 'idle', label: '待机', connected: false },
  selfTest: false
};
const catalog = initial.catalog;
let config = { ...initial.config };
let state = initial.state;
let settings = catalog;
let AUTO_CLIPS = resolveStateActions(catalog, config.variant, config.stateActions);
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 100);
let framingUnitsPerPixel = 0, layoutPromise = Promise.resolve(), framingSequence = 0;
let baseStage = initial.baseStage || { width: config.width || $('stage').clientWidth, height: config.height ? config.height - 28 : $('stage').clientHeight };
const nominalStage = { width: $('stage').clientWidth, height: $('stage').clientHeight };
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setPixelRatio(Math.min(window.devicePixelRatio * (studio ? 1 : 2), studio ? 1.5 : 3));
const renderSurface = createRenderSurface(renderer, THREE);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.4, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.09;
controls.enablePan = false;
controls.minDistance = 2.3;
controls.maxDistance = 12;
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.minPolarAngle = 0.3;
controls.maxPolarAngle = Math.PI - 0.3;
const loader = new GLTFLoader();
const pivot = new THREE.Group(); scene.add(pivot);
const hitCanvas = document.createElement('canvas'); hitCanvas.width = hitCanvas.height = 1;
const hitContext = hitCanvas.getContext('2d', { willReadFrequently: true });
const deltaWorld = new THREE.Quaternion();
const parentWorld = new THREE.Quaternion();
const inverseParent = new THREE.Quaternion();
const gazeRotation = new THREE.Euler();
const gaze = new THREE.Vector2();
const gazeTarget = new THREE.Vector2();
let model, mixer, clips = [], actions = new Map(), action, head, headBase;
let meshList = [], variant = config.variant || catalog.default_variant;
let sourceNodeObjects = new Map();
let restPose = [], framingBox, subjectBox, headMetric;
let sceneOverviewActive = false;
const sizeReferences = new Map();
// Model-local, source-pose measurements are independent of window size and playback time.
const animationMeasurements = new Map();
let autoMode = true, paused = false, pickup = false, walking = false;
let beforePickup, leftGesture, rightGesture, lastHit, speed = 1, lastUiTime = 0;
let hitRequest = 0, pendingHit = null;
let modelToken = 0, lastTimestamp = 0, frameCount = 0, lastFpsTime = 0, fps = 0;
let hasRequestedModel = false;
let statusTimer, loadingModel = false, lastCursorHit = 0;
let queuedCommands = [];
let tailPolicy = null, tailActions = [], retiringActions = [], tailActive = false, tailRepeats = 0;
let activeSourceClip, seatedPose = [], anchorAction, ambientBaseAction;
const labels = { idle: '待机', running: '正在思考与处理', waiting: '等你确认', review: '工作完成，来看看', failed: '遇到问题了' };
const shortLabels = { idle: '待机', running: '执行中', waiting: '等待确认', review: '已完成', failed: '失败' };

const dialogue = createDialogueController({
  bubble: $('bubble'), enabled: !studio, initialVolume: initial.dialogueVolume, getVariant: () => variant,
  canStatus: () => renderActive && !loadingModel && Boolean(mixer) && config.codexFollow && autoMode && !paused && !pickup && !walking,
  canIdle: () => renderActive && !loadingModel && Boolean(mixer) && autoMode && !paused && !pickup && !walking && !leftGesture && !rightGesture,
  canPickup: () => renderActive && !loadingModel && Boolean(mixer) && pickup,
  requestAudio: kind => desktop?.dialogue ? desktop.dialogue({ action: 'request', kind }) : 'standalone',
  releaseAudio: lease => desktop?.dialogue?.({ action: 'release', lease })
});
void loadDialogue().then(lines => dialogue.setLines(lines));
const bubbleObserver = new MutationObserver(() => {
  if (!studio) desktop?.bubble?.({ type: 'line', text: $('bubble').textContent, hidden: $('bubble').hidden });
});
if (!studio && desktop?.bubble) {
  document.body.classList.add('external-bubble');
  bubbleObserver.observe($('bubble'), { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
}
function updateHeadBubble() {
  if (studio || !desktop?.bubble || !head || !subjectBox || loadingModel) return;
  const stage = $('stage');
  const projected = head.getWorldPosition(new THREE.Vector3()).project(camera);
  let top = stage.clientHeight;
  for (const x of [subjectBox.min.x, subjectBox.max.x]) for (const y of [subjectBox.min.y, subjectBox.max.y]) for (const z of [subjectBox.min.z, subjectBox.max.z]) {
    const point = new THREE.Vector3(x, y, z).project(camera);
    top = Math.min(top, (1 - point.y) * stage.clientHeight / 2);
  }
  desktop.bubble({ type: 'anchor', x: Math.round((projected.x + 1) * stage.clientWidth / 2), y: Math.round(Math.max(8, Math.min(stage.clientHeight - 30, top - 5))) });
}
const clearIdleBubble = () => dialogue.clearIdle();
const clearPickupBubble = () => dialogue.clearPickup();
const scheduleIdleBubble = delay => dialogue.scheduleIdle(delay);
const schedulePickupBubble = () => dialogue.schedulePickup();

function setStatus(value) {
  state = value;
  if (typeof value.autoMode === 'boolean') autoMode = value.autoMode;
  document.body.dataset.state = value.state;
  $('stateText').textContent = value.label || labels[value.state] || labels.idle;
  updateModeLabel();
  $('connectionText').textContent = value.connected ? value.readTracking ? 'Harness 状态已连接' : 'Harness 任务状态已连接' : '独立 3D 桌面陪伴';
  dialogue.status(config.codexFollow && autoMode ? value.state : 'idle', value.label || labels[value.state] || labels.idle);
  if (autoMode && config.codexFollow && !pickup && !walking && !loadingModel && mixer) playClip(AUTO_CLIPS[value.state] || AUTO_CLIPS.idle, { manual: false });
}
function applyFollow(value) {
  config.codexFollow = Boolean(value); $('follow').checked = config.codexFollow;
  dialogue.status(config.codexFollow && autoMode ? state.state : 'idle', state.label || labels[state.state]);
  // Disabling following selects idle only in automatic mode. Keep a deliberate
  // manual pose, pause or active pickup/walk; release resolves the latest setting.
  if (!config.codexFollow && autoMode && !pickup && !walking && !loadingModel && mixer) {
    const wasPaused = paused;
    playClip(AUTO_CLIPS.idle, { manual: false }); setPaused(wasPaused);
  }
  updateModeLabel();
}
function renderStateActions() {
  const entry = catalog.variants.find(item => item.variant === variant) || catalog.variants[0];
  const defaults = entry.state_animations || catalog.state_animations;
  $('stateActionsFields').replaceChildren(...Object.entries(STATE_ACTION_LABELS).map(([key, label]) => {
    const field = document.createElement('label'); field.className = 'field'; field.textContent = label;
    const select = document.createElement('select'); select.dataset.stateAction = key; select.setAttribute('aria-label', 'Harness ' + label + '动作');
    const fallback = new Option('默认 · ' + defaults[key], ''); select.add(fallback);
    for (const clip of entry.animations) if (clip.name !== defaults[key]) select.add(new Option(clip.name, clip.name));
    select.value = config.stateActions?.[variant]?.[key] || ''; select.disabled = !desktop;
    select.addEventListener('change', () => desktop?.command('stateAction', { variant: entry.variant, state: key, clip: select.value }));
    field.append(select); return field;
  }));
}
function updateModeLabel() {
  $('autoState').textContent = '当前：' + (state.state === 'review' && state.needsReview ? '待查看' : shortLabels[state.state] || shortLabels.idle) + (autoMode ? config.codexFollow ? ' · 自动' : ' · 跟随已关闭' : ' · 手动，请恢复自动陪伴');
  document.body.dataset.autoMode = String(autoMode);
}

const outlineLayers = new Map();
function drawScene() {
  let count=0,cssWidth=0;
  for(const layer of outlineLayers.values()) {
    const metric=layer.update(camera,$('stage').clientHeight,studio ? nominalStage.height : baseStage.height);
    count+=metric.meshCount;cssWidth=metric.cssWidth;
  }
  document.body.dataset.outlineMeshes=String(count);
  document.body.dataset.outlineEnabled=String([...outlineLayers.values()].every(layer=>layer.enabled));
  document.body.dataset.outlineCSSWidth=String(cssWidth);
  renderer.render(scene,camera);
}
window.sourceOutlineReview = value => {
  for(const layer of outlineLayers.values())layer.setEnabled(value);
  drawScene();
  return {enabled:document.body.dataset.outlineEnabled,meshes:Number(document.body.dataset.outlineMeshes),cssWidth:Number(document.body.dataset.outlineCSSWidth)};
};
function disposeModel(old) {
  if(outlineLayers.has(old)) {outlineLayers.get(old).dispose();outlineLayers.delete(old);}
  old?.traverse(object => {
    if (object.isMesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.map?.dispose(); material.alphaMap?.dispose(); material.dispose();
      }
    }
  });
}

function visibleBounds(subjectOnly = false) {
  const box = new THREE.Box3();
  model.updateMatrixWorld(true);
  const bodyRoot = sourceNodeObjects.get(settings.framing?.body_source_node_index);
  const bodyMeshes = new Set(); bodyRoot?.traverse(node => { if (node.isMesh && !node.userData.isOutline) bodyMeshes.add(node); });
  for (const mesh of meshList) {
    if (!isVisible(mesh)) continue;
    if (subjectOnly && bodyRoot && !bodyMeshes.has(mesh)) continue;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.every(material => /EyeMouth|Mouth_\d/i.test(material.name))) continue;
    if (mesh.isSkinnedMesh) mesh.computeBoundingBox();
    else if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    const bounds = (mesh.boundingBox || mesh.geometry.boundingBox)?.clone();
    if (bounds && !bounds.isEmpty() && bounds.getSize(new THREE.Vector3()).lengthSq() > 1e-8) box.union(bounds.applyMatrix4(mesh.matrixWorld));
  }
  return box;
}

function isVisible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function applyClipVisibility(clip) {
  for (const entry of restPose) entry.node.visible = entry.visible;
  const hide = new Set((clip?.userData?.hide || []).map(name => name.toLowerCase()));
  const show = new Set((clip?.userData?.show || []).map(name => name.toLowerCase()));
  model.traverse(object => {
    const keys = [object.name.toLowerCase(), ...Object.entries(object.userData).filter(([, value]) => value === true).map(([name]) => name.toLowerCase())];
    if (keys.some(key => hide.has(key))) object.visible = false;
    if (keys.some(key => show.has(key))) object.visible = true;
  });
}

function applyClipFacing() {
  // Walking owns the facing direction until an explicit action ends it.
  if (walking && !pickup) { pivot.updateMatrixWorld(true); return; }
  const degrees = Number(settings.animation_yaw_degrees?.[action?.getClip().name] ?? settings.default_yaw_degrees ?? 0);
  pivot.rotation.set(0, THREE.MathUtils.degToRad(degrees), 0);
  pivot.updateMatrixWorld(true);
}

function measureAnimation() {
  if (!action || !model) return;
  applyClipFacing();
  // Walking can retain either facing direction; world-space bounds depend on it.
  const measurementKey = `${action.getClip().name}:${pivot.rotation.x}:${pivot.rotation.y}:${pivot.rotation.z}`;
  const cached = animationMeasurements.get(measurementKey);
  if (cached) {
    framingBox = cached.box.clone(); subjectBox = cached.subject.clone();
    headMetric = { position: cached.head.position.clone(), scale: cached.head.scale };

    return;
  }
  const time = action.time;
  const frames = [], subjectFrames = [];
  const headPosition = new THREE.Vector3(); let headScale = 0;
  for (const fraction of settings.animation_sample_fractions?.[action.getClip().name] || [0.5, 0, 0.125, 0.25, 0.36, 0.625, 0.75, 0.875, 0.995]) {
    action.time = action.getClip().duration * fraction;
    mixer.update(0); frames.push(visibleBounds());
    subjectFrames.push(visibleBounds(true));
    if (head) {
      headPosition.add(head.getWorldPosition(new THREE.Vector3()));
      const scale = head.getWorldScale(new THREE.Vector3());
      headScale += (Math.abs(scale.x) + Math.abs(scale.y) + Math.abs(scale.z)) / 3;
    }
  }
  const box = frames[0].clone();
  for (const frame of frames.slice(1)) box.union(frame);
  framingBox = box;
  subjectBox = subjectFrames[0].clone();
  for (const frame of subjectFrames.slice(1)) subjectBox.union(frame);
  headMetric = { position: headPosition.divideScalar(frames.length), scale: headScale / frames.length || 1 };
  animationMeasurements.set(measurementKey, { box: framingBox.clone(), subject: subjectBox.clone(), head: { position: headMetric.position.clone(), scale: headMetric.scale } });

  action.time = time; mixer.update(0); headBase = head?.quaternion.clone();
}

function updateFramingProjection() {
  if (!framingUnitsPerPixel) return;
  const width = $('stage').clientWidth, height = $('stage').clientHeight;
  camera.left = -width * framingUnitsPerPixel / 2; camera.right = -camera.left;
  camera.top = height * framingUnitsPerPixel / 2; camera.bottom = -camera.top;
  camera.updateProjectionMatrix();
}

function alignPetFooterHorizontal() {
  if (studio || !headMetric || !framingUnitsPerPixel) return;
  camera.updateMatrixWorld(true);
  const width = $('stage').clientWidth, rowWidth = Math.min(baseStage.width, width);
  const anchor = headMetric.position.clone().project(camera);
  const left = Math.max(0, Math.min(width - rowWidth, (anchor.x + 1) * width / 2 - rowWidth / 2));
  $('petFooter').style.width = rowWidth + 'px'; $('petFooter').style.marginLeft = left + 'px';
}

function alignPetFooter() {
  if (studio || !action || !model || loadingModel) return;
  // Update horizontal placement immediately after resizing, before the slow UI tick.
  alignPetFooterHorizontal();
  // Measure the rendered scene, including source props, over the clip. Keep the
  // row steady while the animation plays and leave the camera/body scale intact.
  const height = $('stage').clientHeight;
  const previousTime = action.time, pose = capturePose(), previousHeadBase = headBase?.clone();
  const previousCamera = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone() };
  document.body.dataset.footerProbeSurface = 'offscreen';
  let bottom = 0;
  try {
    for (const fraction of settings.animation_sample_fractions?.[action.getClip().name] || [0, .125, .25, .36, .5, .625, .75, .875, .995]) {
      action.time = action.getClip().duration * fraction;
      mixer.update(0); model.updateMatrixWorld(true);
      bottom = Math.max(bottom, renderSurface.measureAlphaBottom($('stage').clientWidth, height, drawScene));
    }
  } finally {
    action.time = previousTime; mixer.update(0); applyPose(pose);
    model.updateMatrixWorld(true); headBase = previousHeadBase;
    camera.position.copy(previousCamera.position); camera.quaternion.copy(previousCamera.quaternion); controls.target.copy(previousCamera.target);
    camera.updateMatrixWorld(true);
    // The displayed buffer already contains the live pose; probes never touched it.
    document.body.dataset.footerProbeSamples = String(renderSurface.metrics.offscreenSamples);
  }
  const offset = bottom ? Math.min(0, bottom + 8 - height) : 0;
  $('petFooter').style.transform = `translateY(${offset}px)`;
  document.body.dataset.footerSceneBottom = String(bottom);
  document.body.dataset.footerOffset = String(offset);
  document.body.dataset.footerTargetGap = '8';
}
controls.addEventListener('end', () => { if (!studio) alignPetFooter(); });

function resetView() {
  if (!model || !action || !framingBox || framingBox.isEmpty()) return;
  applyClipFacing();
  const reference = sizeReferences.get(settings.framing?.reference_animation || 'Cafe_Idle') || { box: subjectBox, head: headMetric };
  // One physical character scale per outfit. Props and travelling root positions never change it.
  const referenceHeight = settings.framing?.character_world_height || reference.box.getSize(new THREE.Vector3()).y;
  framingUnitsPerPixel = referenceHeight / (studio ? nominalStage.height * (settings.framing?.studio_reference_height_fraction || .40) : baseStage.height * (settings.framing?.pet_reference_height_fraction || .65)) * headMetric.scale / reference.head.scale;
  const backward = new THREE.Vector3(0, 0.087, 1).normalize();
  const up = new THREE.Vector3(0, backward.z, -backward.y);
  const min = framingBox.min, max = framingBox.max;
  let bottom = Infinity, top = -Infinity;
  for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
    const projection = y * up.y + z * up.z; bottom = Math.min(bottom, projection); top = Math.max(top, projection);
  }
  const center = framingBox.getCenter(new THREE.Vector3());
  center.addScaledVector(up, (bottom + top) / 2 - center.dot(up));
  const sceneWidth = max.x - min.x, sceneHeight = top - bottom;
  const padding = Math.max(10, Math.round(baseStage.height * 0.04));
  const baseWidth = studio ? nominalStage.width : baseStage.width;
  const baseHeight = studio ? nominalStage.height : baseStage.height;
  const width = Math.max(baseWidth, Math.ceil(sceneWidth / framingUnitsPerPixel) + padding * 2);
  const height = Math.max(baseHeight, Math.ceil(sceneHeight / framingUnitsPerPixel) + padding * 2);
  const actorX = width / 2 + (headMetric.position.x - center.x) / framingUnitsPerPixel;
  const actorY = height / 2 - (headMetric.position.dot(up) - center.dot(up)) / framingUnitsPerPixel;
  const referenceCenter = reference.box.getCenter(new THREE.Vector3());
  const baseActorX = baseWidth / 2 + (reference.head.position.x - referenceCenter.x) / framingUnitsPerPixel;
  const baseActorY = baseHeight / 2 - (reference.head.position.dot(up) - referenceCenter.dot(up)) / framingUnitsPerPixel;
  const distance = Math.max(10, framingBox.getSize(new THREE.Vector3()).length() * 2);
  controls.target.copy(center); camera.position.copy(center).addScaledVector(backward, distance);
  camera.near = 0.001; camera.far = distance * 4; camera.zoom = 1;
  controls.minZoom = 0.25; controls.maxZoom = 4;
  camera.lookAt(center); updateFramingProjection(); controls.update();
  sceneOverviewActive = false;
  document.body.dataset.sceneView = 'character';
  $('sceneNavigation').hidden = !settings.scene_navigation_clips?.includes(action.getClip().name);
  if (!$('sceneNavigation').hidden) sceneCharacterView();
  document.body.dataset.framingUnitsPerPixel = String(framingUnitsPerPixel);
  document.body.dataset.sceneRequiredWidth = String(width); document.body.dataset.sceneRequiredHeight = String(height);
  document.body.dataset.baseStageWidth = String(baseStage.width); document.body.dataset.baseStageHeight = String(baseStage.height);
  const sequence = ++framingSequence;
  if (desktop?.layout) {
    document.body.dataset.layoutPending = 'true';
    layoutPromise = desktop.layout({ width, height, offsetX: actorX - baseActorX, offsetY: actorY - baseActorY, baseWidth: baseStage.width, baseHeight: baseStage.height }).then(async result => {
      if (sequence !== framingSequence) return;
      if (!result) { document.body.dataset.layoutPending = 'false'; return; }
      document.body.dataset.sceneViewportLimited = String(Boolean(result?.limited));
      for (let i = 0; i < 30; i++) {
        if (Math.abs($('stage').clientWidth - result.width) <= 2 && Math.abs($('stage').clientHeight - result.height) <= 2 && (studio || Math.abs(innerWidth - result.width) <= 2 && Math.abs(innerHeight - result.height - 28) <= 2)) break;
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      if (sequence !== framingSequence) return;
      document.body.dataset.sceneViewportLimited = String(Boolean(result.limited || Math.abs($('stage').clientWidth - result.width) > 2 || Math.abs($('stage').clientHeight - result.height) > 2));
      resize(); renderFrame(0); alignPetFooter();
      document.body.dataset.layoutPending = 'false';
    });
  }
  else alignPetFooter();
}

function sceneCharacterView(position = 0) {
  if (!subjectBox || !framingBox) return;
  const center = subjectBox.getCenter(new THREE.Vector3());
  const sceneCenter = framingBox.getCenter(new THREE.Vector3());
  sceneCenter.y = Math.max(center.y, framingBox.max.y - $('stage').clientHeight * framingUnitsPerPixel * .4);
  center.lerp(sceneCenter, THREE.MathUtils.clamp(Number(position) || 0, 0, 1));
  const offset = camera.position.clone().sub(controls.target);
  controls.target.copy(center); camera.position.copy(center).add(offset);
  camera.zoom = 1; controls.minZoom = .05; camera.lookAt(center); camera.updateProjectionMatrix(); controls.update();
  sceneOverviewActive = false; document.body.dataset.sceneView = 'character';
  $('scenePosition').value = String(Math.round(position * 100)); $('scenePositionText').textContent = position ? '场景' : '学生';
  if (!loadingModel) { renderFrame(0); if (!studio) alignPetFooter(); }
}
function sceneOverviewView() {
  if (!framingBox || framingBox.isEmpty()) return;
  const center = framingBox.getCenter(new THREE.Vector3());
  const offset = camera.position.clone().sub(controls.target);
  controls.target.copy(center); camera.position.copy(center).add(offset); camera.lookAt(center);
  const world = framingBox.getSize(new THREE.Vector3());
  const width = $('stage').clientWidth * framingUnitsPerPixel, height = $('stage').clientHeight * framingUnitsPerPixel;
  camera.zoom = Math.min(1, width / (world.x * 1.12), height / ((world.y + world.z * .087) * 1.12));
  controls.minZoom = .05; camera.updateProjectionMatrix(); controls.update();
  sceneOverviewActive = true; document.body.dataset.sceneView = 'overview';
  $('scenePositionText').textContent = '完整场景'; renderFrame(0); if (!studio) alignPetFooter();
}

async function loadModel(nextVariant) {
  dialogue.stop();
  cancelInteraction();
  const token = ++modelToken;
  queuedCommands = [];
  const firstLoad = !hasRequestedModel; hasRequestedModel = true;
  loadingModel = true; document.body.dataset.ready = 'false'; $('loading').hidden = false;
  $('variant').disabled = true; $('animation').disabled = true;
  $('loadingText').textContent = '正在载入原始模型…';
  const entry = catalog.variants.find(item => item.variant === nextVariant) || catalog.variants[0];
  variant = entry.variant; settings = { ...catalog, ...entry }; AUTO_CLIPS = resolveStateActions(catalog, variant, config.stateActions);
  document.body.dataset.variant = variant; $('variant').value = variant;
  renderStateActions();
  $('variantInfo').textContent = catalog.character + ' · 原始完整模型';
  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); }
  if (model) { pivot.remove(model); disposeModel(model); }
  model = null; mixer = null; action = null;
  let gltf;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = '/' + entry.model + (attempt ? '?retry=' : '?revision=') + encodeURIComponent(entry.sha256);
      gltf = await loader.loadAsync(url); break;
    } catch (error) {
      if (token !== modelToken) return;
      if (attempt || !(error instanceof TypeError) || !/Failed to fetch/.test(error.message)) throw error;
      await new Promise(resolve => setTimeout(resolve, 150));
      if (token !== modelToken) return;
    }
  }
  try { await restoreOriginalCubicCurves(gltf); await restoreOriginalNormals(gltf); }
  catch (error) { if (token !== modelToken) return; throw error; }
  if (token !== modelToken) { disposeModel(gltf.scene); return; }
  model = gltf.scene; meshList = []; head = null; headBase = null;
  sourceNodeObjects = new Map();
  model.traverse(object => { const index = gltf.parser.associations.get(object)?.nodes; if (Number.isInteger(index)) sourceNodeObjects.set(index,object); });
  model.traverse(object => {
    if (object.isBone && (settings.head_bone ? object.name === settings.head_bone : /Bip001.?Head$/i.test(object.name))) head = object;
    if (!object.isMesh) return;
    object.frustumCulled = false;
    meshList.push(object);
    const convert = material => {

      const basic = new THREE.MeshBasicMaterial({ color: material.color, map: material.map, alphaMap: material.alphaMap, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest, side: material.side, vertexColors: material.vertexColors, depthWrite: material.depthWrite });
      basic.name = material.name;
      material.dispose(); return basic;
    };
    object.material = Array.isArray(object.material) ? object.material.map(convert) : convert(object.material);
  });
  pivot.add(model);
  outlineLayers.set(model,createSourceOutlines(model,THREE));
  restPose = [];
  model.traverse(node => restPose.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible, morph: node.morphTargetInfluences?.slice() }));
  mixer = null;
  clips = gltf.animations;
  actions = new Map(clips.map(clip => [clip.name, clip]));
  action = null;
  sizeReferences.clear(); animationMeasurements.clear();
  for (const referenceName of new Set([settings.framing?.reference_animation || 'Cafe_Idle'])) {
    if (!actions.has(referenceName)) continue;
    playClip(referenceName, { manual: false, immediate: true });
    sizeReferences.set(referenceName, { box: subjectBox.clone(), head: { position: headMetric.position.clone(), scale: headMetric.scale } });
  }
  // Prepare pickup framing before accepting input; this form may have no dedicated pickup clip.
  if (settings.interaction_animations.pickup) playClip(settings.interaction_animations.pickup, { manual: false, immediate: true });
  const player = firstLoad && !initial.selfTest && initial.playerSnapshot?.variant === variant ? initial.playerSnapshot : null;
  const initialManual = firstLoad ? initial.manualClip : null;
  if (player?.walking) { walking = true; pivot.rotation.y = player.yaw; }
  playClip(player?.clip || initialManual || AUTO_CLIPS[config.codexFollow ? state.state : 'idle'], { manual: player ? !player.auto : Boolean(initialManual), immediate: true });
  mixer.update(0);
  model.updateMatrixWorld(true);
  resetView();
  $('animation').replaceChildren(...clips.map(clip => {
    const option = document.createElement('option'); option.value = clip.name; option.textContent = `${clip.name} · ${clip.duration.toFixed(2)}s`; return option;
  }));
  $('animation').value = action.getClip().name;
  $('pickupPreview').disabled = !settings.interaction_animations.pickup;
  $('pickupPreview').title = settings.interaction_animations.pickup ? '预览原始提起动作' : '此形态无专用提起动作；长按可保持当前姿态拖动';
  $('modelInfo').textContent = `${clips.length} 段原始骨骼动画 · ${meshList.length} 个网格 · ${((entry.bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
  config.variant = variant;
  $('loading').hidden = true; loadingModel = false; $('variant').disabled = false; $('animation').disabled = false;
  $('gaze').checked = config.gaze; $('follow').checked = config.codexFollow;
  if (player) {
    autoMode = player.auto; walking = player.walking;
    updateModeLabel();
    restorePlaybackPose(player);
    if (walking) pivot.rotation.y = player.yaw;
    let catchUp = paused ? 0 : Math.min(2, Math.max(0, (Date.now() - player.capturedAt) / 1000)) * speed;
    while (catchUp > 0) { const step = Math.min(0.05, catchUp); updateAnimation(step); catchUp -= step; }
    headBase = head?.quaternion.clone(); renderFrame(0);
  } else {
    if (config.codexFollow && !initial.selfTest && !initialManual) setStatus(state);
    if (firstLoad && !initial.selfTest && initial.playback) applyPlayback('initial', initial.playback);
  }
  const pending = queuedCommands; queuedCommands = [];
  for (const value of pending) applyCommand(value);
  report({ ok: true, ready: true, variant, activeClip: action.getClip().name, currentState: state.state, autoMode, paused, walking, animationTime: action.time, characterId: catalog.character_id, stateAnimations: AUTO_CLIPS, originalPropsPreserved: true, clipCount: clips.length, clips: clips.map(c => ({ name: c.name, duration: c.duration })), headBone: head?.name || null, meshes: meshList.length, renderer: 'WebGL2 real-time 3D', canvasPixels: [canvas.width, canvas.height], pixelRatio: renderer.getPixelRatio() });
  dialogue.reconcile();
}

function playClip(name, { manual = true, immediate = false } = {}) {
  if (!model || !actions.size) return;
  const sourceClip = actions.get(name) || actions.get(AUTO_CLIPS.idle) || actions.values().next().value;
  if (!sourceClip) return;
  if (manual) { clearIdleBubble(); autoMode = false; }
  updateModeLabel();
  if (action?.getClip().name === sourceClip.name && !immediate) return;
  if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model); }
  for (const entry of restPose) {
    entry.node.position.copy(entry.position); entry.node.quaternion.copy(entry.quaternion); entry.node.scale.copy(entry.scale);
    if (entry.morph) entry.node.morphTargetInfluences.splice(0, entry.morph.length, ...entry.morph);
  }
  const tracks = [];
  for (const track of sourceClip.tracks) {
    if (!track.name.endsWith('.morphTargetInfluences')) { tracks.push(track); continue; }
    const target = model.getObjectByName(track.name.slice(0, track.name.lastIndexOf('.')));
    if (!target) { tracks.push(track); continue; }
    target.traverse(node => {
      if (!node.morphTargetInfluences) return;
      const copy = track.clone(); copy.createInterpolant = track.createInterpolant;
      copy.name = `${node.name}.morphTargetInfluences`; tracks.push(copy);
    });
  }
  const clip = new THREE.AnimationClip(sourceClip.name, sourceClip.duration, tracks);
  clip.userData = sourceClip.userData;
  activeSourceClip = clip;
  mixer = new THREE.AnimationMixer(model);
  action = mixer.clipAction(clip);
  tailPolicy = tailLoopPolicy(clip.name, clip.duration, settings.animation_tail_loops);
  tailActive = false; tailRepeats = 0; retiringActions = [];
  tailActions = []; seatedPose = []; anchorAction = null; ambientBaseAction = null;
  action.clampWhenFinished = Boolean(tailPolicy);
  action.reset().setLoop(tailPolicy ? THREE.LoopOnce : THREE.LoopRepeat, tailPolicy ? 1 : Infinity).play();
  applyClipVisibility(clip); mixer.update(0); headBase = head?.quaternion.clone();
  measureAnimation(); resetView();
  if (tailPolicy) {
    action.time = tailPolicy.poseTime; mixer.update(0);
    seatedPose = capturePose();
    action.time = 0; mixer.update(0); headBase = head?.quaternion.clone();
  }
  paused = false;
  $('playPause').textContent = '暂停';
  if ($('animation').querySelector(`option[value="${action.getClip().name}"]`)) $('animation').value = action.getClip().name;
  $('timeline').max = 1000;
}

function capturePose() {
  return restPose.map(({ node }) => ({ node, position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(), visible: node.visible, morph: node.morphTargetInfluences?.slice() }));
}

function applyPose(pose) {
  for (const entry of pose) {
    entry.node.position.copy(entry.position); entry.node.quaternion.copy(entry.quaternion); entry.node.scale.copy(entry.scale); entry.node.visible = entry.visible;
    if (entry.morph) entry.node.morphTargetInfluences.splice(0, entry.morph.length, ...entry.morph);
  }
}

function startSeatedAmbient() {
  const motionTracks = activeSourceClip.tracks.filter(track => isAmbientTrack(track.name, tailPolicy.parts, settings.ambient_bones));
  if (!motionTracks.length) throw new Error('结束末段缺少允许的次级运动轨道');
  mixer.stopAllAction(); mixer.uncacheRoot(model); applyPose(seatedPose);
  mixer = new THREE.AnimationMixer(model);
  // Only source hair/coat/skirt tracks enter this mixer; body, face and chair stay in the captured final pose.
  const anchorTracks = motionTracks.map(track => {
    const separator = track.name.lastIndexOf('.'), nodeName = track.name.slice(0, separator), property = track.name.slice(separator + 1);
    const entry = seatedPose.find(item => item.node.name === nodeName);
    if (!entry) throw new Error('次级骨骼不存在：' + nodeName);
    return property === 'quaternion' ? new THREE.QuaternionKeyframeTrack(track.name, [0], entry.quaternion.toArray()) : new THREE.VectorKeyframeTrack(track.name, [0], entry.position.toArray());
  });
  const makeAnchor = weight => mixer.clipAction(new THREE.AnimationClip(activeSourceClip.name, activeSourceClip.duration, anchorTracks)).reset().setEffectiveWeight(weight).setEffectiveTimeScale(0).play();
  ambientBaseAction = makeAnchor(1 - tailPolicy.amplitude);
  anchorAction = makeAnchor(tailPolicy.amplitude);
  tailActions = [0, 1].map(() => {
    // Sharing tracks retains the original glTF cubic interpolation.
    const next = mixer.clipAction(new THREE.AnimationClip(activeSourceClip.name, activeSourceClip.duration, motionTracks));
    next.clampWhenFinished = true; return next.setLoop(THREE.LoopOnce, 1);
  });
  retiringActions = []; action = anchorAction; tailActive = true;
  transitionSeatedTail(); mixer.update(0); headBase = head?.quaternion.clone();
}

function transitionSeatedTail() {
  const previous = action, next = tailActions.find(candidate => candidate !== previous);
  next.reset().setEffectiveWeight(tailPolicy.amplitude).setEffectiveTimeScale(1).play(); next.time = tailPolicy.start;
  next.crossFadeFrom(previous, tailPolicy.blend, false);
  retiringActions.push({ action: previous, until: mixer.time + tailPolicy.blend, blend: tailPolicy.blend });
  action = next; tailRepeats++;
}

function beginPickup() {
  if (!mixer || pickup) return;
  clearIdleBubble();
  beforePickup = capturePlayback();
  pickup = true;
  if (settings.interaction_animations.pickup) playClip(settings.interaction_animations.pickup, { manual: false, immediate: true });
  else setPaused(true); // This source form has no dedicated pickup animation.
  canvas.style.cursor = 'grabbing';
  document.body.dataset.pickupCount = String(Number(document.body.dataset.pickupCount || 0) + 1);
  document.body.dataset.pickupActive = 'true';
  schedulePickupBubble();
}
function capturePlayback() {
  if (!action || loadingModel) return null;
  const fading = retiringActions.find(retired => retired.until > mixer.time);
  return { variant, clip: action.getClip().name, auto: autoMode, walking, yaw: pivot.rotation.y, time: action.time, paused, speed, tailActive, tailRepeats, capturedAt: Date.now(),
    fade: fading ? { time: fading.action.time, timeScale: fading.action.getEffectiveTimeScale(), blend: fading.blend, elapsed: fading.blend - (fading.until - mixer.time), anchor: fading.action === anchorAction } : null };
}
function finishPickup() {
  if (!pickup) return;
  clearPickupBubble();
  pickup = false; canvas.style.cursor = '';
  document.body.dataset.pickupActive = 'false';
  autoMode = beforePickup?.auto ?? true;
  const next = autoMode && !(beforePickup?.walking && walking) ? AUTO_CLIPS[config.codexFollow ? state.state : 'idle'] : beforePickup?.clip;
  if (beforePickup?.walking && walking) pivot.rotation.y = beforePickup.yaw;
  playClip(next || AUTO_CLIPS.idle, { manual: false, immediate: true });
  if (next === beforePickup?.clip) {
    restorePlaybackPose(beforePickup);
    if (beforePickup.walking && walking) pivot.rotation.y = beforePickup.yaw;
  }
  beforePickup = null;
  dialogue.reconcile();
}
function restorePlaybackPose(player) {
    speed = player.speed;
    setPlaybackTime(player.time, { tail: player.tailActive });
    if (player.fade && tailPolicy && tailActive) {
      const fade = player.fade;
      const previous = fade.anchor ? anchorAction : tailActions.find(candidate => candidate !== action);
      previous.reset().setEffectiveWeight(tailPolicy.amplitude).setEffectiveTimeScale(fade.timeScale).play(); previous.time = fade.time;
      mixer.time = 0; action.crossFadeFrom(previous, fade.blend, false);
      mixer.time = fade.elapsed;
      retiringActions = [{ action: previous, until: fade.blend, blend: fade.blend }];
      mixer.update(0); headBase = head?.quaternion.clone(); renderFrame(0);
    }
    tailRepeats = player.tailRepeats;
    setPaused(player.paused);
    $('speed').value = speed; $('speedText').textContent = speed.toFixed(2) + '×';
}

function setPaused(value) { paused = Boolean(value); $('playPause').textContent = paused ? '播放' : '暂停'; if (paused) { dialogue.stop(); } else dialogue.reconcile(); }

function setPlaybackTime(time, { tail = Boolean(tailPolicy && time >= tailPolicy.poseTime) } = {}) {
  if (!action) return;
  if (tail && tailPolicy && !tailActive) startSeatedAmbient();
  else if (!tail && tailActive) playClip(activeSourceClip.name, { manual: false, immediate: true });
  for (const retired of retiringActions) retired.action.stop();
  retiringActions = [];
  action.stopFading(); action.enabled = true; action.paused = false; action.setEffectiveWeight(tailActive ? tailPolicy.amplitude : 1).play();
  action.time = THREE.MathUtils.clamp(Number(time) || 0, 0, action.getClip().duration - 0.001);
  tailActive = Boolean(tailPolicy && tail);
  action.setEffectiveTimeScale(1);
  if (head && headBase) head.quaternion.copy(headBase);
  mixer.update(0); headBase = head?.quaternion.clone(); renderFrame(0);
}

function applyPlayback(name, value) {
  if (name === 'initial') {
    speed = value.speed || 1; setPaused(value.paused);
  } else if (name === 'pause') setPaused(value);
  else if (name === 'restart') { playClip(action?.getClip().name, { manual: false, immediate: true }); }
  else if (name === 'seek' && action) { setPlaybackTime(Number(value) * action.getClip().duration); setPaused(true); }
  else if (name === 'speed') speed = Number(value);
  $('speed').value = speed; $('speedText').textContent = speed.toFixed(2) + '×';
}

function playbackCommand(name, value) {
  if (desktop) desktop.command('playback', { name, value });
  else applyPlayback(name, value);
}

function updateAnimation(delta) {
  if (tailPolicy && !tailActive && delta > 0 && action.time + delta >= tailPolicy.poseTime) {
    const untilPose = Math.max(0, tailPolicy.poseTime - action.time);
    mixer.update(untilPose); delta -= untilPose;
    startSeatedAmbient();
  }
  if (tailActive && tailTransitionDue(action.time, delta, tailPolicy)) {
    const untilBlend = Math.max(0, tailPolicy.end - tailPolicy.blend - action.time);
    if (untilBlend > 0) { mixer.update(untilBlend); delta -= untilBlend; }
    transitionSeatedTail();
  }
  mixer.update(Math.max(0, delta));
  retiringActions = retiringActions.filter(retired => {
    if (mixer.time < retired.until) return true;
    retired.action.stop(); return false;
  });
}

function report(value) {
  $('renderInfo').textContent = `${canvas.width} × ${canvas.height} 实时渲染`;
  if (!studio) {
    const rect = id => { const r = $(id).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    value.footerLayout = { stage: rect('stage'), row: rect('petFooter'), name: rect('petName'), studioButton: rect('petStudio'), menuButton: rect('petMenu') };
  }
  if (desktop) desktop.report(value);
  window.dispatchEvent(new CustomEvent('kisaki-report', { detail: value }));
  document.body.dataset.ready = value.ready ? 'true' : document.body.dataset.ready || 'false';
  document.body.dataset.clipCount = String(clips.length);
  document.body.dataset.activeClip = action?.getClip().name || '';
}

function resize() {
  const stage = $('stage'); const width = stage.clientWidth, height = stage.clientHeight;
  if (!width || !height) return;
  renderSurface.resize(width, height, () => {
    camera.aspect = width / height; camera.updateProjectionMatrix();
    updateFramingProjection();
    drawScene();
  });
  document.body.dataset.surfaceResizeChanges = String(renderSurface.metrics.resizeChanges);
  document.body.dataset.surfaceResizeSkips = String(renderSurface.metrics.redundantResizeSkips);
  $('renderInfo').textContent = `${canvas.width} × ${canvas.height} 实时渲染`;
}
new ResizeObserver(resize).observe($('stage')); resize();

function updateHead(dt) {
  if (!head || !config.gaze || pickup || walking || tailActive || !(settings.gaze_animations || []).includes(action?.getClip().name)) return;
  gaze.lerp(gazeTarget, 1 - Math.exp(-dt * 5));
  gazeRotation.set(THREE.MathUtils.clamp(gaze.y * 0.12, -0.14, 0.14), THREE.MathUtils.clamp(gaze.x * 0.25, -0.29, 0.29), 0, 'YXZ');
  deltaWorld.setFromEuler(gazeRotation);
  head.parent.getWorldQuaternion(parentWorld); inverseParent.copy(parentWorld).invert();
  const localDelta = inverseParent.multiply(deltaWorld).multiply(parentWorld);
  head.quaternion.premultiply(localDelta);
}

let drawnFrames = 0;
function renderFrame(dt, draw = true) {
  if (model && mixer) {
    if (head && headBase) head.quaternion.copy(headBase);
    if (!paused) updateAnimation(dt * speed);
    if (head) { headBase = head.quaternion.clone(); updateHead(dt); }
    model.updateMatrixWorld(true);
  }
  updateFramingProjection();
  controls.update();
  if (draw) { drawScene(); document.body.dataset.renderFrames = String(++drawnFrames); }
  if (head && model) {
    document.body.dataset.projectedCharacterScalePixels = String(projectedRigUnitPixels());
    document.body.dataset.cameraZoom = String(camera.zoom);
  }
}

let lastNativeFrame = 0, nextFrameTime = 0, frameRequest = 0, managedClock = null, renderActive = false;
const frameLimit = studio ? 30 : 60;
const frameInterval = 1000 / frameLimit;
function setRenderActive(value) {
  renderActive = Boolean(value);
  dialogue.setActive(renderActive);
  document.body.dataset.renderActive = String(renderActive);
  document.body.dataset.renderFpsLimit = String(frameLimit);
  cancelAnimationFrame(frameRequest); frameRequest = 0;
  clearInterval(managedClock); managedClock = null;
  if (renderActive) {
    lastTimestamp = 0; nextFrameTime = 0; lastNativeFrame = performance.now();
    frameRequest = requestAnimationFrame(tick);
    if (studio && initial.managed) managedClock = setInterval(() => { const now = performance.now(); if (now - lastNativeFrame > 100) tick(now, true); }, 50);
  }
}
function tick(timestamp, fallback = false, preview = false) {
  if (!renderActive && !preview) return;
  if (!fallback) { frameRequest = requestAnimationFrame(tick); lastNativeFrame = timestamp; }
  if (!preview) {
    if (nextFrameTime && timestamp < nextFrameTime - 1) return;
    // Preserve the deadline remainder on high-refresh monitors instead of dropping to 48fps at 144Hz.
    nextFrameTime = nextFrameTime && timestamp - nextFrameTime < frameInterval ? nextFrameTime + frameInterval : timestamp + frameInterval;
  }
  const dt = lastTimestamp ? Math.max(0, Math.min(preview ? 1.2 : 0.06, (timestamp - lastTimestamp) / 1000)) : 0;
  if (preview && !renderActive) {
    for (let remaining = dt; remaining > 0.000001;) { const step = Math.min(.05,remaining); renderFrame(step, false); remaining -= step; }
    renderFrame(0);
  } else renderFrame(dt);
  frameCount++;
  if (timestamp - lastFpsTime > 1000) { fps = Math.round(frameCount * 1000 / Math.max(1, timestamp - lastFpsTime)); frameCount = 0; lastFpsTime = timestamp; }
  if (action && timestamp - lastUiTime > 120) {
    updateHeadBubble();
    alignPetFooterHorizontal();
    const duration = action.getClip().duration;
    $('timeline').value = Math.round(action.time / duration * 1000);
    $('timeText').textContent = `${action.time.toFixed(2)} / ${duration.toFixed(2)} s${tailActive ? ` · 定姿 ${(speed).toFixed(2)}×` : ''}`;
    document.body.dataset.activeClip = action.getClip().name;
    document.body.dataset.animationTime = action.time.toFixed(3);
    document.body.dataset.seatedTailLoop = String(tailActive);
    document.body.dataset.tailRepeats = String(tailRepeats);
    document.body.dataset.tailPlaybackRate = String(tailActive ? tailPolicy.speed : 1);
    document.body.dataset.seatedBodyFixed = String(tailActive);
    document.body.dataset.seatedAmbientParts = tailActive ? tailPolicy.parts.join(',') : '';
    document.body.dataset.walking = String(walking);
    lastUiTime = timestamp;
  }
  lastTimestamp = timestamp;
}
setRenderActive(initial.viewActive !== false);
window.addEventListener('pet-preview', () => { if (!renderActive) tick(performance.now(), true, true); });
let contextRestoreTimer, contextReloadTimer;
// A lost context can no longer return this extension; retain it while valid.
let contextLossExtension = renderer.getContext().getExtension('WEBGL_lose_context');
function clearContextRecovery() {
  clearTimeout(contextRestoreTimer); clearTimeout(contextReloadTimer);
}
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault(); clearContextRecovery();
  // Discard stale targets before Three.js recreates its GPU resource manager.
  renderSurface.dispose();
  document.body.dataset.renderContext = 'lost';
  cancelInteraction(); dialogue.stop();
  // GPU resets leave a live DOM and an entirely transparent drawing buffer.
  // Three.js can rebuild its resources, but does not request context recovery.
  contextRestoreTimer = setTimeout(() => {
    if (!renderer.getContext().isContextLost()) return;
    try { contextLossExtension?.restoreContext(); } catch { /* Reload below if the driver refuses. */ }
  }, 250);
  contextReloadTimer = setTimeout(() => {
    if (!renderer.getContext().isContextLost()) return;
    // A driver may refuse restoration. Recreate this view, keeping runtime
    // preferences, instead of leaving the desktop silently empty forever.
    const key = 'pet-context-recovery', now = Date.now();
    let previous;
    try { previous = JSON.parse(sessionStorage.getItem(key)); } catch {}
    const count = previous && now - previous.at < 30000 ? previous.count + 1 : 1;
    if (count > 2) { showError(new Error('显卡绘制未能恢复，请重新启动桌宠')); return; }
    sessionStorage.setItem(key, JSON.stringify({ at: now, count }));
    location.reload();
  }, 2000);
});
canvas.addEventListener('webglcontextrestored', () => {
  clearContextRecovery();
  contextLossExtension = renderer.getContext().getExtension('WEBGL_lose_context');
  document.body.dataset.renderContext = 'restored';
  document.body.dataset.contextRecoveries = String(Number(document.body.dataset.contextRecoveries || 0) + 1);
  // Redraw even when hidden/paused; waiting for RAF can leave a cleared surface.
  renderFrame(0);
});
window.addEventListener('beforeunload', () => { clearContextRecovery(); bubbleObserver.disconnect(); dialogue.dispose(); cancelAnimationFrame(frameRequest); cancelAnimationFrame(hitRequest); clearInterval(managedClock); renderSurface.dispose(); });

function hitAt(event) {
  if (!model) return false;
  const bounds = canvas.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width, y = (event.clientY - bounds.top) / bounds.height;
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return false;
  hitContext.clearRect(0, 0, 1, 1);
  hitContext.drawImage(canvas, Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1, 0, 0, 1, 1);
  return hitContext.getImageData(0, 0, 1, 1).data[3] > 24;
}
// Coalesce forwarded pointer moves; presses and gesture boundaries still check immediately.
function scheduleHit(event) {
  if (studio || !desktop) return;
  pendingHit = { clientX: event.clientX, clientY: event.clientY };
  if (!hitRequest) hitRequest = requestAnimationFrame(() => {
    hitRequest = 0; const latest = pendingHit; pendingHit = null;
    if (latest) updateHit(latest);
  });
}
function updateHit(event) {
  if (studio || !desktop) return;
  const hit = Boolean(leftGesture || rightGesture || hitAt(event));
  document.body.dataset.pointerGesture = rightGesture ? 'rotate' : leftGesture ? 'drag' : 'none';
  document.body.dataset.pointerHit = String(hit);
  if (hit !== lastHit) { desktop.hitTest(hit); lastHit = hit; }
  canvas.style.cursor = pickup ? 'grabbing' : hit ? 'grab' : '';
}
canvas.addEventListener('pointermove', event => {
  const rect = canvas.getBoundingClientRect();
  if (studio || !desktop) gazeTarget.set((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1);
  scheduleHit(event);
});
document.addEventListener('pointermove', event => {
  if (event.target !== canvas) scheduleHit(event);
});
canvas.addEventListener('pointerdown', event => {
  if (event.button === 2) { rightGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }; updateHit(event); return; }
  if (event.button !== 0 || !hitAt(event)) return;
  event.preventDefault(); canvas.setPointerCapture(event.pointerId);
  leftGesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimeout(beginPickup, 110) };
  updateHit(event);
  if (!studio && desktop) desktop.drag('begin');
});
function releaseGesture(event) {
  if (rightGesture && event.pointerId === rightGesture.pointerId) {
    const distance = Math.hypot(event.clientX - rightGesture.x, event.clientY - rightGesture.y);
    if (event.type === 'pointerup' && distance < 5 && !studio && desktop) desktop.command('menu');
    rightGesture = null; updateHit(event);
  }
  if (!leftGesture || event.pointerId !== leftGesture.pointerId) return;
  const press = leftGesture, wasPickup = pickup;
  clearTimeout(press.timer); leftGesture = null;
  finishPickup();
  if (event.type === 'pointerup' && !wasPickup && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) dialogue.clickIdle();
  if (!studio && desktop) desktop.drag('end');
  updateHit(event);
  dialogue.reconcile();
}
canvas.addEventListener('pointerup', releaseGesture);
canvas.addEventListener('pointercancel', releaseGesture);
canvas.addEventListener('lostpointercapture', releaseGesture);
canvas.addEventListener('contextmenu', event => event.preventDefault());
window.addEventListener('blur', () => { rightGesture = null; if (leftGesture) { clearTimeout(leftGesture.timer); leftGesture = null; finishPickup(); desktop?.drag('end'); } });
for (const button of document.querySelectorAll('button')) button.addEventListener('pointerdown', event => event.stopPropagation());

$('animation').addEventListener('change', event => {
  if (desktop) desktop.command('play', event.target.value); else { cancelInteraction(); walking = false; playClip(event.target.value); }
});
$('playPause').addEventListener('click', () => playbackCommand('pause', !paused));
$('resetAnimation').addEventListener('click', () => playbackCommand('restart'));
$('variant').replaceChildren(...catalog.variants.map(entry => { const option = document.createElement('option'); option.value = entry.variant; option.textContent = entry.label || entry.variant; return option; }));
$('variant').addEventListener('change', event => { if (desktop) desktop.command('variant', event.target.value); else { autoMode = true; pickup = false; walking = false; loadModel(event.target.value).catch(showError); } });
$('resetStateActions').addEventListener('click', () => desktop?.command('resetStateActions', { variant }));
$('autoMode').addEventListener('click', () => { if (desktop) desktop.command('auto'); else { cancelInteraction(); autoMode = true; pickup = false; walking = false; playClip(AUTO_CLIPS[config.codexFollow ? state.state : 'idle'], { manual: false }); } });
$('timeline').addEventListener('input', event => {
  if (!action) return;
  playbackCommand('seek', Number(event.target.value) / 1000);
});
$('speed').addEventListener('input', event => playbackCommand('speed', Number(event.target.value)));
$('gaze').addEventListener('change', event => { config.gaze = event.target.checked; desktop?.command('gaze', config.gaze); });
$('follow').addEventListener('change', event => { applyFollow(event.target.checked); desktop?.command('follow', config.codexFollow); if (config.codexFollow) { autoMode = true; setStatus(state); } });
$('pickupPreview').addEventListener('click', () => { if (desktop) desktop.command('play', settings.interaction_animations.pickup); else { cancelInteraction(); walking = false; playClip(settings.interaction_animations.pickup); } });
$('resetView').addEventListener('click', resetView);
$('sceneOverview').addEventListener('click', () => desktop ? desktop.command('sceneView', 'overview') : sceneOverviewView());
$('sceneCharacter').addEventListener('click', () => desktop ? desktop.command('sceneView', 'character') : sceneCharacterView());
$('scenePosition').addEventListener('input', () => { const value = Number($('scenePosition').value) / 100; if (desktop) desktop.command('sceneView', value); else sceneCharacterView(value); });
$('petMenu').addEventListener('click', () => desktop?.command('menu'));
$('petStudio').addEventListener('click', () => desktop?.command('studio'));
$('openCodex').addEventListener('click', () => desktop?.command('openCodex'));
$('openCodex').disabled = !desktop;
$('capture').addEventListener('click', async () => {
  const ratio = renderer.getPixelRatio();
  let dataUrl;
  try { renderer.setPixelRatio(Math.min(window.devicePixelRatio * 2, 3)); renderFrame(0); dataUrl = canvas.toDataURL('image/png'); }
  finally { renderer.setPixelRatio(ratio); renderFrame(0); }
  if (desktop) await desktop.capture(dataUrl);
  else { const link = document.createElement('a'); link.href = dataUrl; link.download = `砂狼白子-${action?.getClip().name || '3D'}.png`; link.click(); }
});

if (desktop) {
  desktop.onSnapshotRequest(capturePlayback);
  desktop.onState(value => setStatus(value));
  desktop.onCursor(value => {
    gazeTarget.set(THREE.MathUtils.clamp(value.x, -1.2, 1.2), THREE.MathUtils.clamp(value.y, -1.2, 1.2));
    if (performance.now() - lastCursorHit > 100) {
      const rect = canvas.getBoundingClientRect();
      updateHit({ clientX: rect.left + (value.x + 1) / 2 * rect.width, clientY: rect.top + (value.y + 1) / 2 * rect.height });
      lastCursorHit = performance.now();
    }
  });
  desktop.onCommand(applyCommand);
}
function applyCommand({ name, value }) {
    if (['play', 'playback', 'auto', 'walk', 'syncPlayback'].includes(name)) clearIdleBubble();
    // A new action must cancel the old press before the model/command queue changes.
    if (name === 'play' || name === 'auto' || name === 'variant' && value !== variant) cancelInteraction();
    if (loadingModel && ['play', 'playback', 'auto', 'walk', 'syncPlayback'].includes(name)) { queuedCommands.push({name,value}); return; }
    if (name === 'play') { pickup = false; walking = false; playClip(value.clip); }
    else if (name === 'sceneView') { if (value === 'overview') sceneOverviewView(); else sceneCharacterView(value === 'character' ? 0 : value); }
    else if (name === 'dialogueVolume') dialogue.setVolume(value);
    else if (name === 'dialogueStop') dialogue.stop();
    else if (name === 'playback') applyPlayback(value.name, value.value);
    else if (name === 'variant' && value !== variant) { autoMode = true; pickup = false; walking = false; beforePickup = null; paused = false; config.variant = value; loadModel(value).catch(showError); }
    else if (name === 'auto') { autoMode = true; pickup = false; walking = false; pivot.rotation.y = 0; setStatus(state); if (!config.codexFollow) playClip(AUTO_CLIPS.idle, { manual: false }); }
    else if (name === 'size') { baseStage = { width: value.width, height: value.height }; measureAnimation(); resetView(); }
    else if (name === 'gaze') { config.gaze = value; $('gaze').checked = value; }
    else if (name === 'stateActions') { config.stateActions = value; AUTO_CLIPS = resolveStateActions(catalog, variant, value); renderStateActions(); setStatus({ ...state, autoMode }); }
    else if (name === 'follow') applyFollow(value);
    else if (name === 'walk') { walking = value !== 0; if (walking) { pivot.rotation.y = value * Math.PI / 2; playClip(settings.interaction_animations.walk, { manual: false }); } else setStatus(state); }
    else if (name === 'cancelInteraction') cancelInteraction();
    else if (name === 'activity') { if (renderActive !== Boolean(value)) setRenderActive(value); }
    else if (name === 'syncPlayback' && value && (!value.variant || value.variant === variant)) {
      autoMode = value.auto; walking = value.walking;
      if (action?.getClip().name !== value.clip) playClip(value.clip, {manual:!value.auto,immediate:true});
      updateModeLabel(); restorePlaybackPose(value);
      if (walking) pivot.rotation.y = value.yaw;
      let catchUp = paused ? 0 : Math.min(2, Math.max(0,(Date.now()-value.capturedAt)/1000)) * speed;
      while (catchUp > 0) { const step=Math.min(.05,catchUp); updateAnimation(step); catchUp-=step; }
      headBase=head?.quaternion.clone(); renderFrame(0);
    }
    dialogue.reconcile();
}
function cancelInteraction() {
  clearIdleBubble(); clearPickupBubble();
  cancelAnimationFrame(hitRequest); hitRequest = 0; pendingHit = null;
  const press = leftGesture;
  clearTimeout(press?.timer);
  // Clear ownership before releasePointerCapture can dispatch lostpointercapture.
  leftGesture = null; rightGesture = null;
  if (press && canvas.hasPointerCapture(press.pointerId)) canvas.releasePointerCapture(press.pointerId);
  if (pickup) finishPickup();
  beforePickup = null;
  lastHit = false; canvas.style.cursor = '';
  if (!studio && desktop) {
    if (press) desktop.drag('end');
    desktop.hitTest(false);
  }
}

function showError(error) {
  setRenderActive(false); queuedCommands = [];
  $('loading').hidden = false; $('loadingText').textContent = '模型载入失败：' + error.message;
  console.error(error); report({ ok: false, error: error.message });
}

function pixelSample(sampleSize = 64) {
  const small = document.createElement('canvas'); small.width = sampleSize; small.height = sampleSize;
  const context = small.getContext('2d', { willReadFrequently: true }); context.drawImage(canvas, 0, 0, sampleSize, sampleSize);
  const bytes = context.getImageData(0, 0, sampleSize, sampleSize).data;
  let hash = 2166136261, opaque = 0;
  for (let i = 0; i < bytes.length; i++) { hash ^= bytes[i]; hash = Math.imul(hash, 16777619); if (i % 4 === 3 && bytes[i] > 32) opaque++; }
  let left = sampleSize, top = sampleSize, right = 0, bottom = 0, edgePixels = 0;
  for (let y = 0; y < sampleSize; y++) for (let x = 0; x < sampleSize; x++) {
    if (bytes[(y * sampleSize + x) * 4 + 3] <= 32) continue;
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    if (x === 0 || y === 0 || x === sampleSize - 1 || y === sampleSize - 1) edgePixels++;
  }
  return { hash: (hash >>> 0).toString(16), visiblePixels: opaque, foregroundBoundssampleSize: [left, top, right, bottom], edgePixels };
}

function compareSourcePose(oracleVariant, expected) {
  const inversePivot = pivot.matrixWorld.clone().invert(), vertex = new THREE.Vector3();
  const failures = [], measuredMeshes = [];
  let maximumBoundsDifference = 0, maximumVertexProbeDifference = 0;
  for (const source of oracleVariant.meshes) {
    const root = sourceNodeObjects.get(source.sourceNodeIndex);
    const target = expected.meshBounds.find(item => item.sourceNodeIndex === source.sourceNodeIndex);
    if (!root || !target) { failures.push(source.sourceNodeName + ': missing source node'); continue; }
    const box = new THREE.Box3(); let sourceVisible = true;
    root.traverse(node => {
      if (!node.isMesh || node.userData.isOutline) return;
      sourceVisible &&= isVisible(node);
      const transform = inversePivot.clone().multiply(node.matrixWorld);
      for (let index = 0; index < node.geometry.attributes.position.count; index++) {
        node.getVertexPosition(index, vertex); box.expandByPoint(vertex.applyMatrix4(transform));
      }
      for (const probe of target.sourceVertexProbes || []) {
        if (probe.vertexCount !== node.geometry.attributes.position.count) continue;
        node.getVertexPosition(probe.vertexIndex, vertex).applyMatrix4(transform);
        const error = vertex.distanceTo(new THREE.Vector3(...probe.worldPosition));
        maximumVertexProbeDifference = Math.max(maximumVertexProbeDifference, error);
        if (error > 0.0001) failures.push(source.sourceNodeName + ': original source vertex probe differs');
      }
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        const original = source.primitives.find(primitive => primitive.materialName === material.name);
        if (!original || material.opacity !== original.baseColorAlpha || Boolean(material.transparent) !== (original.alphaMode === 'BLEND') || (original.alphaMode === 'MASK' && Math.abs(material.alphaTest - original.alphaCutoff) > 1e-6)) failures.push(source.sourceNodeName + ': alpha material differs');
      }
    });
    let difference = 0;
    for (let i = 0; i < 3; i++) difference = Math.max(difference, Math.abs(box.min.getComponent(i) - target.worldBounds.min[i]), Math.abs(box.max.getComponent(i) - target.worldBounds.max[i]));
    maximumBoundsDifference = Math.max(maximumBoundsDifference, difference);
    if (!sourceVisible || difference > 0.0001) failures.push(source.sourceNodeName + ': hidden or source geometry differs');
    measuredMeshes.push({ sourceNodeIndex: source.sourceNodeIndex, name: source.sourceNodeName, actualBounds: {min:box.min.toArray(),max:box.max.toArray()}, boundsDifference: difference, sourceCollapsed: target.collapsed, sourceTiny: target.tiny, sourceVisible });
  }
  const headScale = head.getWorldScale(new THREE.Vector3()), headPosition = head.getWorldPosition(new THREE.Vector3()).applyMatrix4(inversePivot);
  const headPositionDifference = headPosition.distanceTo(new THREE.Vector3(...expected.head.worldPosition));
  const headScaleDifference = Math.max(...headScale.toArray().map((value,index) => Math.abs(value - expected.head.worldScale[index])));
  if (headPositionDifference > 0.0001 || headScaleDifference > 0.00001) failures.push('source head transform differs');
  return { ok: failures.length === 0, maximumBoundsDifference, maximumVertexProbeDifference, headPositionDifference, headScaleDifference, failures, measuredMeshes };
}

function projectedRigUnitPixels() {
  const origin = head.getWorldPosition(new THREE.Vector3());
  const scale = head.getWorldScale(new THREE.Vector3()).toArray().reduce((sum,value) => sum + Math.abs(value),0) / 3;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
  const a = origin.clone().project(camera), b = origin.addScaledVector(right,scale * .1).project(camera);
  return Math.abs(b.x-a.x) * $('stage').clientWidth / .2;
}

function inspectRenderedFooter() {
  if (studio) return null;
  const rect = canvas.getBoundingClientRect(), controls = ['petName', 'petStudio', 'petMenu'].map(id => $(id).getBoundingClientRect());
  const sample = document.createElement('canvas'); sample.width = Math.ceil(rect.width); sample.height = Math.ceil(rect.height);
  const context = sample.getContext('2d', { willReadFrequently: true }); context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let bottom = 0, overlap = 0;
  for (let y = 0; y < sample.height; y++) for (let x = 0; x < sample.width; x++) if (pixels[(y * sample.width + x) * 4 + 3] > 32) {
    bottom = Math.max(bottom, y + 1);
    if (controls.some(r => x + rect.x >= r.x && x + rect.x < r.right && y + rect.y >= r.y && y + rect.y < r.bottom)) overlap++;
  }
  const gap = Math.min(...controls.map(r => r.y)) - bottom - rect.y;
  return { sceneBottom: bottom + rect.y, gap, overlap, controlsInside: controls.every(r => r.x >= -.01 && r.right <= innerWidth + .01 && r.y >= -.01 && r.bottom <= innerHeight + .01 && Math.abs(r.height - 24) < .01),
    idleGapWithinRange: action.getClip().name !== AUTO_CLIPS.idle || gap >= 6 && gap <= 18 };
}

async function runSelfTest() {
  const results = [], seatedResults = [], perVariantChecks = [], negativeControls = [];
  report({ selfTestProgress: { phase: 'source-oracle' } });
  const oracle = await fetch('/assets/source-pose-oracle.json').then(response => response.json());
  config.gaze = false; config.codexFollow = false;
  for (const entry of catalog.variants) {
    report({ selfTestProgress: { phase: 'load-variant', variant: entry.variant } });
    await loadModel(entry.variant);
    const oracleVariant = oracle.variants.find(item => item.variant === entry.variant);
    for (const clip of clips) {
      report({ selfTestProgress: { phase: 'animation', variant: entry.variant, clip: clip.name } });
      mixer.stopAllAction(); playClip(clip.name, { immediate: true }); paused = true; await layoutPromise;
      const fullSceneRequested = settings.scene_navigation_clips?.includes(clip.name);
      if (fullSceneRequested) sceneOverviewView();
      const frames = [];
      for (const expected of oracleVariant.clips.find(item => item.name === clip.name).frames) {
        const fraction = expected.fraction;
        action.time = clip.duration * fraction;
        if (head && headBase) head.quaternion.copy(headBase);
        mixer.update(0); headBase = head?.quaternion.clone(); renderFrame(0);
        camera.updateMatrixWorld(true);
        const projectedHeadScale = projectedRigUnitPixels();
        frames.push({ fraction, time: Number(action.time.toFixed(4)), projectedHeadScale, sceneView: fullSceneRequested ? 'explicit-overview' : 'character', sceneZoom: camera.zoom, sourcePose: compareSourcePose(oracleVariant,expected), footerPixels: inspectRenderedFooter(), ...pixelSample(fullSceneRequested ? 256 : 64) });
        const captureFraction = [0, .25, .5, .75, .995].find(value => Math.abs(value-fraction)<1e-10);
        if (desktop?.qaFrame && captureFraction !== undefined && !await desktop.qaFrame(clip.name, canvas.toDataURL('image/png'), 'f-'+String(captureFraction).replace('.','_'), variant)) throw new Error('QA frame could not be saved: '+variant+'/'+clip.name+'/'+captureFraction);
      }
      const sourceStatic = settings.source_static_render_clips?.includes(clip.name) || false;
      const valid = frames.every(frame => frame.visiblePixels > 30 && frame.edgePixels === 0 && frame.sourcePose.ok && (!frame.footerPixels || frame.footerPixels.overlap === 0 && frame.footerPixels.gap >= 6 && frame.footerPixels.controlsInside && frame.footerPixels.idleGapWithinRange)) && (new Set(frames.map(frame => frame.hash)).size > 1 || sourceStatic);
      action.time = clip.duration * 0.36; mixer.update(0); headBase = head?.quaternion.clone(); renderFrame(0);
      if (desktop?.qaFrame) await desktop.qaFrame(clip.name, canvas.toDataURL('image/png'), '', variant);
      const props = oracleVariant.meshes.map(source => ({ sourceNodeIndex: source.sourceNodeIndex, name: source.sourceNodeName, sourceMeshIndex: source.sourceMeshIndex }));
      results.push({ variant: entry.variant, clip: clip.name, duration: clip.duration, yawDegrees: THREE.MathUtils.radToDeg(pivot.rotation.y), sizeReference: 'Cafe_Idle physical character scale; explicit overview zoom separately recorded', sourceStatic, fullSceneRequested, visibleAndAnimated: valid, originalProps: props, viewportPixels: [canvas.width,canvas.height], frames });
    }
  for (const name of Object.keys(settings.animation_tail_loops || {})) {
    playClip(name, { immediate: true }); await layoutPromise;
    const policy = { ...tailPolicy }, samples = [];
    let elapsed = 0, maximumBodyMatrixChange = 0, maximumHairMotion = 0, maximumCoatMotion = 0, maximumSkirtMotion = 0, maximumSkirtMatrixChange = 0, visible = true, originalIntroSpeed = true;
    let fixedWorld, skirtWorld;
    for (let frame = 0; frame < Math.ceil((activeSourceClip.duration + 5 * (policy.end - policy.start)) / 0.04) + 20 && tailRepeats < 5; frame++) {
      renderFrame(0.04); elapsed += 0.04;
      if (!tailActive) originalIntroSpeed &&= action.getEffectiveTimeScale() === 1;
      if (!tailActive) continue;
      fixedWorld ||= restPose.filter(({ node }) => node.isBone && !isAmbientBone(node.name, policy.parts, settings.ambient_bones)).map(({ node }) => ({ node, matrix: node.matrixWorld.clone() }));
      skirtWorld ||= restPose.filter(({ node }) => settings.ambient_bones?.skirt?.includes(node.name)).map(({ node }) => ({ node, matrix: node.matrixWorld.clone() }));
      for (const entry of fixedWorld) for (let component = 0; component < 16; component++) maximumBodyMatrixChange = Math.max(maximumBodyMatrixChange, Math.abs(entry.node.matrixWorld.elements[component] - entry.matrix.elements[component]));
      for (const entry of skirtWorld) for (let component = 0; component < 16; component++) maximumSkirtMatrixChange = Math.max(maximumSkirtMatrixChange, Math.abs(entry.node.matrixWorld.elements[component] - entry.matrix.elements[component]));
      for (const entry of seatedPose) {
        if (!isAmbientBone(entry.node.name, undefined, settings.ambient_bones)) continue;
        const change = entry.node.quaternion.clone().normalize().angleTo(entry.quaternion.clone().normalize());
        if (/^bone_hair/i.test(entry.node.name)) maximumHairMotion = Math.max(maximumHairMotion, change);
        else if (/^bone_jacket/i.test(entry.node.name)) maximumCoatMotion = Math.max(maximumCoatMotion, change);
        else if (settings.ambient_bones?.skirt?.includes(entry.node.name)) maximumSkirtMotion = Math.max(maximumSkirtMotion, change);
      }
      if (frame % 12 === 0) visible &&= pixelSample().visiblePixels > 45;
    }
    const loops = tailRepeats - 1;
    const onlyAmbientTracks = action.getClip().tracks.every(track => isAmbientTrack(track.name, policy.parts, settings.ambient_bones));
    const effectiveTailSpeed = action.getEffectiveTimeScale();
    const bodyFixed = maximumBodyMatrixChange < 0.000001;
    const groupMotion = {};
    for (const part of policy.parts) {
      groupMotion[part] = Math.max(0, ...seatedPose.filter(entry => settings.ambient_bones?.[part]?.includes(entry.node.name)).map(entry => Math.max(entry.node.quaternion.clone().normalize().angleTo(entry.quaternion.clone().normalize()), entry.node.position.distanceTo(entry.position))));
    }
    const hairAndClothesAnimated = Object.values(groupMotion).some(value => value > 0.0001);
    const sourceSkirtTrackCount = activeSourceClip.tracks.filter(track => isAmbientTrack(track.name, ['skirt'], settings.ambient_bones)).length;
    const skirtTrackCount = action.getClip().tracks.filter(track => isAmbientTrack(track.name, ['skirt'], settings.ambient_bones)).length;
    const skirtPolicyVerified = policy.parts.includes('skirt') ? skirtTrackCount === sourceSkirtTrackCount : skirtTrackCount === 0 && maximumSkirtMatrixChange < 0.000001 && maximumSkirtMotion < 0.000001;
    setPaused(true);
    if (desktop?.qaFrame) await desktop.qaFrame(name, canvas.toDataURL('image/png'), 'ambient-blend', variant);
    for (const [tag, time] of [['ambient-first', policy.start + policy.blend], ['ambient-middle', (policy.start + policy.end) / 2]]) {
      setPlaybackTime(time, { tail: true }); setPaused(true);
      samples.push({ tag, time: action.time, ...pixelSample() });
      if (desktop?.qaFrame) await desktop.qaFrame(name, canvas.toDataURL('image/png'), tag, variant);
    }
    // Verify pickup during a live loop blend, not only at a single frozen sample.
    setPlaybackTime(policy.end - policy.blend - 0.02, { tail: true }); setPaused(false); renderFrame(0.04);
    const savedTime = action.time, savedPose = capturePose();
    setPaused(true); renderFrame(0.3);
    const pauseHeld = action.time === savedTime;
    beginPickup(); renderFrame(0.2); finishPickup();
    const pickupRestored = action.getClip().name === name && Math.abs(action.time - savedTime) < 0.001 && paused && tailActive && action.getEffectiveTimeScale() === 1;
    const pickupRestoredPose = savedPose.every(entry => entry.node.position.distanceTo(entry.position) < 0.0001 && entry.node.quaternion.clone().normalize().angleTo(entry.quaternion.clone().normalize()) < 0.0001 && entry.node.scale.distanceTo(entry.scale) < 0.0001);
    applyPlayback('restart');
    const restartReplaysIntro = action.time === 0 && !tailActive && !paused && tailRepeats === 0 && action.getEffectiveTimeScale() === 1;
    setPlaybackTime(policy.start + policy.blend + 0.02, { tail: true });
    setPaused(true); renderFrame(0);
    const seamPose = capturePose(), seamFirst = pixelSample();
    const period = policy.end - policy.blend - policy.start;
    for (let remaining = period; remaining > 0.00000001;) {
      const step = Math.min(0.01, remaining); updateAnimation(step); remaining -= step;
    }
    headBase = head?.quaternion.clone(); renderFrame(0);
    const seamPoseMaxChange = Math.max(...seamPose.map(entry => Math.max(entry.node.position.distanceTo(entry.position), entry.node.scale.distanceTo(entry.scale), entry.node.quaternion.clone().normalize().angleTo(entry.quaternion.clone().normalize()))));
    const seamPixelsMatch = seamFirst.hash === pixelSample().hash;
    seatedResults.push({ variant, clip: name, policy, elapsed, repeats: loops, completedCycles: loops, mode: 'fixed-pose-secondary-motion', onlyAmbientTracks, ambientTrackCount: activeSourceClip.tracks.filter(track => isAmbientTrack(track.name, policy.parts, settings.ambient_bones)).length, effectiveTailSpeed, originalIntroSpeed, bodyFixed, maximumBodyMatrixChange, hairAndClothesAnimated, maximumHairMotionRadians: maximumHairMotion, maximumCoatMotionRadians: maximumCoatMotion, groupMotion, maximumSkirtMotionRadians: maximumSkirtMotion, maximumSkirtMatrixChange, sourceSkirtTrackCount, skirtTrackCount, skirtPolicyVerified, visible, pauseHeld, pickupRestored, pickupRestoredPose, restartReplaysIntro, seamPoseMaxChange, seamPixelsMatch, frames: samples });
  }
  playClip(settings.interaction_animations.walk, { immediate: true });
  await layoutPromise; action.time = action.getClip().duration * .5; mixer.update(0); model.updateMatrixWorld(true); renderFrame(0);
  const expectedWalk = oracleVariant.clips.find(item => item.name === action.getClip().name).frames.find(item => item.fraction === .5);
  const detectableMeshes = expectedWalk.meshBounds.filter(item => !item.collapsed && !item.tiny);
  let hiddenDetected = true;
  for (const source of detectableMeshes) {
    const object = sourceNodeObjects.get(source.sourceNodeIndex), before = object.visible;
    object.visible = false; hiddenDetected &&= !compareSourcePose(oracleVariant,expectedWalk).ok; object.visible = before;
  }
  camera.updateMatrixWorld(true); const beforeScale = projectedRigUnitPixels();
  camera.zoom = .5; camera.updateProjectionMatrix(); const deliberatelySmall = projectedRigUnitPixels() / beforeScale;
  camera.zoom = 1; camera.updateProjectionMatrix();
  negativeControls.push({ variant, hiddenSourceMeshesDetected: hiddenDetected, sourceMeshesMutated: detectableMeshes.length, halvedCharacterScaleDetected: Math.abs(deliberatelySmall - 1) > .01, deliberatelySmallRatio: deliberatelySmall });
  const otherClipsUnaffected = !tailPolicy && action.loop === THREE.LoopRepeat && pivot.rotation.y === 0;
  perVariantChecks.push({ variant, otherClipsUnaffected, configuredTailClipsCovered: seatedResults.filter(item => item.variant === variant).length === Object.keys(settings.animation_tail_loops || {}).length, alphaHitBlankOutside: !hitAt({ clientX: -10, clientY: -10 }) });
  }
  const interactionChecks = { allVariantsCovered: perVariantChecks.length === catalog.variants.length, otherClipsUnaffected: perVariantChecks.every(item => item.otherClipsUnaffected), configuredTailClipsCovered: perVariantChecks.every(item => item.configuredTailClipsCovered), alphaHitBlankOutside: perVariantChecks.every(item => item.alphaHitBlankOutside) };
  interactionChecks.negativeControlsDetected = negativeControls.every(item => item.hiddenSourceMeshesDetected && item.halvedCharacterScaleDetected);
  for (const entry of catalog.variants) {
    const idleFrames = results.find(item => item.variant === entry.variant && item.clip === 'Cafe_Idle').frames;
    const baseline = idleFrames.reduce((sum,frame) => sum + frame.projectedHeadScale,0) / idleFrames.length;
    for (const result of results.filter(item => item.variant === entry.variant)) {
      result.projectedCharacterScaleRatios = result.frames.map(frame => frame.projectedHeadScale / frame.sceneZoom / baseline);
      result.characterScalePreserved = result.projectedCharacterScaleRatios.every(ratio => Math.abs(ratio - 1) < 0.01);
      result.visibleAndAnimated &&= result.characterScalePreserved;
    }
  }
  await loadModel(catalog.default_variant); config.gaze = false; config.codexFollow = false;
  playClip(settings.interaction_animations.pickup, { immediate: true }); action.time = action.getClip().duration * 0.55; paused = true; $('playPause').textContent = '播放'; mixer.update(0); renderFrame(0);
  const result = { ok: results.every(item => item.visibleAndAnimated) && seatedResults.every(item => item.completedCycles >= 4 && item.onlyAmbientTracks && item.effectiveTailSpeed === 1 && item.originalIntroSpeed && item.bodyFixed && item.hairAndClothesAnimated && item.skirtPolicyVerified && item.visible && item.pauseHeld && item.pickupRestored && item.pickupRestoredPose && item.restartReplaysIntro && item.seamPoseMaxChange < 0.000001 && item.seamPixelsMatch) && Object.values(interactionChecks).every(Boolean), selfTestComplete: true, ready: true, totalClips: results.length, originalSourceAnimations: true, originalPropRulesPreserved: true, characterId: catalog.character_id, stateAnimations: AUTO_CLIPS, real3DGeometry: true, meshCount: meshList.length, nativeCanvasPixels: [canvas.width, canvas.height], variants: catalog.variants.map(v => ({ variant: v.variant, clips: v.animations.length })), animationResults: results, seatedResults, perVariantChecks, interactionChecks };
  result.sourceOracle = { independentCPU: true, totalClips: catalog.embedded_animation_total, fractions: oracle.fractions, maximumBoundsTolerance: .0001, maximumHeadTransformTolerance: .00001 };
  result.negativeControls = negativeControls;
  result.characterScalePreserved = results.every(item => item.characterScalePreserved);
  report(result);
}

setStatus(state);
try {
  await loadModel(variant);
  if (initial.selfTest) await runSelfTest();
} catch (error) { showError(error); }
