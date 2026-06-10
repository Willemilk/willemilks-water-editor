// Resolves the full rendering chain for game objects:
//   level XML  ->  /Objects/*.hs  ->  /Sprites/*.sprite  ->  /Textures/*.imagelist  ->  atlas .webp/.png
// Everything is cached. Browsers decode the webp atlases natively.
import { GRID_TO_PX } from './coords.js';

export class ObjectResolver {
  constructor(vfs) {
    this.vfs = vfs;
    this.hsCache = new Map();        // path -> hs definition
    this.spriteCache = new Map();    // path -> sprite definition
    this.imagelistCache = new Map(); // path -> { file, images: Map(name -> rect) }
    this.atlasCache = new Map();     // texture path -> Promise<ImageBitmap|null>
  }

  _parse(path) {
    const text = this.vfs.readText(path);
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML parse error in ' + path);
    return doc;
  }

  /** Load an object definition (.hs). gamePath like "/Objects/star.hs". */
  getHS(gamePath) {
    const key = gamePath.toLowerCase();
    if (this.hsCache.has(key)) return this.hsCache.get(key);
    let def = null;
    try {
      const doc = this._parse(this.vfs.game(gamePath));
      const root = doc.documentElement;
      const sprites = Array.from(root.querySelectorAll(':scope > Sprites > Sprite')).map((s) => {
        const pos = (s.getAttribute('pos') || '0 0').trim().split(/\s+/).map(Number);
        const gs = (s.getAttribute('gridSize') || '1 -1').trim().split(/\s+/).map(Number);
        return {
          filename: s.getAttribute('filename') || '',
          pos: [pos[0] || 0, pos[1] || 0],
          angle: parseFloat(s.getAttribute('angle') || '0') || 0,
          gridSize: [gs[0] || 1, gs[1] || -1],
          isBackground: (s.getAttribute('isBackground') || '') === 'true',
        };
      });
      const shapes = Array.from(root.querySelectorAll(':scope > Shapes > Shape')).map((sh) =>
        Array.from(sh.querySelectorAll(':scope > Point')).map((p) => {
          const v = (p.getAttribute('pos') || '0 0').trim().split(/\s+/).map(Number);
          return [v[0] || 0, v[1] || 0];
        })
      );
      const defaults = {};
      for (const p of Array.from(root.querySelectorAll(':scope > DefaultProperties > Property'))) {
        defaults[p.getAttribute('name')] = p.getAttribute('value') ?? '';
      }
      def = { path: gamePath, sprites, shapes, defaults };
    } catch {
      def = { path: gamePath, sprites: [], shapes: [], defaults: {}, missing: true };
    }
    this.hsCache.set(key, def);
    return def;
  }

  getSprite(gamePath) {
    const key = gamePath.toLowerCase();
    if (this.spriteCache.has(key)) return this.spriteCache.get(key);
    let def = null;
    try {
      const doc = this._parse(this.vfs.game(gamePath));
      const anims = Array.from(doc.querySelectorAll('Sprite > Animation')).map((a) => ({
        name: a.getAttribute('name') || '',
        atlas: a.getAttribute('atlas') || '',
        frames: Array.from(a.querySelectorAll(':scope > Frame')).map((f) => f.getAttribute('name') || ''),
      }));
      def = { path: gamePath, animations: anims };
    } catch {
      def = { path: gamePath, animations: [], missing: true };
    }
    this.spriteCache.set(key, def);
    return def;
  }

  getImagelist(gamePath) {
    const key = gamePath.toLowerCase();
    if (this.imagelistCache.has(key)) return this.imagelistCache.get(key);
    let def = null;
    try {
      const doc = this._parse(this.vfs.game(gamePath));
      const root = doc.documentElement;
      const images = new Map();
      for (const im of Array.from(root.querySelectorAll(':scope > Image'))) {
        const rect = (im.getAttribute('rect') || '0 0 0 0').trim().split(/\s+/).map(Number);
        images.set((im.getAttribute('name') || '').toLowerCase(), {
          x: rect[0], y: rect[1], w: rect[2], h: rect[3],
        });
      }
      def = { file: root.getAttribute('file') || '', images };
    } catch {
      def = { file: '', images: new Map(), missing: true };
    }
    this.imagelistCache.set(key, def);
    return def;
  }

  /** ImageBitmap for an atlas texture path like "/Textures/duckies.webp". */
  getAtlas(texturePath) {
    const key = texturePath.toLowerCase();
    if (this.atlasCache.has(key)) return this.atlasCache.get(key);
    const p = (async () => {
      try {
        let path = this.vfs.game(texturePath);
        if (!this.vfs.has(path)) {
          // imagelists sometimes reference .png while the shipped file is .webp (or vice versa)
          const alt = path.replace(/\.(png|webp)$/i, (m) => (m.toLowerCase() === '.png' ? '.webp' : '.png'));
          if (this.vfs.has(alt)) path = alt;
          else return null;
        }
        const bytes = this.vfs.read(path);
        const lower = path.toLowerCase();
        const type = lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
        return await createImageBitmap(new Blob([bytes], { type }));
      } catch {
        return null;
      }
    })();
    this.atlasCache.set(key, p);
    return p;
  }

  /**
   * Resolve everything needed to draw one object: per-sprite frames with atlas
   * bitmaps and source rects, plus a local-space bounding box in terrain px.
   * Returns { sprites: [{bitmap, rect, pos, angle, w, h, flipY, isBackground}], bboxPx }
   */
  async resolveVisual(hsGamePath) {
    const hs = this.getHS(hsGamePath);
    const out = [];
    for (const s of hs.sprites) {
      const sprite = this.getSprite(s.filename);
      const anim = sprite.animations[0];
      let bitmap = null;
      let rect = null;
      if (anim && anim.frames.length && anim.atlas) {
        const il = this.getImagelist(anim.atlas);
        const frame = il.images.get(anim.frames[0].toLowerCase());
        if (frame && il.file) {
          bitmap = await this.getAtlas(il.file);
          rect = frame;
        }
      }
      const wPx = Math.abs(s.gridSize[0]) * GRID_TO_PX;
      const hPx = Math.abs(s.gridSize[1]) * GRID_TO_PX;
      out.push({
        bitmap, rect,
        pos: s.pos,
        angle: s.angle,
        wPx, hPx,
        flipX: s.gridSize[0] < 0,
        flipY: s.gridSize[1] > 0, // negative height = normal orientation in this engine
        isBackground: s.isBackground,
      });
    }
    // local bbox (terrain px, object space, y-down) from sprites or shapes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const grow = (x, y) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    };
    for (const s of out) {
      const cx = s.pos[0] * GRID_TO_PX;
      const cy = -s.pos[1] * GRID_TO_PX;
      const r = Math.hypot(s.wPx, s.hPx) / 2; // rotation-safe radius
      grow(cx - r, cy - r); grow(cx + r, cy + r);
    }
    if (!out.length) {
      for (const shape of hs.shapes) {
        for (const [px, py] of shape) grow(px * GRID_TO_PX, -py * GRID_TO_PX);
      }
    }
    if (minX === Infinity) { minX = -6; minY = -6; maxX = 6; maxY = 6; }
    out.sort((a, b) => (a.isBackground === b.isBackground ? 0 : a.isBackground ? -1 : 1));
    return { sprites: out, bboxPx: { minX, minY, maxX, maxY }, shapes: hs.shapes, defaults: hs.defaults, missing: hs.missing };
  }

  /** List every placeable object in the game, grouped by inferred category. */
  listObjects() {
    const files = this.vfs.list('assets/objects/', '.hs');
    return files.map((p) => {
      const name = p.slice(p.lastIndexOf('/') + 1, -3);
      return { name, gamePath: '/Objects/' + name + '.hs' };
    });
  }
}

/** Crude category inference from object names for the browser sidebar. */
export function categorize(name) {
  const n = name.toLowerCase();
  if (/star|duck|note|collect/.test(n)) return 'Collectibles';
  if (/spout|drain|pipe|faucet|valve|shower|broken/.test(n)) return 'Spouts & pipes';
  if (/switch|lever|button|door|gate|hatch/.test(n)) return 'Switches & doors';
  if (/bomb|laser|mine|spike|hazard/.test(n)) return 'Hazards';
  if (/fan|vacuum|wind/.test(n)) return 'Fans';
  if (/platform|rock|board|wood|block|wall|wheel|gear|bone|raft/.test(n)) return 'Platforms & props';
  if (/balloon|bubble/.test(n)) return 'Balloons';
  if (/converter|teleport|portal/.test(n)) return 'Converters & portals';
  if (/swampy|allie|cranky|croc|mystery/.test(n)) return 'Characters';
  if (/bg_|background|decor|deco/.test(n)) return 'Decoration';
  return 'Other';
}
