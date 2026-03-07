import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// Reusable frustum for LOD visibility culling (OPT-2)
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();

export function parseZoneName(name) {
  const match = /^zone_(\d{2})_(\d{2})$/i.exec(name || '');
  if (!match) return null;
  return {
    cx: Number(match[1]),
    cz: Number(match[2]),
  };
}

function createLineGroup({
  parent,
  position,
  rotation,
  scale,
  edgesGeometry,
  coreMaterial,
  haloMaterial,
  renderOrder,
}) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.copy(rotation);
  group.scale.copy(scale);

  // OPT-1: build ONE LineSegmentsGeometry and share it between core and halo.
  // Both LineSegments2 objects reference the same vertex buffer on the GPU;
  // only the material (width, opacity, blending) differs.
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(edgesGeometry.attributes.position.array);
  geometry.computeBoundingSphere();

  const core = new LineSegments2(geometry, coreMaterial);
  core.renderOrder = renderOrder.cityLineCore;
  core.frustumCulled = true;
  group.add(core);

  const halo = new LineSegments2(geometry, haloMaterial);
  halo.renderOrder = renderOrder.cityLineHalo;
  halo.frustumCulled = true;
  group.add(halo);

  parent.add(group);
  return group;
}

export function applyMeshToLod({
  mesh,
  isMobile,
  config,
  cityBaseMaterial,
  cityLineCoreMaterial,
  cityLineHaloMaterial,
  lodObjects,
}) {
  mesh.material = cityBaseMaterial;
  mesh.renderOrder = config.renderOrder.cityMesh;
  mesh.geometry.computeBoundingSphere();
  const center = mesh.geometry.boundingSphere.center.clone().applyMatrix4(mesh.matrixWorld);

  let fullEdges;
  let coarseEdges;
  try {
    fullEdges = new THREE.EdgesGeometry(mesh.geometry, config.lod.fullEdgeAngleDeg);
  } catch {
    return;
  }

  if (!fullEdges.attributes.position.count) return;

  try {
    coarseEdges = new THREE.EdgesGeometry(mesh.geometry, config.lod.coarseEdgeAngleDeg);
  } catch {
    coarseEdges = fullEdges;
  }

  const position = mesh.position.clone();
  const rotation = mesh.rotation.clone();
  const scale = mesh.scale.clone();

  if (isMobile) {
    let silhouetteEdges;
    try {
      silhouetteEdges = new THREE.EdgesGeometry(mesh.geometry, config.lod.mobileSilhouetteEdgeAngleDeg);
    } catch {
      silhouetteEdges = coarseEdges;
    }

    const full = createLineGroup({
      parent: mesh.parent,
      position,
      rotation,
      scale,
      edgesGeometry: fullEdges,
      coreMaterial: cityLineCoreMaterial,
      haloMaterial: cityLineHaloMaterial,
      renderOrder: config.renderOrder,
    });

    const coarse = createLineGroup({
      parent: mesh.parent,
      position,
      rotation,
      scale,
      edgesGeometry: coarseEdges,
      coreMaterial: cityLineCoreMaterial,
      haloMaterial: cityLineHaloMaterial,
      renderOrder: config.renderOrder,
    });

    const silhouette = createLineGroup({
      parent: mesh.parent,
      position,
      rotation,
      scale,
      edgesGeometry: silhouetteEdges,
      coreMaterial: cityLineCoreMaterial,
      haloMaterial: cityLineHaloMaterial,
      renderOrder: config.renderOrder,
    });

    coarse.visible = false;
    silhouette.visible = false;
    lodObjects.push({ full, coarse, sil: silhouette, center, mesh });
    return;
  }

  const full = createLineGroup({
    parent: mesh.parent,
    position,
    rotation,
    scale,
    edgesGeometry: fullEdges,
    coreMaterial: cityLineCoreMaterial,
    haloMaterial: cityLineHaloMaterial,
    renderOrder: config.renderOrder,
  });

  const coarse = createLineGroup({
    parent: mesh.parent,
    position,
    rotation,
    scale,
    edgesGeometry: coarseEdges,
    coreMaterial: cityLineCoreMaterial,
    haloMaterial: cityLineHaloMaterial,
    renderOrder: config.renderOrder,
  });

  coarse.visible = false;
  lodObjects.push({ full, coarse, sil: null, center, mesh });
}

export function updateLodVisibility({
  camera,
  lodObjects,
  lockedCenters,
  isMobile,
  lodNear,
  lodFar,
  cameraWorldPosition,
}) {
  // OPT-2: build the frustum once per frame so objects outside the view
  // volume can skip the distanceTo() call entirely.
  _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_projScreenMatrix);

  cameraWorldPosition.copy(camera.position);
  for (const { full, coarse, sil, center, mesh } of lodObjects) {
    if (lockedCenters.has(center)) continue;

    // OPT-2: if the mesh bounding sphere is outside the frustum, show the
    // cheapest LOD level and skip the distance calculation.
    const sphere = mesh.geometry.boundingSphere;
    if (sphere) {
      // Transform sphere centre to world space using the mesh world matrix.
      const worldRadius = sphere.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z);
      const inFrustum = _frustum.containsPoint(center) || _frustum.intersectsSphere(
        { center, radius: worldRadius },
      );
      if (!inFrustum) {
        // Off screen — keep cheapest level visible, hide the rest.
        full.visible = false;
        if (isMobile && sil) {
          coarse.visible = false;
          sil.visible = true;
        } else {
          coarse.visible = true;
        }
        continue;
      }
    }

    const distance = cameraWorldPosition.distanceTo(center);
    if (isMobile && sil) {
      full.visible = distance < lodNear;
      coarse.visible = distance >= lodNear && distance < lodFar;
      sil.visible = distance >= lodFar;
    } else {
      full.visible = distance < lodNear;
      coarse.visible = distance >= lodNear;
    }
  }
}

export function buildGridLookup({
  gridSize,
  zoneObjects,
  lodObjects,
  paddingRatio,
  paddingMin,
}) {
  const emptyGrid = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => [])
  );

  if (zoneObjects.length > 0) {
    const zoneCells = [];
    for (const zoneObject of zoneObjects) {
      if (zoneObject.cx == null || zoneObject.cz == null) continue;
      emptyGrid[zoneObject.cx][zoneObject.cz].push(zoneObject);
      zoneCells.push({
        cx: zoneObject.cx,
        cz: zoneObject.cz,
        entries: [zoneObject],
        center: zoneObject.center.clone(),
      });
    }

    return {
      grid: emptyGrid,
      zoneCells,
      gridMinX: 0,
      gridMinZ: 0,
      gridCellW: 1,
      gridCellD: 1,
      source: 'zoned',
    };
  }

  if (lodObjects.length === 0) {
    return {
      grid: emptyGrid,
      zoneCells: [],
      gridMinX: 0,
      gridMinZ: 0,
      gridCellW: 1,
      gridCellD: 1,
      source: 'empty',
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const lodObject of lodObjects) {
    minX = Math.min(minX, lodObject.center.x);
    maxX = Math.max(maxX, lodObject.center.x);
    minZ = Math.min(minZ, lodObject.center.z);
    maxZ = Math.max(maxZ, lodObject.center.z);
  }

  const padX = (maxX - minX) * paddingRatio + paddingMin;
  const padZ = (maxZ - minZ) * paddingRatio + paddingMin;
  const gridMinX = minX - padX;
  const gridMinZ = minZ - padZ;
  const gridCellW = (maxX - minX + padX * 2) / gridSize;
  const gridCellD = (maxZ - minZ + padZ * 2) / gridSize;

  for (const lodObject of lodObjects) {
    const cellX = Math.floor((lodObject.center.x - gridMinX) / gridCellW);
    const cellZ = Math.floor((lodObject.center.z - gridMinZ) / gridCellD);
    const safeX = Math.max(0, Math.min(gridSize - 1, cellX));
    const safeZ = Math.max(0, Math.min(gridSize - 1, cellZ));
    emptyGrid[safeX][safeZ].push(lodObject);
  }

  const zoneCells = [];
  for (let cx = 0; cx < gridSize; cx++) {
    for (let cz = 0; cz < gridSize; cz++) {
      const entries = emptyGrid[cx][cz];
      if (entries.length < 1) continue;

      const zoneCenter = new THREE.Vector3();
      for (const entry of entries) zoneCenter.add(entry.center);
      zoneCenter.divideScalar(entries.length);
      zoneCells.push({ cx, cz, entries, center: zoneCenter });
    }
  }

  return {
    grid: emptyGrid,
    zoneCells,
    gridMinX,
    gridMinZ,
    gridCellW,
    gridCellD,
    source: 'visual',
  };
}
