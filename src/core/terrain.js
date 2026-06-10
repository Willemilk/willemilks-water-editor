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
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close?.();
    return new Terrain(bmp.width, bmp.height, img.data);
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

  /** Scanline flood fill of the contiguous color region under (x, y). */
  fill(x, y, rgb) {
    const start = this.getPixel(x, y);
    if (!start) return;
    if (start[0] === rgb[0] && start[1] === rgb[1] && start[2] === rgb[2]) return;
    const { width, height, data } = this;
    const match = (px, py) => {
      const o = (py * width + px) * 4;
      return data[o] === start[0] && data[o + 1] === start[1] && data[o + 2] === start[2];
    };
    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      let lx = cx;
      while (lx >= 0 && match(lx, cy)) lx--;
      lx++;
      let spanUp = false, spanDown = false;
      let i = lx;
      while (i < width && match(i, cy)) {
        this.setPixel(i, cy, rgb);
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
