const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// A scroll-driven retreat, handoff and approach. No accumulated state, so
// reversing or jumping the scroll always returns to the same camera pose.
export function sceneTravel(progress) {
  return {
    outgoing: smooth(0, 0.72, progress),
    incoming: 1 - smooth(0.28, 1, progress),
    blend: smooth(0.36, 0.64, progress),
  };
}

// Keep live Vector3 references outside Camera.userData: Three serializes that
// object when the stockpile comparison copies a camera.
const targets = new WeakMap();
let offset;
export function aimCamera(camera, x, y, z) {
  let target = targets.get(camera);
  if (!target) { target = camera.position.clone(); targets.set(camera, target); }
  if (x && x.isVector3) target.copy(x); else target.set(x, y, z);
  camera.lookAt(target);
}

export function moveTravelCamera(camera, amount, direction = 1, strength = 1) {
  if (!amount) return;
  const target = targets.get(camera);
  offset ||= camera.position.clone();
  offset.subVectors(camera.position, target);
  const distance = offset.length(), floor = camera.position.y;
  // A small orbit creates real parallax as the camera retreats.
  const angle = direction * amount * 0.16 * strength;
  const x = offset.x, z = offset.z;
  offset.x = x * Math.cos(angle) + z * Math.sin(angle);
  offset.z = z * Math.cos(angle) - x * Math.sin(angle);
  offset.multiplyScalar(1 + amount * 1.55 * strength);
  camera.position.copy(target).add(offset);
  // Upward-looking shots must not retreat below the ground plane.
  camera.position.y = Math.max(floor, camera.position.y) + distance * amount * 0.22 * strength;
  camera.far += distance * amount * 3;
  camera.lookAt(target);
}
