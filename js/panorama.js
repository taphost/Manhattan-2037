import * as THREE from 'three';

export function buildPanoramaKeyframes(templates, cityMaxDim) {
  return templates.map(([deg, distanceMultiplier, heightMultiplier, lookYMultiplier, durationSeconds]) => ({
    angle: deg * Math.PI / 180,
    dist: distanceMultiplier * cityMaxDim,
    height: heightMultiplier * cityMaxDim,
    lookY: lookYMultiplier * cityMaxDim,
    dur: durationSeconds,
  }));
}

export function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function resolveInterpolatedFrame(keyframes, t) {
  const totalDuration = keyframes.reduce((sum, keyframe) => sum + keyframe.dur, 0);
  const wrappedTime = ((t % totalDuration) + totalDuration) % totalDuration;

  let elapsed = 0;
  let segmentIndex = 0;
  for (let i = 0; i < keyframes.length; i++) {
    if (wrappedTime < elapsed + keyframes[i].dur) {
      segmentIndex = i;
      break;
    }
    elapsed += keyframes[i].dur;
  }

  const current = keyframes[segmentIndex];
  const next = keyframes[(segmentIndex + 1) % keyframes.length];
  const interpolation = smootherstep((wrappedTime - elapsed) / current.dur);

  return { current, next, interpolation };
}

function interpolateFrameValue(current, next, key, interpolation) {
  return current[key] + (next[key] - current[key]) * interpolation;
}

export function samplePanoramaPose({
  keyframes,
  cityCenter,
  t,
  positionOut,
  lookTargetOut,
}) {
  if (!keyframes.length) return;

  const { current, next, interpolation } = resolveInterpolatedFrame(keyframes, t);
  const angle = interpolateFrameValue(current, next, 'angle', interpolation);
  const dist = interpolateFrameValue(current, next, 'dist', interpolation);
  const height = interpolateFrameValue(current, next, 'height', interpolation);
  const lookY = interpolateFrameValue(current, next, 'lookY', interpolation);

  positionOut.set(
    cityCenter.x + Math.sin(angle) * dist,
    cityCenter.y + height,
    cityCenter.z + Math.cos(angle) * dist,
  );

  if (lookTargetOut) {
    lookTargetOut.set(cityCenter.x, cityCenter.y + lookY, cityCenter.z);
  }
}

export function samplePanoramaPosition({ keyframes, cityCenter, t, out }) {
  if (!keyframes.length) return out;
  samplePanoramaPose({
    keyframes,
    cityCenter,
    t,
    positionOut: out,
  });
  return out;
}

export function applyPanoramaToCamera({ camera, keyframes, cityCenter, t }) {
  if (!keyframes.length) return;
  const position = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  samplePanoramaPose({
    keyframes,
    cityCenter,
    t,
    positionOut: position,
    lookTargetOut: lookTarget,
  });
  camera.position.copy(position);
  camera.lookAt(lookTarget);
}

export function findNearestPanoramaTime({
  keyframes,
  cityCenter,
  currentTourTime,
  position,
  sampleCount,
}) {
  if (!keyframes.length) return currentTourTime;

  const totalDuration = keyframes.reduce((sum, keyframe) => sum + keyframe.dur, 0);
  let nearestTime = currentTourTime;
  let nearestDistance = Infinity;
  const probe = new THREE.Vector3();

  for (let i = 0; i <= sampleCount; i++) {
    const t = (i / sampleCount) * totalDuration;
    samplePanoramaPosition({ keyframes, cityCenter, t: t % totalDuration, out: probe });
    const distance = probe.distanceTo(position);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestTime = t;
    }
  }

  return nearestTime;
}
