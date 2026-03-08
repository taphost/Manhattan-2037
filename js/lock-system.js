import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

function makeZoneClipPlanes(box) {
  return [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.min.x),
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.max.x),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.min.z),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), box.max.z),
  ];
}

function cloneLockLines({
  sourceGroup,
  clipPlanes,
  lockLineCoreMaterial,
  lockLineHaloMaterial,
  renderOrder,
}) {
  const baseGeometry = sourceGroup.children[0]?.geometry;
  if (!baseGeometry) return null;

  // Keep lock clones in world space: source groups may live under transformed GLTF parents.
  sourceGroup.updateWorldMatrix(true, false);

  const group = new THREE.Group();
  sourceGroup.matrixWorld.decompose(group.position, group.quaternion, group.scale);
  group.renderOrder = renderOrder.lockGroup;

  for (const material of [lockLineCoreMaterial, lockLineHaloMaterial]) {
    material.clippingPlanes = clipPlanes;
    const lines = new LineSegments2(baseGeometry, material);
    lines.renderOrder = material === lockLineCoreMaterial
      ? renderOrder.lockLineCore
      : renderOrder.lockLineHalo;
    lines.frustumCulled = false;
    group.add(lines);
  }

  return group;
}

function buildLockSilhouette({
  zoneBox,
  lodObjects,
  lockLineCoreMaterial,
  lockLineHaloMaterial,
  renderOrder,
}) {
  if (zoneBox.isEmpty()) return null;

  const clipPlanes = makeZoneClipPlanes(zoneBox);
  const group = new THREE.Group();
  group.renderOrder = renderOrder.lockGroup;

  for (const lodObject of lodObjects) {
    const clone = cloneLockLines({
      sourceGroup: lodObject.full,
      clipPlanes,
      lockLineCoreMaterial,
      lockLineHaloMaterial,
      renderOrder,
    });
    if (clone) group.add(clone);
  }

  return group.children.length ? group : null;
}

export function createLockController({
  appConfig,
  scene,
  camera,
  state,
  lockCamTarget,
  lockLookTarget,
  lodObjects,
  getZoneCells,
  makeLineMaterial,
  riskLevels,
  riskColors,
  sectors,
  threats,
  uplinkOptions,
  setStatusLine,
}) {
  let lockLineCoreMaterial = null;
  let lockLineHaloMaterial = null;

  function startLock() {
    if (lodObjects.length === 0) return;

    const pool = getZoneCells();
    if (pool.length === 0) {
      setTimeout(
        startLock,
        appConfig.timing.scanToLockDelayMs + Math.random() * appConfig.timing.scanRetryJitterMs,
      );
      return;
    }

    state.lockState = 'locking';

    if (lockLineCoreMaterial) {
      lockLineCoreMaterial.dispose();
      lockLineCoreMaterial = null;
    }
    if (lockLineHaloMaterial) {
      lockLineHaloMaterial.dispose();
      lockLineHaloMaterial = null;
    }

    const risk = riskLevels[Math.floor(Math.random() * riskLevels.length)];
    const riskColor = riskColors[risk.label];
    lockLineCoreMaterial = makeLineMaterial(
      appConfig.lockLines.coreWidth,
      appConfig.lockLines.coreOpacity,
      riskColor,
      true,
    );
    lockLineHaloMaterial = makeLineMaterial(
      appConfig.lockLines.haloWidth,
      appConfig.lockLines.haloOpacity,
      riskColor,
      true,
    );

    const zoneIndex = Math.floor(Math.random() * pool.length);
    const zone = pool[zoneIndex];
    console.log(`[lock] zone ${zoneIndex}/${pool.length} cx=${zone.cx} cz=${zone.cz} meshes=${zone.entries.length}`);

    const zoneCenter = zone.center.clone();
    const toCamera = new THREE.Vector3().subVectors(camera.position, zoneCenter);
    const planarRadius = Math.hypot(toCamera.x, toCamera.z);
    const safePlanarRadius = Math.max(planarRadius, appConfig.lock.minOrbitRadius);
    state.lockZoneCenter = zoneCenter;
    state.lockOrbitStartAngle = Math.atan2(toCamera.x, toCamera.z);
    state.lockOrbitRadiusStart = safePlanarRadius;
    state.lockOrbitRadiusEnd = Math.max(
      safePlanarRadius * appConfig.camera.lockZoom,
      appConfig.lock.minOrbitRadius,
    );
    state.lockOrbitHeight = toCamera.y * appConfig.lock.orbitHeightFactor;
    state.lockStartedAtMs = performance.now();
    state.blinkPhase = 0;
    state.reticleEnabled = true;
    state.lockTargetRadius = 0; // Will be set below

    state.lockedCenters = new Set(zone.entries.map((entry) => entry.center));
    state.lockedLod = zone.entries.reduce((best, current) => {
      const bestRadius = (best.mesh.geometry.boundingSphere?.radius ?? 0)
        * Math.max(best.mesh.scale.x, best.mesh.scale.y, best.mesh.scale.z);
      const currentRadius = (current.mesh.geometry.boundingSphere?.radius ?? 0)
        * Math.max(current.mesh.scale.x, current.mesh.scale.y, current.mesh.scale.z);
      return currentRadius > bestRadius ? current : best;
    });

    state.lockTargetRadius = (state.lockedLod.mesh.geometry.boundingSphere?.radius ?? 1)
      * Math.max(state.lockedLod.mesh.scale.x, state.lockedLod.mesh.scale.y, state.lockedLod.mesh.scale.z);

    if (state.lockSilhouetteGroup) scene.remove(state.lockSilhouetteGroup);
    const zoneBox = new THREE.Box3();
    for (const entry of zone.entries) zoneBox.union(entry.box);
    zoneBox.expandByScalar(
      zoneBox.getSize(new THREE.Vector3()).length() * appConfig.lock.clipPaddingRatio
      + appConfig.lock.clipPaddingMin,
    );
    state.lockSilhouetteGroup = buildLockSilhouette({
      zoneBox,
      lodObjects,
      lockLineCoreMaterial,
      lockLineHaloMaterial,
      renderOrder: appConfig.renderOrder,
    });
    if (state.lockSilhouetteGroup) scene.add(state.lockSilhouetteGroup);

    lockCamTarget.copy(camera.position).lerp(zoneCenter, appConfig.camera.lockPull);
    lockLookTarget.copy(zoneCenter);
    const buildingNumber = String(
      Math.floor(Math.random() * appConfig.lock.buildingIdRange) + appConfig.lock.buildingIdBase,
    );
    const sector = sectors[Math.floor(Math.random() * sectors.length)];
    const threat = threats[Math.floor(Math.random() * threats.length)];
    const rawName = state.lockedLod.mesh.name || '';
    const label = rawName && !/^mesh|^object|^zone_|^\s*$/i.test(rawName)
      ? rawName.replace(/_/g, ' ').toUpperCase().slice(0, appConfig.lock.labelMaxLength)
      : `BLD-${buildingNumber}`;

    document.getElementById('t-name').textContent = label;
    document.getElementById('t-sector').textContent = `ZONE ${sector}`;
    const riskElement = document.getElementById('t-risk');
    riskElement.textContent = risk.label;
    riskElement.className = `pval ${risk.cls}`;
    document.getElementById('t-threat').textContent = threat;
    document.getElementById('t-uplink').textContent =
      uplinkOptions[Math.floor(Math.random() * uplinkOptions.length)];

    const reticleEl = document.getElementById('reticle');
    if (reticleEl) {
      reticleEl.style.setProperty('--reticle-color', `#${riskColor.toString(16).padStart(6, '0')}`);
      reticleEl.style.display = 'block';
      document.body.classList.add('reticle-acquiring');
    }

    if (!state.panelEverShown) {
      document.getElementById('target-panel').style.display = 'block';
      state.panelEverShown = true;
    }

    state.lockTimer = setTimeout(exitLock, appConfig.timing.lockDurationMs);
  }

  function exitLock() {
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }

    state.lockState = 'exiting';

    if (state.lockSilhouetteGroup) {
      scene.remove(state.lockSilhouetteGroup);
      state.lockSilhouetteGroup = null;
    }
    state.reticleEnabled = false;
    const reticleEl = document.getElementById('reticle');
    if (reticleEl) reticleEl.style.display = 'none';
    document.body.classList.remove('reticle-acquiring');

    state.lockedLod = null;
    state.lockedCenters = new Set();
    state.lockZoneCenter = null;
    state.lockOrbitStartAngle = 0;
    state.lockOrbitRadiusStart = 0;
    state.lockOrbitRadiusEnd = 0;
    state.lockOrbitHeight = 0;
    state.lockStartedAtMs = 0;

    setTimeout(() => {
      state.lockState = 'idle';
      startScanning();
    }, appConfig.timing.lockExitDelayMs);
  }

  function startScanning() {
    setStatusLine('SCANNING...', true);
    setTimeout(
      startLock,
      appConfig.timing.scanToLockDelayMs + Math.random() * appConfig.timing.scanRetryJitterMs,
    );
  }

  function tickLockVisibility(deltaTime) {
    if (state.lockState !== 'locking' || !state.lockedLod) return;

    const elapsed = performance.now() - state.lockStartedAtMs;
    const isAcquiring = elapsed < 2500; // First 2.5s is acquiring

    if (isAcquiring) {
      setStatusLine('ACQUIRING TARGET...', true);
      document.body.classList.add('reticle-acquiring');
    } else {
      setStatusLine('TARGET LOCKED', false);
      document.body.classList.remove('reticle-acquiring');
    }

    state.blinkPhase += deltaTime * appConfig.lock.blinkRateHz;
    if (state.lockSilhouetteGroup) {
      state.lockSilhouetteGroup.visible = Math.sin(state.blinkPhase * Math.PI) > 0;
    }

    // Update screen-space reticle based on the building's 3D volume
    const reticleEl = document.getElementById('reticle');
    if (reticleEl && state.reticleEnabled && state.lockedLod) {
      const mesh = state.lockedLod.mesh;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      
      const box = mesh.geometry.boundingBox;
      const matrix = mesh.matrixWorld;
      
      // Strict frustum check using the building's center
      const frustum = new THREE.Frustum();
      const projScreenMatrix = new THREE.Matrix4();
      projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projScreenMatrix);

      if (frustum.containsPoint(state.lockZoneCenter)) {
        // Project all 8 corners of the 3D bounding box to find the screen-space bounds
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const v of corners) {
          v.applyMatrix4(matrix).project(camera);
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }

        // Safety: ensure the projected box is valid and on-screen
        if (maxX > -1 && minX < 1 && maxY > -1 && minY < 1) {
          const screenXMin = (minX * 0.5 + 0.5) * window.innerWidth;
          const screenXMax = (maxX * 0.5 + 0.5) * window.innerWidth;
          const screenYMin = (-(maxY * 0.5) + 0.5) * window.innerHeight;
          const screenYMax = (-(minY * 0.5) + 0.5) * window.innerHeight;

          const centerX = (screenXMin + screenXMax) / 2;
          const centerY = (screenYMin + screenYMax) / 2;
          const width = screenXMax - screenXMin;
          const height = screenYMax - screenYMin;
          
          // Make it square based on the largest dimension to frame the building
          const boxSize = Math.max(width, height) + 30; // 30px padding

          reticleEl.style.left = `${centerX}px`;
          reticleEl.style.top = `${centerY}px`;
          reticleEl.style.width = `${boxSize}px`;
          reticleEl.style.height = `${boxSize}px`;
          reticleEl.style.display = 'block';
        } else {
          reticleEl.style.display = 'none';
        }
      } else {
        reticleEl.style.display = 'none';
      }
    }
  }

  return {
    startScanning,
    startLock,
    exitLock,
    tickLockVisibility,
  };
}
