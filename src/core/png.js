// Minimal PNG encoder. Outputs 8-bit indexed-color PNG (color type 3, with PLTE)
// when the image has <=256 unique colors — matching the format Where's My Water
// ships its terrain in — and falls back to 24-bit RGB (color type 2) otherwise.
// Pure function of pixel data; usable in browser and Node (tests).
import { zlibSync } from 'fflate';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  dv.setUint32(8 + data.length, crc);
  return out;
}

function concat(parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/**
 * Encode RGBA pixel data as PNG bytes.
 * @param {Uint8ClampedArray|Uint8Array} rgba - length w*h*4 (alpha ignored)
 * @param {number} w @param {number} h
 * @returns {Uint8Array}
 */
export function encodePNG(rgba, w, h) {
  // Build palette of unique RGB colors.
  const palette = [];
  const index = new Map();
  const px = w * h;
  const indices = new Uint8Array(px);
  let indexed = true;
  for (let i = 0; i < px; i++) {
    const o = i * 4;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    let idx = index.get(key);
    if (idx === undefined) {
      if (palette.length >= 256) { indexed = false; break; }
      idx = palette.length;
      palette.push(key);
      index.set(key, idx);
    }
    indices[i] = idx;
  }

  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth

  let raw;
  const chunks = [sig];
  if (indexed) {
    ihdr[9] = 3; // color type: indexed
    chunks.push(chunk('IHDR', ihdr));
    const plte = new Uint8Array(palette.length * 3);
    palette.forEach((key, i) => {
      plte[i * 3] = (key >> 16) & 0xff;
      plte[i * 3 + 1] = (key >> 8) & 0xff;
      plte[i * 3 + 2] = key & 0xff;
    });
    chunks.push(chunk('PLTE', plte));
    raw = new Uint8Array((w + 1) * h);
    for (let y = 0; y < h; y++) {
      raw[y * (w + 1)] = 0; // filter: none
      raw.set(indices.subarray(y * w, (y + 1) * w), y * (w + 1) + 1);
    }
  } else {
    ihdr[9] = 2; // color type: truecolor RGB
    chunks.push(chunk('IHDR', ihdr));
    raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
      const row = y * (w * 3 + 1);
      raw[row] = 0;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        raw[row + 1 + x * 3] = rgba[o];
        raw[row + 2 + x * 3] = rgba[o + 1];
        raw[row + 3 + x * 3] = rgba[o + 2];
      }
    }
  }
  chunks.push(chunk('IDAT', zlibSync(raw, { level: 9 })));
  chunks.push(chunk('IEND', new Uint8Array(0)));
  return concat(chunks);
}
