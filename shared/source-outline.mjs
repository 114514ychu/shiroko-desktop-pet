// Project implementation of the Wiki's smoothed inverted-hull outline semantics.
// Source behavior: MirahezeDevScripts f4fdf87012fd8404ba2834658b38108176937b7f.
// Source geometry, textures, skin matrices and morph curves remain authoritative.
export function smoothSourceNormals(geometry, THREE) {
  if (geometry.hasAttribute('smoothNormal')) return geometry.getAttribute('smoothNormal');
  const positions = geometry.getAttribute('position');
  if (!positions) return null;
  const keys = [], sums = new Map(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i),positions.getY(i),positions.getZ(i)].map(value=>Math.round(value*10000)).join(',');
    keys.push(key); if (!sums.has(key)) sums.set(key,new THREE.Vector3());
  }
  const indices = geometry.index, count = indices?.count ?? positions.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const vertices = [0,1,2].map(offset=>indices ? indices.getX(i+offset) : i+offset);
    a.fromBufferAttribute(positions,vertices[0]); b.fromBufferAttribute(positions,vertices[1]); c.fromBufferAttribute(positions,vertices[2]);
    b.sub(a); c.sub(a); b.cross(c);
    for (const vertex of vertices) sums.get(keys[vertex]).add(b);
  }
  const normals = new Float32Array(positions.count*3);
  for (let i = 0; i < positions.count; i++) sums.get(keys[i]).clone().normalize().toArray(normals,i*3);
  const result = new THREE.BufferAttribute(normals,3); geometry.setAttribute('smoothNormal',result); return result;
}

export function createSourceOutlines(root, THREE) {
  const parents = [], pairs = [], materials = [];
  root.traverse(node=>{if(node.isMesh&&!node.userData.isOutline)parents.push(node);});
  for (const parent of parents) {
    // This is the source viewer's material rule, including MASK faces/mouths.
    if ([].concat(parent.material).some(material=>material.transparent) || !smoothSourceNormals(parent.geometry,THREE)) continue;
    if (!parent.geometry.boundingBox) parent.geometry.computeBoundingBox();
    const sourceDiameter=parent.geometry.boundingBox.getSize(new THREE.Vector3()).length();
    const material = new THREE.ShaderMaterial({
      name:parent.name+' source outline',side:THREE.BackSide,
      uniforms:{outlineColor:{value:new THREE.Color(0x000000)},outlineWorldWidth:{value:0},outlinePerspectiveWidth:{value:.0005},orthographicView:{value:true},outlineSourceDiameter:{value:sourceDiameter},outlineModelScale:{value:1},outlinePixelWorldSize:{value:1},outlinePerspectivePixelSize:{value:1}},
      vertexShader:`
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
attribute vec3 smoothNormal;
uniform float outlineWorldWidth;
uniform float outlinePerspectiveWidth;
uniform bool orthographicView;
uniform float outlineSourceDiameter;
uniform float outlineModelScale;
uniform float outlinePixelWorldSize;
uniform float outlinePerspectivePixelSize;
varying float projectedSourceDiameter;
void main() {
  vec3 objectNormal = smoothNormal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = position;
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);
  float skinScale = 1.0;
  #ifdef USE_SKINNING
    skinScale = max(length(skinMatrix[0].xyz), max(length(skinMatrix[1].xyz), length(skinMatrix[2].xyz)));
  #endif
  float pixelWorldSize = orthographicView ? outlinePixelWorldSize : max(-viewPosition.z, .05) * outlinePerspectivePixelSize;
  projectedSourceDiameter = outlineSourceDiameter * outlineModelScale * skinScale / max(pixelWorldSize, 0.00000001);
  vec3 direction = normalize(normalMatrix * objectNormal);
  float expansion = orthographicView ? outlineWorldWidth : outlinePerspectiveWidth * max(-viewPosition.z, .05);
  // Source animations collapse unused props with bone scales. A constant hull
  // must not turn a subpixel collapsed part into a new visible black object.
  viewPosition.xyz += direction * expansion * step(.75, projectedSourceDiameter);
  gl_Position = projectionMatrix * viewPosition;
}`,
      fragmentShader:`
uniform vec3 outlineColor;
varying float projectedSourceDiameter;
void main() {
  if (projectedSourceDiameter < .75) discard;
  gl_FragColor = vec4(outlineColor, 1.0);
  #include <colorspace_fragment>
}`
    });
    const outline = parent.isSkinnedMesh ? new THREE.SkinnedMesh(parent.geometry,material) : new THREE.Mesh(parent.geometry,material);
    if (parent.isSkinnedMesh) outline.bind(parent.skeleton,parent.bindMatrix);
    outline.name=parent.name+'__outline';outline.userData.isOutline=true;
    outline.frustumCulled=false;outline.renderOrder=-1;
    outline.morphTargetInfluences=parent.morphTargetInfluences;outline.morphTargetDictionary=parent.morphTargetDictionary;
    parent.add(outline);pairs.push({parent,outline});materials.push(material);
  }
  let enabled=true;
  return {
    root,pairs,
    update(camera,cssHeight,referenceHeight) {
      // Orthographic windows may expand for props. Calibrate by character size,
      // not camera distance or the expanded viewport, so line weight stays stable.
      const orthographic=Boolean(camera.isOrthographicCamera);
      const cssWidth=orthographic ? Math.max(.45,referenceHeight*.0005/(2*Math.tan(35*Math.PI/360))) : cssHeight*.0005/(2*Math.tan(camera.fov*Math.PI/360));
      const worldWidth=orthographic ? cssWidth*(camera.top-camera.bottom)/(camera.zoom*Math.max(cssHeight,1)) : 0;
      for (const material of materials) {
        material.uniforms.orthographicView.value=orthographic;
        material.uniforms.outlineWorldWidth.value=worldWidth;
        material.uniforms.outlinePixelWorldSize.value=orthographic ? (camera.top-camera.bottom)/(camera.zoom*Math.max(cssHeight,1)) : 1;
        material.uniforms.outlinePerspectivePixelSize.value=orthographic ? 1 : 2*Math.tan(camera.fov*Math.PI/360)/Math.max(cssHeight,1);
      }
      for (const {parent,outline} of pairs) {
        parent.updateWorldMatrix(true,false);
        const elements=parent.matrixWorld.elements;
        outline.material.uniforms.outlineModelScale.value=Math.max(...[0,4,8].map(i=>Math.hypot(elements[i],elements[i+1],elements[i+2])));
        outline.visible=enabled;
        // Source facial/prop morph arrays can be replaced after a load/seek.
        outline.morphTargetInfluences=parent.morphTargetInfluences;
      }
      return {enabled,meshCount:pairs.length,cssWidth};
    },
    setEnabled(value) {enabled=Boolean(value);for(const {outline} of pairs)outline.visible=enabled;},
    get enabled() {return enabled;},
    dispose() {for(const {outline} of pairs)outline.removeFromParent();for(const material of materials)material.dispose();pairs.length=0;materials.length=0;}
  };
}
