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

/** Rotate a 2D point around origin, CCW-positive (math/world convention). */
export function rotatePoint(x, y, deg) {
  if (!deg) return [x, y];
  const r = degToRad(deg);
  const c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}
