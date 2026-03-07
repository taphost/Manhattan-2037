import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function loadGLTF(loader, path) {
  return new Promise((resolve, reject) => {
    loader.load(path, resolve, null, reject);
  });
}

export async function loadModelPair({ visualModelPath, zoneModelPath }) {
  const loader = new GLTFLoader();
  const [visualGltf, zoneGltf] = await Promise.all([
    loadGLTF(loader, visualModelPath),
    loadGLTF(loader, zoneModelPath),
  ]);
  return { visualGltf, zoneGltf };
}

export function computeSceneMetrics(sceneObject) {
  const box = new THREE.Box3().setFromObject(sceneObject);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  return {
    box,
    center,
    size,
    maxDim,
  };
}

export function collectZoneObjects({ zoneScene, parseZoneName }) {
  const zoneObjects = [];
  zoneScene.updateWorldMatrix(true, true);

  zoneScene.traverse((node) => {
    if (!node.isMesh) return;

    node.visible = false;
    node.geometry.computeBoundingBox();
    node.geometry.computeBoundingSphere();

    const localBox = node.geometry.boundingBox?.clone();
    if (!localBox) return;

    const worldBox = localBox.applyMatrix4(node.matrixWorld);
    const center = worldBox.getCenter(new THREE.Vector3());
    const zone = parseZoneName(node.name);

    zoneObjects.push({
      mesh: node,
      center,
      box: worldBox.clone(),
      cx: zone?.cx ?? null,
      cz: zone?.cz ?? null,
    });
  });

  return zoneObjects;
}

export function collectVisualMeshes(visualScene) {
  const meshes = [];
  visualScene.traverse((node) => {
    if (node.isMesh) meshes.push(node);
  });
  return meshes;
}
