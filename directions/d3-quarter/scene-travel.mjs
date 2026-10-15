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
