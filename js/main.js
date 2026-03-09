import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { APP_CONFIG, HUD_LINES, PANORAMA_KEYFRAME_TEMPLATES, RISK_LEVELS, SECTORS, THREATS } from './config.js';
import { createAppState } from './state.js';
import {
  applyPanoramaToCamera,
  buildPanoramaKeyframes,
  findNearestPanoramaTime,
  samplePanoramaPose,
} from './panorama.js';
import { applyMeshToLod, buildGridLookup, parseZoneName, updateLodVisibility } from './lod.js';
import { collectVisualMeshes, collectZoneObjects, computeSceneMetrics, loadModelPair } from './loader.js';
import { createLockController } from './lock-system.js';

const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || innerWidth < 768;
const COLOR_GREEN = APP_CONFIG.colors.green;
const COLOR_BG = APP_CONFIG.colors.background;

const LOCK_UPLINK_OPTIONS = [
  'SAT-7 RELAY',
  'GND-ECHO-3',
  'MESH-NODE-11',
  'UPLINK-BRAVO',
  'DARKNET-44',
  'RELAY-SIGMA',
  'NODE-FOXTROT',
  'SAT-12 DIRECT',
];

const state = createAppState();
const cityCenter = new THREE.Vector3();
let hudBootComplete = false;
let worldBootComplete = false;
let bootInitializeTimer = null;
let hudSequenceComplete = false;

const renderer = new THREE.WebGLRenderer({
  antialias: !IS_MOBILE,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(IS_MOBILE ? 1 : Math.min(devicePixelRatio, APP_CONFIG.renderer.maxPixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.localClippingEnabled = true;
renderer.domElement.style.display = 'none';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLOR_BG);
scene.fog = new THREE.FogExp2(COLOR_BG, APP_CONFIG.fog.defaultDensity);

const camera = new THREE.PerspectiveCamera(
  APP_CONFIG.camera.fovDeg,
  innerWidth / innerHeight,
  APP_CONFIG.camera.defaultNear,
  APP_CONFIG.camera.defaultFar,
);
camera.position.set(
  APP_CONFIG.camera.defaultPosition.x,
  APP_CONFIG.camera.defaultPosition.y,
  APP_CONFIG.camera.defaultPosition.z,
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = APP_CONFIG.controls.dampingFactor;
controls.minDistance = APP_CONFIG.controls.minDistance;
controls.maxDistance = APP_CONFIG.controls.maxDistance;
controls.maxPolarAngle = Math.PI * APP_CONFIG.controls.maxPolarAngleMultiplier;
controls.enabled = false;

scene.add(new THREE.AmbientLight(COLOR_GREEN, APP_CONFIG.scene.ambientIntensity));
const sun = new THREE.DirectionalLight(COLOR_GREEN, APP_CONFIG.scene.directionalIntensity);
sun.position.set(
  APP_CONFIG.scene.directionalPosition.x,
  APP_CONFIG.scene.directionalPosition.y,
  APP_CONFIG.scene.directionalPosition.z,
);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(APP_CONFIG.scene.groundSize, APP_CONFIG.scene.groundSize),
  new THREE.MeshBasicMaterial({ color: COLOR_BG }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = APP_CONFIG.scene.groundY;
scene.add(ground);

const viewportResolution = new THREE.Vector2(innerWidth, innerHeight);
const cityBaseMaterial = new THREE.MeshPhongMaterial({
  color: 0x010101,
  emissive: 0x000300,
  shininess: 0,
});

function makeLineMaterial(linewidth, opacity, color, noDepthTest) {
  return new LineMaterial({
    color: color ?? COLOR_GREEN,
    linewidth,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: noDepthTest ? false : true,
    resolution: viewportResolution,
  });
}

const cityLineCoreMaterial = makeLineMaterial(APP_CONFIG.lines.coreWidth, APP_CONFIG.lines.coreOpacity);
const cityLineHaloMaterial = makeLineMaterial(APP_CONFIG.lines.haloWidth, APP_CONFIG.lines.haloOpacity);

function setStatusLine(text, blink) {
  const statusElement = document.getElementById(APP_CONFIG.hud.statusValueElementId);
  statusElement.textContent = text;
  statusElement.classList.toggle('scanning', !!blink);
}

function typewrite(valueElement, labelElement, label, value, charDelayMs, onDone) {
  labelElement.textContent = label;
  valueElement.textContent = '';
  let index = 0;
  const cursor = document.createElement('span');
  cursor.className = 'cur';
  valueElement.appendChild(cursor);

  function tick() {
    if (index >= value.length) {
      cursor.remove();
      onDone?.();
      return;
    }
    cursor.before(document.createTextNode(value[index++]));
    setTimeout(tick, charDelayMs + Math.random() * APP_CONFIG.hud.valueTypeJitterMs);
  }

  tick();
}

function maybeStartBootSequence() {
  if (!hudBootComplete || !worldBootComplete || bootInitializeTimer) return;

  setStatusLine('INITIALIZING...', true);
  bootInitializeTimer = setTimeout(() => {
    bootInitializeTimer = null;
    lockController.startScanning({ initialDelayMs: 0 });
  }, APP_CONFIG.timing.scanStartDelayMs);
}

function runHudSequence(onDone) {
  document.getElementById('hud').style.display = 'block';
  let lineIndex = 0;

  function nextLine() {
    if (lineIndex >= HUD_LINES.length) {
      onDone?.();
      return;
    }
    const { lbl, val } = HUD_LINES[lineIndex];
    typewrite(
      document.getElementById(`val${lineIndex}`),
      document.getElementById(`lbl${lineIndex}`),
      lbl,
      val,
      APP_CONFIG.timing.hudCharDelayMs,
      () => setTimeout(nextLine, APP_CONFIG.timing.hudLineGapMs),
    );
    lineIndex += 1;
  }

  nextLine();
}

function rebuildGrid() {
  const gridData = buildGridLookup({
    gridSize: APP_CONFIG.grid.size,
    zoneObjects: state.zoneObjects,
    lodObjects: state.lodObjects,
    paddingRatio: APP_CONFIG.grid.paddingRatio,
    paddingMin: APP_CONFIG.grid.paddingMin,
  });

  state.grid = gridData.grid;
  state.zoneCells = gridData.zoneCells;
  state.gridMinX = gridData.gridMinX;
  state.gridMinZ = gridData.gridMinZ;
  state.gridCellW = gridData.gridCellW;
  state.gridCellD = gridData.gridCellD;

  if (gridData.source === 'zoned') {
    console.log(`[grid] ${state.zoneCells.length} valid zones from ${state.zoneObjects.length} zoned meshes`);
  } else if (gridData.source === 'visual') {
    console.log(`[grid] ${state.zoneCells.length} valid zones from ${state.lodObjects.length} meshes`);
  }
}

function initPanorama(center, maxDim) {
  cityCenter.copy(center);
  state.cityMaxDim = maxDim;
  state.keyframes = buildPanoramaKeyframes(PANORAMA_KEYFRAME_TEMPLATES, state.cityMaxDim);
  state.lodNear = maxDim * APP_CONFIG.lod.nearDistanceRatio;
  state.lodFar = maxDim * APP_CONFIG.lod.farDistanceRatio;
  state.tourTime = 0;
}

const lockCamTarget = new THREE.Vector3();
const lockLookTarget = new THREE.Vector3();

const lockController = createLockController({
  appConfig: APP_CONFIG,
  scene,
  camera,
  state,
  lockCamTarget,
  lockLookTarget,
  lodObjects: state.lodObjects,
  getZoneCells: () => state.zoneCells,
  makeLineMaterial,
  riskLevels: RISK_LEVELS,
  riskColors: APP_CONFIG.colors.risk,
  sectors: SECTORS,
  threats: THREATS,
  uplinkOptions: LOCK_UPLINK_OPTIONS,
  setStatusLine,
});

async function autoLoad() {
  if (!hudSequenceComplete) return;
  try {
    const { visualGltf, zoneGltf } = await loadModelPair({
      visualModelPath: APP_CONFIG.modelPaths.visual,
      zoneModelPath: APP_CONFIG.modelPaths.zone,
    });

    scene.add(visualGltf.scene);
    scene.add(zoneGltf.scene);

    const { center, maxDim } = computeSceneMetrics(visualGltf.scene);

    scene.fog = new THREE.FogExp2(COLOR_BG, APP_CONFIG.fog.scaledDensityDivisor / maxDim);
    controls.target.set(center.x, center.y * APP_CONFIG.controls.targetYRatio, center.z);
    camera.position.set(
      center.x + maxDim * APP_CONFIG.camera.initialPosScale.x,
      center.y + maxDim * APP_CONFIG.camera.initialPosScale.y,
      center.z + maxDim * APP_CONFIG.camera.initialPosScale.z,
    );
    camera.near = maxDim * APP_CONFIG.camera.nearScale;
    camera.far = maxDim * APP_CONFIG.camera.farScale;
    camera.updateProjectionMatrix();
    controls.maxDistance = maxDim * APP_CONFIG.camera.maxDistanceScale;
    controls.update();

    initPanorama(center, maxDim);
    applyPanoramaToCamera({ camera, keyframes: state.keyframes, cityCenter, t: 0 });
    renderer.domElement.style.display = 'block';

    state.zoneObjects = collectZoneObjects({
      zoneScene: zoneGltf.scene,
      parseZoneName,
    });

    const visualMeshes = collectVisualMeshes(visualGltf.scene);
    let meshIndex = 0;

    function processNextMesh() {
      if (meshIndex >= visualMeshes.length) {
        state.sceneReady = true;
        applyPanoramaToCamera({ camera, keyframes: state.keyframes, cityCenter, t: 0 });
        rebuildGrid();
        worldBootComplete = true;
        maybeStartBootSequence();
        return;
      }

      applyMeshToLod({
        mesh: visualMeshes[meshIndex++],
        isMobile: IS_MOBILE,
        config: APP_CONFIG,
        cityBaseMaterial,
        cityLineCoreMaterial,
        cityLineHaloMaterial,
        lodObjects: state.lodObjects,
      });
      requestAnimationFrame(processNextMesh);
    }

    requestAnimationFrame(processNextMesh);
  } catch (error) {
    console.error('[autoLoad] GLTF error:', error);
  }
}

const clock = new THREE.Timer();
const smoothCamPos = new THREE.Vector3();
const smoothLookAt = new THREE.Vector3();
const cameraWorldPosition = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const autopilotTargetPos = new THREE.Vector3();
const autopilotLookTarget = new THREE.Vector3();
const handoverStartPos = new THREE.Vector3();
const handoverStartLookTarget = new THREE.Vector3();
const handoverTargetPos = new THREE.Vector3();
const handoverTargetLookTarget = new THREE.Vector3();
const handoverCurrentLookTarget = new THREE.Vector3();
const exitAwayDirection = new THREE.Vector3(); // OPT-3: reusable, avoids per-frame allocation
let smoothInited = false;
let handoverStartedAtMs = 0;
let handoverTargetTourTime = 0;

function captureCurrentLookTarget(out) {
  camera.getWorldDirection(cameraForward);
  out.copy(camera.position).addScaledVector(cameraForward, Math.max(state.cityMaxDim * 0.25, 1));
}

function setControlMode(mode) {
  state.controlMode = mode;
  state.autoPilot = mode === 'autopilot';
  controls.enabled = mode === 'manual';
}

function enterManualMode() {
  setControlMode('manual');
  captureCurrentLookTarget(controls.target);
  controls.update();
  smoothInited = false;
  lockController.pauseForManual();
  setStatusLine('MANUAL CONTROL', false);
}

function startAutopilotHandover(nowMs = performance.now()) {
  if (!state.keyframes.length) {
    setControlMode('autopilot');
    lockController.startScanning({ initialDelayMs: APP_CONFIG.timing.scanResumeDelayMs });
    setStatusLine('AUTOPILOT', false);
    return;
  }

  handoverStartPos.copy(camera.position);
  captureCurrentLookTarget(handoverStartLookTarget);
  handoverTargetTourTime = findNearestPanoramaTime({
    keyframes: state.keyframes,
    cityCenter,
    currentTourTime: state.tourTime * APP_CONFIG.lock.exitPanoramaTimeScale,
    position: camera.position,
    sampleCount: APP_CONFIG.lock.tourSampleCount,
  });
  samplePanoramaPose({
    keyframes: state.keyframes,
    cityCenter,
    t: handoverTargetTourTime,
    positionOut: handoverTargetPos,
    lookTargetOut: handoverTargetLookTarget,
  });

  setControlMode('handover_to_autopilot');
  handoverStartedAtMs = nowMs;
  setStatusLine('RESYNCING AUTOPILOT...', true);
}

function requestManualFromLock() {
  setControlMode('handover_to_manual');
  lockController.interruptToManual({
    durationMs: APP_CONFIG.timing.lockInterruptDurationMs,
    onDone: () => {
      if (state.controlMode !== 'handover_to_manual') return;
      enterManualMode();
    },
  });
}

renderer.domElement.addEventListener('pointerdown', (event) => {
  state.pointerDownPosition = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (!state.pointerDownPosition || !state.sceneReady) return;

  const dx = event.clientX - state.pointerDownPosition.x;
  const dy = event.clientY - state.pointerDownPosition.y;
  state.pointerDownPosition = null;

  if (Math.sqrt(dx * dx + dy * dy) > APP_CONFIG.input.tapThresholdPx) return;

  if (state.controlMode === 'handover_to_manual' || state.controlMode === 'handover_to_autopilot') return;

  if (state.controlMode === 'autopilot') {
    if (state.lockState === 'locking' || state.lockState === 'exiting' || state.lockState === 'interrupting') {
      if (state.lockState === 'interrupting') return;
      requestManualFromLock();
      return;
    }
    enterManualMode();
    return;
  }

  if (state.controlMode === 'manual') {
    startAutopilotHandover();
  }
});

function animate(now) {
  requestAnimationFrame(animate);
  if (now - state.lastFrame < APP_CONFIG.timing.frameMs) return;
  state.lastFrame = now;

  clock.update(now);
  const dt = clock.getDelta();
  sun.intensity = APP_CONFIG.scene.sunPulseBase
    + Math.sin(state.tourTime * APP_CONFIG.scene.sunPulseRate) * APP_CONFIG.scene.sunPulseAmplitude;

  if (state.sceneReady) {
    if (state.lockState === 'locking') {
      if (!smoothInited) {
        smoothCamPos.copy(camera.position);
        captureCurrentLookTarget(smoothLookAt);
        smoothInited = true;
      }

      if (state.lockZoneCenter) {
        const lockElapsedMs = Math.max(0, now - state.lockStartedAtMs);
        const lockProgress = Math.min(1, lockElapsedMs / APP_CONFIG.timing.lockDurationMs);
        const approachBlend = THREE.MathUtils.smoothstep(
          lockProgress,
          0,
          APP_CONFIG.lock.orbitApproachProgress,
        );
        const orbitRadius = THREE.MathUtils.lerp(
          state.lockOrbitRadiusStart,
          state.lockOrbitRadiusEnd,
          approachBlend,
        );
        const orbitAngle = state.lockOrbitStartAngle
          + (lockElapsedMs / 1000) * APP_CONFIG.lock.orbitAngularSpeedRad;

        lockCamTarget.set(
          state.lockZoneCenter.x + Math.sin(orbitAngle) * orbitRadius,
          state.lockZoneCenter.y + state.lockOrbitHeight,
          state.lockZoneCenter.z + Math.cos(orbitAngle) * orbitRadius,
        );
        lockLookTarget.copy(state.lockZoneCenter);
      }

      smoothCamPos.lerp(lockCamTarget, APP_CONFIG.camera.lockLerpSpeed);
      smoothLookAt.lerp(lockLookTarget, APP_CONFIG.camera.lockLerpSpeed);
      camera.position.copy(smoothCamPos);
      camera.lookAt(smoothLookAt);
      lockController.tickLockVisibility(dt);
    } else if (state.lockState === 'exiting') {
      state.tourTime += dt;
      if (!smoothInited) {
        smoothCamPos.copy(camera.position);
        captureCurrentLookTarget(smoothLookAt);
        smoothInited = true;
      }
      samplePanoramaPose({
        keyframes: state.keyframes,
        cityCenter,
        t: state.tourTime * APP_CONFIG.lock.exitPanoramaTimeScale,
        positionOut: autopilotTargetPos,
        lookTargetOut: autopilotLookTarget,
      });
      const awayDirection = exitAwayDirection.subVectors(autopilotTargetPos, cityCenter).normalize();
      autopilotTargetPos.addScaledVector(awayDirection, state.cityMaxDim * APP_CONFIG.lock.exitAwayDistanceRatio);
      smoothCamPos.lerp(autopilotTargetPos, APP_CONFIG.camera.lockLerpSpeed * APP_CONFIG.lock.reentryLerpScale);
      smoothLookAt.lerp(autopilotLookTarget, APP_CONFIG.camera.lockLerpSpeed);
      camera.position.copy(smoothCamPos);
      camera.lookAt(smoothLookAt);
    } else if (state.controlMode === 'handover_to_autopilot') {
      const handoverDurationMs = Math.max(1, APP_CONFIG.timing.autopilotHandoverMs);
      const handoverElapsedMs = Math.max(0, now - handoverStartedAtMs);
      const handoverProgress = Math.min(1, handoverElapsedMs / handoverDurationMs);
      const handoverBlend = THREE.MathUtils.smootherstep(handoverProgress, 0, 1);

      smoothCamPos.lerpVectors(handoverStartPos, handoverTargetPos, handoverBlend);
      handoverCurrentLookTarget.lerpVectors(handoverStartLookTarget, handoverTargetLookTarget, handoverBlend);
      camera.position.copy(smoothCamPos);
      camera.lookAt(handoverCurrentLookTarget);

      if (handoverProgress >= 1) {
        const panoramaScale = Math.max(APP_CONFIG.lock.exitPanoramaTimeScale, Number.EPSILON);
        state.tourTime = handoverTargetTourTime / panoramaScale;
        setControlMode('autopilot');
        smoothInited = false;
        setStatusLine('AUTOPILOT', false);
        lockController.startScanning({ initialDelayMs: APP_CONFIG.timing.scanResumeDelayMs });
      }
    } else if (state.controlMode === 'handover_to_manual') {
      smoothInited = false;
    } else if (state.controlMode === 'manual') {
      controls.update();
      smoothInited = false;
    } else if (state.controlMode === 'autopilot') {
      state.tourTime += dt;
      if (!smoothInited) {
        smoothCamPos.copy(camera.position);
        captureCurrentLookTarget(smoothLookAt);
        smoothInited = true;
      }
      if (state.keyframes.length) {
        samplePanoramaPose({
          keyframes: state.keyframes,
          cityCenter,
          t: state.tourTime * APP_CONFIG.lock.exitPanoramaTimeScale,
          positionOut: autopilotTargetPos,
          lookTargetOut: autopilotLookTarget,
        });
        smoothCamPos.lerp(autopilotTargetPos, APP_CONFIG.camera.lockLerpSpeed);
        smoothLookAt.lerp(autopilotLookTarget, APP_CONFIG.camera.lockLerpSpeed);
        camera.position.copy(smoothCamPos);
        camera.lookAt(smoothLookAt);
      }
    } else {
      smoothInited = false;
    }

    updateLodVisibility({
      camera,
      lodObjects: state.lodObjects,
      lockedCenters: state.lockedCenters,
      isMobile: IS_MOBILE,
      lodNear: state.lodNear,
      lodFar: state.lodFar,
      cameraWorldPosition,
    });
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  viewportResolution.set(innerWidth, innerHeight);
});

runHudSequence(() => {
  hudSequenceComplete = true;
  hudBootComplete = true;
  autoLoad();
});
