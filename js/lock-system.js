import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { createTypewriter } from './typewriter.js';

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
  let scanTimer = null;
  let exitTimer = null;
  let interruptTimer = null;
  const panelTypewriter = createTypewriter({ jitterMs: appConfig.hud.valueTypeJitterMs });
  let panelSequenceToken = 0;
  let panelBootTypePending = true;
  let panelShowingPlaceholders = false;
  const panelPendingText = '';
  const targetPanelRows = [
    { id: 't-name', label: 'TARGET  ' },
    { id: 't-sector', label: 'SECTOR  ' },
    { id: 't-risk', label: 'RISK    ' },
    { id: 't-threat', label: 'THREAT  ' },
    { id: 't-uplink', label: 'UPLINK  ' },
  ];

  function clearScanTimer() {
    if (!scanTimer) return;
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  function clearExitTimer() {
    if (!exitTimer) return;
    clearTimeout(exitTimer);
    exitTimer = null;
  }

  function clearInterruptTimer() {
    if (!interruptTimer) return;
    clearTimeout(interruptTimer);
    interruptTimer = null;
  }

  function buildTargetPanelRows(valueMap, rowOptions = {}) {
    return targetPanelRows.map((row) => ({
      ...row,
      text: valueMap[row.id] ?? panelPendingText,
      onBeforeType: rowOptions[row.id]?.onBeforeType ?? null,
    }));
  }

  function setTargetPanelValueClasses({ pending = false, riskClass = null } = {}) {
    for (const row of targetPanelRows) {
      const valueElement = document.getElementById(row.id);
      if (!valueElement) continue;
      valueElement.className = 'pval';
      valueElement.classList.toggle('pending', pending);
      if (row.id === 't-risk' && riskClass) {
        valueElement.classList.add(riskClass);
      }
    }
  }

  function clearTargetPanelText() {
    for (const row of targetPanelRows) {
      const valueElement = document.getElementById(row.id);
      if (!valueElement) continue;
      valueElement.textContent = '';
      const labelElement = valueElement.closest('.prow')?.querySelector('.plbl');
      if (labelElement) {
        labelElement.textContent = '';
      }
    }
    panelShowingPlaceholders = false;
  }

  function typewritePanelRows(rows, { includeLabels = false, withCursor = true } = {}) {
    const token = ++panelSequenceToken;
    const preparedRows = rows
      .map((row) => {
        const valueElement = document.getElementById(row.id);
        const labelElement = includeLabels
          ? valueElement?.closest('.prow')?.querySelector('.plbl') ?? null
          : null;
        return {
          label: row.label ?? '',
          text: row.text,
          valueElement,
          labelElement,
          onBeforeType: row.onBeforeType ?? null,
        };
      })
      .filter((row) => row.valueElement);
    let index = 0;

    function nextRow() {
      if (token !== panelSequenceToken) return;
      if (index >= preparedRows.length) return;
      const row = preparedRows[index++];
      row.onBeforeType?.();

      panelTypewriter.typewrite({
        labelElement: includeLabels ? row.labelElement : null,
        label: includeLabels ? row.label : '',
        valueElement: row.valueElement,
        value: row.text,
        charDelayMs: appConfig.timing.hudCharDelayMs,
        withCursor,
        onDone: () => setTimeout(nextRow, appConfig.timing.hudLineGapMs),
      });
    }

    nextRow();
  }

  function ensureTargetPanelVisible() {
    if (state.panelEverShown) return;
    const targetPanel = document.getElementById('target-panel');
    if (!targetPanel) return;
    clearTargetPanelText();
    targetPanel.style.display = 'block';
    state.panelEverShown = true;
  }

  function hideReticle(reticleEl) {
    if (!reticleEl) return;
    reticleEl.style.display = 'none';
    reticleEl.style.opacity = '0';
    reticleEl.style.visibility = 'hidden';
    // Keep it far from viewport in case a stale frame flips display back.
    reticleEl.style.left = '-200vw';
    reticleEl.style.top = '-200vh';
  }

  function clearLockVisuals() {
    if (state.lockSilhouetteGroup) {
      scene.remove(state.lockSilhouetteGroup);
      state.lockSilhouetteGroup = null;
    }
    state.reticleEnabled = false;
    hideReticle(document.getElementById('reticle'));
    document.body.classList.remove('reticle-acquiring');
  }

  function resetTargetPanel() {
    setTargetPanelValueClasses({ pending: true });
    const includeLabels = panelBootTypePending && state.panelEverShown;
    if (panelShowingPlaceholders && !includeLabels) return;
    typewritePanelRows(
      buildTargetPanelRows({
        't-name': panelPendingText,
        't-sector': panelPendingText,
        't-risk': panelPendingText,
        't-threat': panelPendingText,
        't-uplink': panelPendingText,
      }),
      { includeLabels, withCursor: false },
    );
    panelShowingPlaceholders = true;
    if (includeLabels) {
      panelBootTypePending = false;
    }
  }

  function fillTargetPanel({
    label,
    sector,
    risk,
    threat,
    uplink,
  }) {
    setTargetPanelValueClasses({ pending: false });
    panelShowingPlaceholders = false;
    typewritePanelRows(
      buildTargetPanelRows(
        {
          't-name': label,
          't-sector': `ZONE ${sector}`,
          't-risk': risk.label,
          't-threat': threat,
          't-uplink': uplink,
        },
        {
          't-risk': {
            onBeforeType: () => {
              const riskElement = document.getElementById('t-risk');
              if (!riskElement) return;
              riskElement.className = `pval ${risk.cls}`;
            },
          },
        },
      ),
    );
  }

  function clearLockTargetState() {
    state.lockedLod = null;
    state.lockedCenters = new Set();
    state.lockZoneCenter = null;
    state.lockOrbitStartAngle = 0;
    state.lockOrbitRadiusStart = 0;
    state.lockOrbitRadiusEnd = 0;
    state.lockOrbitHeight = 0;
    state.lockStartedAtMs = 0;
    state.lockTargetRadius = 0;
    resetTargetPanel();
  }

  function startLock() {
    if (!state.autoPilot || state.controlMode !== 'autopilot') return;
    if (lodObjects.length === 0) return;

    const pool = getZoneCells();
    if (pool.length === 0) {
      startScanning();
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

    ensureTargetPanelVisible();
    fillTargetPanel({
      label,
      sector,
      risk,
      threat,
      uplink: uplinkOptions[Math.floor(Math.random() * uplinkOptions.length)],
    });

    const reticleEl = document.getElementById('reticle');
    if (reticleEl) {
      reticleEl.style.setProperty('--reticle-color', `#${riskColor.toString(16).padStart(6, '0')}`);
      hideReticle(reticleEl);
      document.body.classList.add('reticle-acquiring');
    }

    state.lockTimer = setTimeout(() => exitLock({ resumeScanning: true }), appConfig.timing.lockDurationMs);
  }

  function exitLock({ resumeScanning = true } = {}) {
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }
    clearScanTimer();
    clearInterruptTimer();

    state.lockState = 'exiting';
    // Avoid stale "TARGET LOCKED" text while lock visuals are already cleared.
    setStatusLine(resumeScanning ? 'SCANNING...' : 'AUTOPILOT', !!resumeScanning);

    clearLockVisuals();
    clearLockTargetState();

    clearExitTimer();
    exitTimer = setTimeout(() => {
      exitTimer = null;
      state.lockState = 'idle';
      if (resumeScanning && state.autoPilot && state.controlMode === 'autopilot') {
        startScanning();
      }
    }, appConfig.timing.lockExitDelayMs);
  }

  function startScanning({ initialDelayMs = 0 } = {}) {
    clearScanTimer();
    if (!state.autoPilot || state.controlMode !== 'autopilot') {
      state.lockState = 'idle';
      return;
    }

    const wasScanning = state.lockState === 'scanning';
    state.lockState = 'scanning';
    ensureTargetPanelVisible();
    if (!wasScanning) {
      resetTargetPanel();
    }
    setStatusLine('SCANNING...', true);
    const delay = Math.max(0, initialDelayMs)
      + appConfig.timing.scanToLockDelayMs
      + Math.random() * appConfig.timing.scanRetryJitterMs;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      startLock();
    }, delay);
  }

  function pauseForManual() {
    clearScanTimer();
    clearExitTimer();
    clearInterruptTimer();
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }
    clearLockVisuals();
    clearLockTargetState();
    state.lockState = 'idle';
  }

  function interruptToManual({
    durationMs = appConfig.timing.lockInterruptDurationMs,
    onDone,
  } = {}) {
    clearScanTimer();
    clearExitTimer();
    clearInterruptTimer();
    if (state.lockTimer) {
      clearTimeout(state.lockTimer);
      state.lockTimer = null;
    }

    clearLockVisuals();
    clearLockTargetState();
    state.lockState = 'interrupting';
    setStatusLine('INTERRUPTING...', true);

    interruptTimer = setTimeout(() => {
      interruptTimer = null;
      state.lockState = 'idle';
      onDone?.();
    }, Math.max(0, durationMs));
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
    if (reticleEl && state.reticleEnabled && state.lockedLod && state.lockZoneCenter) {
      const mesh = state.lockedLod.mesh;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      
      const box = mesh.geometry.boundingBox;
      
      // Force world matrix update for both camera and mesh to ensure sync
      camera.updateMatrixWorld(true);
      mesh.updateWorldMatrix(true, false);
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

          // Hard lock: any invalid/depth-clipped corner cancels reticle for this frame.
          if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z) || v.z > 1 || v.z < -1) {
            hideReticle(reticleEl);
            return;
          }

          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
        }

        // Safety: ensure the projected box is valid, on-screen, and finite
        if (maxX > -1 && minX < 1 && maxY > -1 && minY < 1 && Number.isFinite(minX)) {
          const screenXMin = (minX * 0.5 + 0.5) * window.innerWidth;
          const screenXMax = (maxX * 0.5 + 0.5) * window.innerWidth;
          const screenYMin = (-(maxY * 0.5) + 0.5) * window.innerHeight;
          const screenYMax = (-(minY * 0.5) + 0.5) * window.innerHeight;

          const centerX = (screenXMin + screenXMax) / 2;
          const centerY = (screenYMin + screenYMax) / 2;
          const width = screenXMax - screenXMin;
          const height = screenYMax - screenYMin;

          if (
            !Number.isFinite(centerX)
            || !Number.isFinite(centerY)
            || !Number.isFinite(width)
            || !Number.isFinite(height)
            || width <= 0
            || height <= 0
          ) {
            hideReticle(reticleEl);
            return;
          }
          
          // Sanity check for massive sizes (could happen during extreme camera proximity)
          const maxBox = Math.min(window.innerWidth, window.innerHeight) * 0.95;
          const boxSize = Math.max(40, Math.min(maxBox, Math.max(width, height) + 30));

          reticleEl.style.left = `${centerX}px`;
          reticleEl.style.top = `${centerY}px`;
          reticleEl.style.width = `${boxSize}px`;
          reticleEl.style.height = `${boxSize}px`;
          reticleEl.style.opacity = '1';
          reticleEl.style.visibility = 'visible';
          // Flip to visible only after a valid position/size has been written.
          reticleEl.style.display = 'block';
        } else {
          hideReticle(reticleEl);
        }
      } else {
        hideReticle(reticleEl);
      }
    } else {
      hideReticle(reticleEl);
    }
  }

  return {
    startScanning,
    startLock,
    exitLock,
    pauseForManual,
    interruptToManual,
    tickLockVisibility,
  };
}
