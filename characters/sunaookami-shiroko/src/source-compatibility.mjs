// The source exporter wrote a few non-unit CUBICSPLINE keys. Runtime GLBs have
// valid transport accessors; restore the exact original keys AND tangents before
// constructing mixers. Preserve GLTFLoader's cubic quaternion interpolant.
export async function restoreOriginalCubicCurves(gltf) {
  const bindings = gltf.parser.json.extras?.sourceCubicQuaternionBindings || [];
  for (const binding of bindings) {
    const animation = gltf.animations[binding.animationIndex];
    const node = await gltf.parser.getDependency('node', binding.nodeIndex);
    const accessor = await gltf.parser.getDependency('accessor', binding.accessorIndex);
    const track = animation?.tracks.find(item => item.name === node.name + '.quaternion');
    if (!track || !track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline || accessor.itemSize !== 4 || accessor.array.length !== track.values.length) {
      throw new Error('Original cubic quaternion binding is incomplete');
    }
    track.values = accessor.array.slice();
  }
  return bindings.length;
}

// Unlit source rendering must retain even the source export's zero normals.
// Transport copies satisfy glTF validation; restore exact originals at load time.
export async function restoreOriginalNormals(gltf) {
  const bindings = gltf.parser.json.extras?.sourceNormalBindings || [];
  for (const binding of bindings) {
    const accessor = await gltf.parser.getDependency('accessor', binding.accessorIndex);
    let matched = 0;
    gltf.scene.traverse(node => {
      const association = gltf.parser.associations.get(node);
      if (association?.meshes !== binding.meshIndex || association?.primitives !== binding.primitiveIndex || !node.isMesh) return;
      if (accessor.itemSize !== 3 || accessor.count !== node.geometry.attributes.position.count) throw new Error('Original normal binding is incomplete');
      node.geometry.setAttribute('normal', accessor.clone()); matched++;
    });
    if (!matched) throw new Error('Original normal binding is incomplete');
  }
  return bindings.length;
}
