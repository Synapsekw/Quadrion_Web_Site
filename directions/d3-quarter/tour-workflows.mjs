// Shared by the scroll director, renderer, and accessible workflow controls.
export const WORKFLOWS = Object.freeze({
  plant: { stages: [
    { id: 'rgb', label: 'RGB point cloud', description: 'Explore the captured colour survey of the terminal.' },
    { id: 'elevation', label: 'Elevation', description: 'Colour the same measured points by height.' },
    { id: 'model', label: 'GLB model', description: 'Switch to the terminal engineering model.' },
  ] },
  tank: { stages: [
    { id: 'points', label: 'LiDAR scan', description: 'Read the tank interior as measured points.' },
    { id: 'model', label: 'GLB model', description: 'Reveal the real tank geometry.' },
    { id: 'issues', label: 'Mapped findings', description: 'Locate the six recorded inspection findings.' },
    { id: 'interior', label: 'Interior flight', description: 'Follow a recorded interior flight, linked to its camera path.' },
  ] },
  flare: { stages: [
    { id: 'points', label: 'Point view', description: 'Read a surface sample of the flare stack.' },
    { id: 'model', label: 'GLB model', description: 'Reveal the reconstructed textured surface.' },
    { id: 'base', label: 'Base · 3.4 m', description: 'Inspect the mapped F70 corrosion mask at the base.' },
    { id: 'mid', label: 'Mid · 55.3 m', description: 'Rise to the F44 corrosion mask on the mid stack.' },
    { id: 'top', label: 'Top · 76.7 m', description: 'Inspect the F04 corrosion mask at the top.' },
  ] },
  facade: { stages: [
    { id: 'model', label: 'Tower model', description: 'Explore the reconstructed tower facade.' },
    { id: 'heatmap', label: 'Issue heatmap', description: 'Reveal recorded defect surfaces by class and severity.' },
    { id: 'rgb', label: 'RGB evidence', description: 'Review source photography against the mapped issue.' },
    { id: 'thermal', label: 'Thermal evidence', description: 'Review recorded thermal findings and imagery.' },
  ] },
  stock: { stages: [
    { id: 'terrain', label: 'Survey terrain', description: 'Explore the latest textured survey, captured on 10 January 2021.' },
    { id: 'dsm', label: 'Elevation DSM', description: 'Colour the same measured survey surface by elevation.' },
    { id: 'pile', label: 'Select a pile', description: 'Fit the selected pile and highlight its measured boundary.' },
    { id: 'compare', label: 'Compare volumes', description: 'Compare the selected pile across both survey dates.' },
  ] },
});

export function workflowState(name, progress, manualIndex = null) {
  const stages = WORKFLOWS[name]?.stages;
  if (!stages) throw new RangeError(`Unknown workflow: ${name}`);
  const manual = Number.isInteger(manualIndex) && manualIndex >= 0 && manualIndex < stages.length;
  const p = manual ? (manualIndex + 0.65) / stages.length : Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const index = manual ? manualIndex : Math.min(stages.length - 1, Math.floor(p * stages.length));
  return { ...stages[index], index, local: manual ? 0.65 : Math.min(1, p * stages.length - index), progress: p, manual };
}

// A media element remains authoritative while paused or seeking. Scroll only
// provides a fallback when no usable video time is available.
export function flightTime(progress, duration, mediaTime = null) {
  const time = Number.isFinite(mediaTime) ? mediaTime : progress * duration;
  return Math.max(0, Math.min(duration, time));
}
