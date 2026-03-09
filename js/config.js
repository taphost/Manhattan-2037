export const APP_CONFIG = Object.freeze({
  modelPaths: Object.freeze({
    visual: 'assets/models/scene.glb',
    zone: 'assets/models/scene_zoned.glb',
  }),
  colors: Object.freeze({
    green: 0x4cff7a,
    background: 0x010302,
    risk: Object.freeze({
      LOW: 0xffffff,
      MEDIUM: 0xff8800,
      HIGH: 0xff3333,
    }),
  }),
  timing: Object.freeze({
    frameMs: 1000 / 25,
    scanStartDelayMs: 6000,
    scanResumeDelayMs: 700,
    scanToLockDelayMs: 2000,
    scanRetryJitterMs: 2000,
    lockDurationMs: 18000,
    lockExitDelayMs: 4000,
    lockInterruptDurationMs: 3000,
    autopilotHandoverMs: 1500,
    hudCharDelayMs: 26,
    hudLineGapMs: 60,
  }),
  camera: Object.freeze({
    fovDeg: 40,
    defaultNear: 0.001,
    defaultFar: 500,
    defaultPosition: Object.freeze({
      x: 0,
      y: 6,
      z: 14,
    }),
    lockPull: 0.12,
    lockZoom: 0.72,
    lockLerpSpeed: 0.018,
    nearScale: 0.0002,
    farScale: 25,
    maxDistanceScale: 4,
    initialPosScale: Object.freeze({
      x: 0.55,
      y: 0.38,
      z: 0.70,
    }),
  }),
  renderer: Object.freeze({
    maxPixelRatio: 1.5,
  }),
  scene: Object.freeze({
    ambientIntensity: 0.02,
    directionalIntensity: 0.12,
    directionalPosition: Object.freeze({
      x: 5,
      y: 8,
      z: 4,
    }),
    sunPulseBase: 0.11,
    sunPulseAmplitude: 0.01,
    sunPulseRate: 0.3,
    groundSize: 600,
    groundY: -2,
  }),
  fog: Object.freeze({
    defaultDensity: 0.06,
    scaledDensityDivisor: 1.8,
  }),
  grid: Object.freeze({
    size: 16,
    paddingRatio: 0.01,
    paddingMin: 0.001,
  }),
  controls: Object.freeze({
    dampingFactor: 0.08,
    minDistance: 0.5,
    maxDistance: 80,
    maxPolarAngleMultiplier: 0.48,
    targetYRatio: 0.3,
  }),
  lod: Object.freeze({
    nearDistanceRatio: 0.25,
    farDistanceRatio: 0.50,
    fullEdgeAngleDeg: 20,
    coarseEdgeAngleDeg: 50,
    mobileSilhouetteEdgeAngleDeg: 70,
  }),
  lines: Object.freeze({
    coreWidth: 3,
    coreOpacity: 0.88,
    haloWidth: 5,
    haloOpacity: 0.08,
  }),
  lockLines: Object.freeze({
    coreWidth: 4,
    coreOpacity: 0.95,
    haloWidth: 10,
    haloOpacity: 0.25,
  }),
  lock: Object.freeze({
    clipPaddingRatio: 0.01,
    clipPaddingMin: 0.01,
    blinkRateHz: 2.2,
    orbitAngularSpeedRad: 0.22,
    orbitHeightFactor: 0.92,
    orbitApproachProgress: 0.40,
    minOrbitRadius: 0.35,
    labelMaxLength: 18,
    buildingIdBase: 1000,
    buildingIdRange: 9000,
    tourSampleCount: 120,
    exitPanoramaTimeScale: 0.45,
    exitAwayDistanceRatio: 0.08,
    reentryLerpScale: 0.55,
  }),
  renderOrder: Object.freeze({
    cityMesh: 1,
    cityLineCore: 2,
    cityLineHalo: 3,
    lockGroup: 10,
    lockLineCore: 10,
    lockLineHalo: 11,
  }),
  hud: Object.freeze({
    valueTypeJitterMs: 18,
    statusValueElementId: 'val4',
  }),
  input: Object.freeze({
    tapThresholdPx: 8,
  }),
});

export const PANORAMA_KEYFRAME_TEMPLATES = Object.freeze([
  [20, 1.4, 0.55, 0.10, 9],
  [80, 0.7, 0.18, 0.05, 10],
  [150, 1.1, 0.70, 0.15, 9],
  [210, 0.5, 0.12, -0.02, 10],
  [280, 0.9, 0.40, 0.08, 9],
  [340, 1.6, 0.80, 0.20, 8],
  [380, 0.6, 0.22, 0.04, 10],
]);

export const HUD_LINES = Object.freeze([
  Object.freeze({ lbl: 'SYSTEM  ', val: 'NV-RECON  v4.1.0' }),
  Object.freeze({ lbl: 'LOCATION', val: '40.7831 N   73.9712 W' }),
  Object.freeze({ lbl: 'CITY    ', val: 'NEW YORK' }),
  Object.freeze({ lbl: 'YEAR    ', val: '2037' }),
  Object.freeze({ lbl: 'STATUS  ', val: 'LOADING...' }),
]);

export const SECTORS = Object.freeze([
  'ALPHA',
  'BRAVO',
  'DELTA',
  'ECHO',
  'FOXTROT',
  'GAMMA',
  'KILO',
  'SIGMA',
]);

export const THREATS = Object.freeze([
  'UNAUTHORIZED ACCESS',
  'STRUCTURAL ANOMALY',
  'SIGNAL EMISSION',
  'HEAT SIGNATURE',
  'MOVEMENT DETECTED',
  'FREQUENCY ANOMALY',
]);

export const RISK_LEVELS = Object.freeze([
  Object.freeze({ label: 'LOW', cls: 'risk-low' }),
  Object.freeze({ label: 'MEDIUM', cls: 'risk-medium' }),
  Object.freeze({ label: 'HIGH', cls: 'risk-high' }),
]);
