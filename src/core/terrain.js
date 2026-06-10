// Terrain layer: an RGBA pixel buffer at native level resolution (e.g. 90x120).
// All paint operations work directly on the buffer; the editor renders it
// scaled with nearest-neighbor so each terrain pixel stays a crisp cell.
import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT, getMaterial } from '../data/materials.js';

export class Terrain {
  constructor(width, height, rgba) {
    this.width = width;
    this.height = height;
    /** @type {Uint8ClampedArray} */
    this.data = rgba || Terrain.blankData(width, height);
  }

  static blankData(w, h) {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      d[i * 4] = 255; d[i * 4 + 1] = 255; d[i * 4 + 2] = 255; d[i * 4 + 3] = 255;
    }
    return d;
  }

  static blank(w = DEFAULT_LEVEL_WIDTH, h = DEFAULT_LEVEL_HEIGHT) {
    return new Terrain(w, h);
  }

  /** Decode level PNG bytes into a Terrain (browser only). */
  static async fromPNGBytes(bytes) {
    const blob = new Blob([bytes], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    bmp.close?.();
    return new Terrain(w, h, img.data);
  }

  clone() {
    return new Terrain(this.width, this.height, new Uint8ClampedArray(this.data));
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getPixel(x, y) {
    if (!this.inBounds(x, y)) return null;
    const o = (y * this.width + x) * 4;
    return [this.data[o], this.data[o + 1], this.data[o + 2]];
  }

  setPixel(x, y, rgb) {
    if (!this.inBounds(x, y)) return;
    const o = (y * this.width + x) * 4;
    this.data[o] = rgb[0];
    this.data[o + 1] = rgb[1];
    this.data[o + 2] = rgb[2];
    this.data[o + 3] = 255;
  }

  /** Square brush stamp of side `size` centered on (x, y). */
  stamp(x, y, rgb, size = 1) {
    const half = Math.floor(size / 2);
    const x0 = x - half;
    const y0 = y - half;
    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) this.setPixel(x0 + dx, y0 + dy, rgb);
    }
  }

  /** Bresenham line of stamps. */
  line(x0, y0, x1, y1, rgb, size = 1) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.stamp(x0, y0, rgb, size);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  rect(x0, y0, x1, y1, rgb, filled = true) {
    const xa = Math.max(0, Math.min(x0, x1));
    const xb = Math.min(this.width - 1, Math.max(x0, x1));
    const ya = Math.max(0, Math.min(y0, y1));
    const yb = Math.min(this.height - 1, Math.max(y0, y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (filled || x === xa || x === xb || y === ya || y === yb) this.setPixel(x, y, rgb);
      }
    }
  }

  /** Scanline flood fill of the contiguous color region under (x, y).
   *  Optional matchSet: array of RGB triples that all count as the same region
   *  (used to fill across the rock family in one go). */
  fill(x, y, rgb, matchSet = null) {
    const start = this.getPixel(x, y);
    if (!start) return;
    const keys = matchSet
      ? new Set(matchSet.map((c) => c[0] * 65536 + c[1] * 256 + c[2]))
      : null;
    const startKey = start[0] * 65536 + start[1] * 256 + start[2];
    if (keys && !keys.has(startKey)) keys.add(startKey);
    if (!keys && start[0] === rgb[0] && start[1] === rgb[1] && start[2] === rgb[2]) return;
    const { width, height, data } = this;
    const filled = new Uint8Array(width * height);
    const match = (px, py) => {
      if (filled[py * width + px]) return false;
      const o = (py * width + px) * 4;
      const k = data[o] * 65536 + data[o + 1] * 256 + data[o + 2];
      return keys ? keys.has(k) : k === startKey;
    };
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (!match(cx, cy)) continue;
      let lx = cx;
      while (lx >= 0 && match(lx, cy)) lx--;
      lx++;
      let spanUp = false, spanDown = false;
      let i = lx;
      while (i < width && match(i, cy)) {
        this.setPixel(i, cy, rgb);
        filled[cy * width + i] = 1;
        if (cy > 0) {
          const m = match(i, cy - 1);
          if (m && !spanUp) { stack.push([i, cy - 1]); spanUp = true; }
          else if (!m) spanUp = false;
        }
        if (cy < height - 1) {
          const m = match(i, cy + 1);
          if (m && !spanDown) { stack.push([i, cy + 1]); spanDown = true; }
          else if (!m) spanDown = false;
        }
        i++;
      }
    }
  }

  /** Replace every pixel of one exact color with another (global swap). */
  replaceColor(fromRgb, toRgb) {
    const { data } = this;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === fromRgb[0] && data[i + 1] === fromRgb[1] && data[i + 2] === fromRgb[2]) {
        data[i] = toRgb[0]; data[i + 1] = toRgb[1]; data[i + 2] = toRgb[2];
        n++;
      }
    }
    return n;
  }

  /** Smart rock pass: re-derives the highlight rim inside a rect so freshly
   *  painted rock merges seamlessly with rock that was already there.
   *  Rule (measured on the original levels): the top 2 pixels of any exposed
   *  rock surface are Rock Highlight; rim pixels that get buried turn back
   *  into Rock. Hand-placed Rock Shadow (deep rock) is left untouched.
   *  Off-map counts as solid so border rock keeps no rim, like the originals. */
  smartRockPass(x0, y0, x1, y1, rockRgb, highlightRgb, familyRgbs) {
    const xa = Math.max(0, Math.min(x0, x1) - 2);
    const xb = Math.min(this.width - 1, Math.max(x0, x1) + 2);
    const ya = Math.max(0, Math.min(y0, y1) - 2);
    const yb = Math.min(this.height - 1, Math.max(y0, y1) + 2);
    const famKeys = new Set(familyRgbs.map((c) => c[0] * 65536 + c[1] * 256 + c[2]));
    const isFam = (x, y) => {
      const p = this.getPixel(x, y);
      return !!p && famKeys.has(p[0] * 65536 + p[1] * 256 + p[2]);
    };
    const hiKey = highlightRgb[0] * 65536 + highlightRgb[1] * 256 + highlightRgb[2];
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        if (!isFam(x, y)) continue;
        // depth = how many family pixels sit on top of this one (inclusive);
        // off-map counts as solid so border rock stays body, like the originals
        let depth = 1;
        while (depth <= 2 && (y - depth < 0 || isFam(x, y - depth))) depth++;
        const p = this.getPixel(x, y);
        const key = p[0] * 65536 + p[1] * 256 + p[2];
        if (depth <= 2) {
          this.setPixel(x, y, highlightRgb); // exposed rim
        } else if (key === hiKey) {
          this.setPixel(x, y, rockRgb); // buried rim turns into body
        }
      }
    }
  }

  /** Replace one exact color with another, but only inside a rect (smart dirt). */
  normalizeColorInRect(x0, y0, x1, y1, fromRgb, toRgb) {
    const xa = Math.max(0, Math.min(x0, x1));
    const xb = Math.min(this.width - 1, Math.max(x0, x1));
    const ya = Math.max(0, Math.min(y0, y1));
    const yb = Math.min(this.height - 1, Math.max(y0, y1));
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const o = (y * this.width + x) * 4;
        if (this.data[o] === fromRgb[0] && this.data[o + 1] === fromRgb[1] && this.data[o + 2] === fromRgb[2]) {
          this.data[o] = toRgb[0]; this.data[o + 1] = toRgb[1]; this.data[o + 2] = toRgb[2];
        }
      }
    }
  }

  clearAll(materialId = 'empty') {
    const rgb = getMaterial(materialId).rgb;
    this.rect(0, 0, this.width - 1, this.height - 1, rgb, true);
  }

  /** Count pixels per exact color, for the level stats panel. */
  histogram() {
    const counts = new Map();
    const { data } = this;
    for (let i = 0; i < data.length; i += 4) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }
}
