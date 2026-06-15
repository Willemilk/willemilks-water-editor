// Coordinate system — verified against wmw-modding/wheres-my-editor (main.py)
// and wmwpy. One grid unit = 1.25 terrain pixels (OBJECT_MULTIPLIER).
// World origin sits at the CENTER of the terrain image; +Y is up.

export const GRID_TO_PX = 1.25; // terrain pixels per grid unit

/** World (grid units) -> terrain image pixel coordinates (float). */
export function worldToImg(x, y, imgW, imgH) {
  return [imgW / 2 + x * GRID_TO_PX, imgH / 2 - y * GRID_TO_PX];
}

/** Terrain image pixel -> world (grid units). */
export function imgToWorld(ix, iy, imgW, imgH) {
  return [(ix - imgW / 2) / GRID_TO_PX, (imgH / 2 - iy) / GRID_TO_PX];
}

export function degToRad(d) { return (d * Math.PI) / 180; }

// Stable color for a switch/generator "group", keyed by the controller's name.
// Shared by the inspector (group chips) and the canvas (connection arrows) so a
// group looks the same everywhere. Deterministic: same name -> same color.
export const GROUP_PALETTE = [
  '#ffb454', '#3ddc84', '#2ea7ff', '#a78bfa', '#f472b6',
  '#f59e0b', '#22d3ee', '#a3e635', '#fb7185', '#60a5fa',
];
export function groupColor(name) {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GROUP_PALETTE[h % GROUP_PALETTE.length];
}

/** Rotate a 2D point around origin, CCW-positive (math/world convention). */
export function rotatePoint(x, y, deg) {
  if (!deg) return [x, y];
  const r = degToRad(deg);
  const c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}
