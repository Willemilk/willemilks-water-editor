// The editor viewport: renders terrain (nearest-neighbor scaled) + objects from
// game atlases, and handles every interaction — select/move objects, paint
// terrain, edit motor paths, zoom and pan.
import { GRID_TO_PX, worldToImg, imgToWorld, degToRad, groupColor } from '../core/coords.js';
import { getMaterial, rockFamilyRgbs } from '../data/materials.js';

const SNAP_DIST = 0.5; // world units — neighbor edge/center snapping while dragging objects

export const TOOLS = {
  SELECT: 'select',
  PENCIL: 'pencil',
  ERASER: 'eraser',
  LINE: 'line',
  RECT: 'rect',
  FILL: 'fill',
  PICKER: 'picker',
};

export class Editor {
  constructor(canvas, resolver, events) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resolver = resolver;
    this.events = events; // { onSelect(obj|null), onChange(), onHover(info), onPick(materialId|color) }

    this.level = null;
    this.tool = TOOLS.SELECT;
    this.material = 'dirt';
    this.smartTerrain = true; // smart merge for rock + dirt; toggle in Settings
    this.brushSize = 1;
    this.zoom = 6;
    this.panX = 0;
    this.panY = 0;
    this.showGrid = false;
    this.showCollision = false;
    this.showPaths = true;
    this.showConnections = true;
    this.pickObjectMode = null; // callback(obj) set while picking a connection target

    this.selected = null;
    this.hoverPathHandle = null; // {obj, index}
    this.dragging = null; // {kind:'object'|'pan'|'paint'|'shape'|'path'|'room', ...}
    this.shapePreview = null; // for line/rect previews
    this.visualCache = new Map(); // hs path -> resolved visual
    this.terrainCanvas = document.createElement('canvas');
    this._raf = 0;

    this._bind();
    this._resize();
    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(canvas.parentElement);
  }

  /** Detach window-level listeners. Call before replacing the editor instance. */
  dispose() {
    window.removeEventListener('pointerup', this._onWinUp);
    window.removeEventListener('keydown', this._onWinKey);
    this._resizeObs?.disconnect();
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  setLevel(level) {
    this.level = level;
    this.selected = null;
    this.events.onSelect?.(null);
    this._syncTerrainCanvas();
    this.fitView();
    this.preloadVisuals();
  }

  _syncTerrainCanvas() {
    if (!this.level) return;
    const t = this.level.terrain;
    this.terrainCanvas.width = t.width;
    this.terrainCanvas.height = t.height;
    const ctx = this.terrainCanvas.getContext('2d');
    ctx.putImageData(new ImageData(t.data, t.width, t.height), 0, 0);
  }

  refreshTerrain() {
    this._syncTerrainCanvas();
    this.requestRender();
  }

  async preloadVisuals() {
    if (!this.level) return;
    const paths = new Set(this.level.objects.map((o) => o.filename).filter(Boolean));
    await Promise.all(
      [...paths].map(async (p) => {
        if (!this.visualCache.has(p.toLowerCase())) {
          this.visualCache.set(p.toLowerCase(), await this.resolver.resolveVisual(p));
        }
      })
    );
    this.requestRender();
  }

  async getVisual(hsPath) {
    const key = hsPath.toLowerCase();
    if (!this.visualCache.has(key)) {
      this.visualCache.set(key, await this.resolver.resolveVisual(hsPath));
      this.requestRender();
    }
    return this.visualCache.get(key);
  }

  fitView() {
    if (!this.level) return;
    const t = this.level.terrain;
    const pad = 40;
    const zx = (this.canvas.clientWidth - pad * 2) / t.width;
    const zy = (this.canvas.clientHeight - pad * 2) / t.height;
    this.zoom = Math.max(1, Math.min(zx, zy));
    this.panX = (this.canvas.clientWidth - t.width * this.zoom) / 2;
    this.panY = (this.canvas.clientHeight - t.height * this.zoom) / 2;
    this.events.onViewChanged?.(this.zoom);
    this.requestRender();
  }

  // ---------- coordinate helpers ----------

  /** screen (canvas css px) -> terrain image float coords */
  screenToImg(sx, sy) {
    return [(sx - this.panX) / this.zoom, (sy - this.panY) / this.zoom];
  }

  imgToScreen(ix, iy) {
    return [ix * this.zoom + this.panX, iy * this.zoom + this.panY];
  }

  screenToWorld(sx, sy) {
    const [ix, iy] = this.screenToImg(sx, sy);
    return imgToWorld(ix, iy, this.level.terrain.width, this.level.terrain.height);
  }

  worldToScreen(wx, wy) {
    const [ix, iy] = worldToImg(wx, wy, this.level.terrain.width, this.level.terrain.height);
    return this.imgToScreen(ix, iy);
  }

  // ---------- input ----------

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    this._onWinUp = (e) => this._onUp(e);
    this._onWinKey = (e) => this._onKey(e);
    window.addEventListener('pointerup', this._onWinUp);
    window.addEventListener('keydown', this._onWinKey);
  }

  _onWheel(e) {
    e.preventDefault();
    if (!this.level) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [ix, iy] = this.screenToImg(sx, sy);
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.zoom = Math.min(40, Math.max(0.5, this.zoom * factor));
    // keep the pixel under the cursor anchored while zooming
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
    this.events.onViewChanged?.(this.zoom);
    this.requestRender();
  }

  /** Zoom around the canvas center (used by the View menu and shortcuts). */
  zoomBy(factor) {
    if (!this.level) return;
    const sx = this.canvas.clientWidth / 2;
    const sy = this.canvas.clientHeight / 2;
    const [ix, iy] = this.screenToImg(sx, sy);
    this.zoom = Math.min(40, Math.max(0.5, this.zoom * factor));
    this.panX = sx - ix * this.zoom;
    this.panY = sy - iy * this.zoom;
    this.events.onViewChanged?.(this.zoom);
    this.requestRender();
  }

  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  async _onDown(e) {
    if (!this.level) return;
    this.canvas.setPointerCapture(e.pointerId);
    const [sx, sy] = this._pos(e);

    // middle mouse / space-drag / right mouse = pan
    if (e.button === 1 || e.button === 2 || this._space) {
      this.dragging = { kind: 'pan', sx, sy, panX: this.panX, panY: this.panY };
      return;
    }

    // connection picking mode: the next clicked object becomes the target
    if (this.pickObjectMode && e.button === 0) {
      const hit = await this._hitObject(sx, sy);
      if (hit) this.pickObjectMode(hit);
      return;
    }

    if (this.tool === TOOLS.SELECT) {
      // path handle of the selected object first
      const handle = this._hitPathHandle(sx, sy);
      if (handle) {
        this.level.pushUndo();
        this.dragging = { kind: 'path', ...handle };
        return;
      }
      // room marker
      if (this.level.room) {
        const [rx, ry] = this.worldToScreen(this.level.room.x, this.level.room.y);
        if (Math.hypot(sx - rx, sy - ry) < 12) {
          this.level.pushUndo();
          this.dragging = { kind: 'room' };
          return;
        }
      }
      const obj = await this._hitObject(sx, sy);
      this.selected = obj;
      this.events.onSelect?.(obj);
      if (obj) {
        const [wx, wy] = this.screenToWorld(sx, sy);
        this.level.pushUndo();
        this.dragging = { kind: 'object', obj, dx: obj.x - wx, dy: obj.y - wy, moved: false };
      }
      this.requestRender();
      return;
    }

    // paint tools
    const [ix, iy] = this.screenToImg(sx, sy).map(Math.floor);
    const t = this.level.terrain;
    if (this.tool === TOOLS.PICKER) {
      const px = t.getPixel(ix, iy);
      if (px) this.events.onPick?.(px);
      return;
    }
    if (e.altKey && this.tool !== TOOLS.SELECT) {
      const px = t.getPixel(ix, iy);
      if (px) this.events.onPick?.([px[0], px[1], px[2]]);
      return;
    }
    if (this.tool === TOOLS.FILL) {
      this.level.pushUndo();
      const startPx = t.getPixel(ix, iy);
      const fam = this._smartFamily();
      const startIsFam = fam && startPx && fam.some((c) => c[0] === startPx[0] && c[1] === startPx[1] && c[2] === startPx[2]);
      t.fill(ix, iy, this._rgb(), startIsFam ? fam : null);
      this._smartPass(0, 0, t.width - 1, t.height - 1);
      this.refreshTerrain();
      this.events.onChange?.();
      return;
    }
    if (this.tool === TOOLS.PENCIL || this.tool === TOOLS.ERASER) {
      this.level.pushUndo();
      t.stamp(ix, iy, this._rgb(), this.brushSize);
      this._smartPass(ix - this.brushSize, iy - this.brushSize, ix + this.brushSize, iy + this.brushSize);
      this.dragging = { kind: 'paint', lx: ix, ly: iy };
      this.refreshTerrain();
      return;
    }
    if (this.tool === TOOLS.LINE || this.tool === TOOLS.RECT) {
      this.dragging = { kind: 'shape', x0: ix, y0: iy, x1: ix, y1: iy };
      this.shapePreview = this.dragging;
      this.requestRender();
      return;
    }
  }

  _onMove(e) {
    if (!this.level) return;
    const [sx, sy] = this._pos(e);
    const d = this.dragging;

    // hover info
    const [ixf, iyf] = this.screenToImg(sx, sy);
    const ix = Math.floor(ixf), iy = Math.floor(iyf);
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.events.onHover?.({ ix, iy, wx, wy, pixel: this.level.terrain.getPixel(ix, iy) });

    if (!d) {
      // while picking a connection target, highlight the object under the cursor
      if (this.pickObjectMode) {
        this._hitObject(sx, sy).then((hit) => {
          if (hit !== this._pickHover) { this._pickHover = hit; this.requestRender(); }
        });
        this._cursor = [sx, sy];
        return;
      }
      if (this.tool === TOOLS.SELECT) {
        const h = this._hitPathHandle(sx, sy);
        if ((h?.index ?? -1) !== (this.hoverPathHandle?.index ?? -1) || h?.obj !== this.hoverPathHandle?.obj) {
          this.hoverPathHandle = h;
          this.requestRender();
        }
      }
      if (this.tool !== TOOLS.SELECT) this.requestRender(); // brush cursor preview
      this._cursor = [sx, sy];
      return;
    }
    this._cursor = [sx, sy];

    if (d.kind === 'pan') {
      this.panX = d.panX + (sx - d.sx);
      this.panY = d.panY + (sy - d.sy);
      this.requestRender();
    } else if (d.kind === 'object') {
      let nx = wx + d.dx, ny = wy + d.dy;
      if (e.shiftKey) { nx = Math.round(nx * 2) / 2; ny = Math.round(ny * 2) / 2; }
      else if (!e.altKey) [nx, ny] = this._snapToNeighbors(d.obj, nx, ny);
      d.obj.x = nx; d.obj.y = ny;
      d.moved = true;
      this.events.onChange?.('move');
      this.requestRender();
    } else if (d.kind === 'room') {
      this.level.room.x = wx; this.level.room.y = wy;
      this.events.onChange?.('move');
      this.requestRender();
    } else if (d.kind === 'path') {
      const pts = d.obj.getPath();
      const global = d.obj.properties.PathIsGlobal === '1';
      if (global) pts[d.index] = [wx, wy];
      else pts[d.index] = [wx - d.obj.x, wy - d.obj.y];
      d.obj.setPath(pts);
      this.events.onChange?.('path');
      this.requestRender();
    } else if (d.kind === 'paint') {
      this.level.terrain.line(d.lx, d.ly, ix, iy, this._rgb(), this.brushSize);
      this._smartPass(
        Math.min(d.lx, ix) - this.brushSize, Math.min(d.ly, iy) - this.brushSize,
        Math.max(d.lx, ix) + this.brushSize, Math.max(d.ly, iy) + this.brushSize
      );
      d.lx = ix; d.ly = iy;
      this.refreshTerrain();
    } else if (d.kind === 'shape') {
      d.x1 = ix; d.y1 = iy;
      this.requestRender();
    }
  }

  _onUp() {
    const d = this.dragging;
    if (!d) return;
    this.dragging = null;
    if (d.kind === 'shape') {
      this.level.pushUndo();
      const rgb = this._rgb();
      if (this.tool === TOOLS.LINE) this.level.terrain.line(d.x0, d.y0, d.x1, d.y1, rgb, this.brushSize);
      else this.level.terrain.rect(d.x0, d.y0, d.x1, d.y1, rgb, !this._altRect);
      this._smartPass(
        Math.min(d.x0, d.x1) - this.brushSize, Math.min(d.y0, d.y1) - this.brushSize,
        Math.max(d.x0, d.x1) + this.brushSize, Math.max(d.y0, d.y1) + this.brushSize
      );
      this.shapePreview = null;
      this.refreshTerrain();
      this.events.onChange?.();
    } else if (d.kind === 'object') {
      if (!d.moved) this.level._undo.pop(); // click without move: drop the undo point
      else this.events.onChange?.();
    } else if (d.kind === 'paint' || d.kind === 'path' || d.kind === 'room') {
      this.events.onChange?.();
    }
    this.requestRender();
  }

  _onKey(e) {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space') { this._space = e.type === 'keydown' ? true : this._space; }
    if (!this.level) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); this.doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); this.doRedo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'd' && this.selected) {
      e.preventDefault();
      this.level.pushUndo();
      const copy = this.level.duplicateObject(this.selected);
      this.selected = copy;
      this.events.onSelect?.(copy);
      this.events.onChange?.();
      this.requestRender();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'c' && this.selected) {
      e.preventDefault();
      this._clipboard = this.selected.clone();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'x' && this.selected) {
      e.preventDefault();
      this._clipboard = this.selected.clone();
      this.level.pushUndo();
      this.level.removeObject(this.selected);
      this.selected = null;
      this.events.onSelect?.(null);
      this.events.onChange?.();
      this.requestRender();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && k === 'v' && this._clipboard) {
      e.preventDefault();
      this.level.pushUndo();
      const copy = this._clipboard.clone();
      copy.name = this.level.uniqueObjectName(copy.name.replace(/\d+$/, ''));
      copy.x += 2; copy.y -= 2;
      this.level.objects.push(copy);
      this.selected = copy;
      this.events.onSelect?.(copy);
      this.events.onChange?.();
      this.preloadVisuals();
      this.requestRender();
      return;
    }
    if ((k === 'delete' || k === 'backspace') && this.selected) {
      this.level.pushUndo();
      this.level.removeObject(this.selected);
      this.selected = null;
      this.events.onSelect?.(null);
      this.events.onChange?.();
      this.requestRender();
      return;
    }
    if (this.selected && ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.25;
      this.level.pushUndo();
      if (k === 'arrowup') this.selected.y += step;
      if (k === 'arrowdown') this.selected.y -= step;
      if (k === 'arrowleft') this.selected.x -= step;
      if (k === 'arrowright') this.selected.x += step;
      this.events.onChange?.('move');
      this.requestRender();
    }
  }

  setSpace(down) { this._space = down; }

  /** World-space axis-aligned bounding box of an object, optionally evaluated
   *  at a candidate position (atX, atY) instead of its current x/y. Used for
   *  neighbor snapping; rotation is exact at 0/90/180/270 and approximate
   *  otherwise, which is fine for a snap heuristic. */
  _objWorldBBox(obj, atX, atY) {
    const vis = this.visualCache.get((obj.filename || '').toLowerCase());
    const b = vis?.bboxPx || { minX: -6, minY: -6, maxX: 6, maxY: 6 };
    const a = degToRad(-obj.angle);
    const cos = Math.cos(a), sin = Math.sin(a);
    const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]]
      .map(([lx, ly]) => [(lx * cos - ly * sin) / GRID_TO_PX, -(lx * sin + ly * cos) / GRID_TO_PX]);
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    const ox = atX ?? obj.x, oy = atY ?? obj.y;
    return {
      minX: ox + Math.min(...xs), maxX: ox + Math.max(...xs),
      minY: oy + Math.min(...ys), maxY: oy + Math.max(...ys),
    };
  }

  /** Nudge a dragged object's candidate position so its edges or center line
   *  up with a nearby object's edges or center — pipes, decoration and
   *  sprinklers snap together cleanly instead of leaving ugly gaps/overlaps. */
  _snapToNeighbors(obj, nx, ny) {
    const db = this._objWorldBBox(obj, nx, ny);
    const dcx = (db.minX + db.maxX) / 2, dcy = (db.minY + db.maxY) / 2;
    let bestDx = null, bestDy = null;
    for (const other of this.level.objects) {
      if (other === obj) continue;
      const ob = this._objWorldBBox(other);
      const ocx = (ob.minX + ob.maxX) / 2, ocy = (ob.minY + ob.maxY) / 2;
      for (const d of [ob.minX - db.minX, ob.maxX - db.minX, ob.minX - db.maxX, ob.maxX - db.maxX, ocx - dcx]) {
        if (Math.abs(d) < SNAP_DIST && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) bestDx = d;
      }
      for (const d of [ob.minY - db.minY, ob.maxY - db.minY, ob.minY - db.maxY, ob.maxY - db.maxY, ocy - dcy]) {
        if (Math.abs(d) < SNAP_DIST && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) bestDy = d;
      }
    }
    return [nx + (bestDx || 0), ny + (bestDy || 0)];
  }

  /** Rotate the selected object by `delta` degrees (e.g. 45 from the R key). */
  rotateSelected(delta) {
    if (!this.selected) return;
    this.level.pushUndo();
    this.selected.angle = ((this.selected.angle + delta) % 360 + 360) % 360;
    this.events.onChange?.();
    this.requestRender();
  }

  /** Returns the rock family RGB set when smart painting applies, else null. */
  _smartFamily() {
    if (!this.smartTerrain) return null;
    return rockFamilyRgbs();
  }

  /** Runs the smart merge over a dirty rect when the setting is on. For rock
   *  it recomputes the highlight rim so painted rock fuses with existing rock;
   *  for dirt it normalizes the near-duplicate alias so a painted patch and
   *  the level's original dirt read as one uniform mass. */
  _smartPass(x0, y0, x1, y1) {
    if (!this.smartTerrain || !this.level) return;
    const t = this.level.terrain;
    const rock = getMaterial('rock').rgb;
    const hi = getMaterial('rock_hi').rgb;
    t.smartRockPass(x0, y0, x1, y1, rock, hi, rockFamilyRgbs());
    // unify the two shipped dirt variants so masses don't show a seam
    const dirt = getMaterial('dirt').rgb;
    t.normalizeColorInRect(x0, y0, x1, y1, [112, 91, 49], dirt);
  }

  doUndo() {
    if (this.level?.undo()) {
      this.selected = null;
      this.events.onSelect?.(null);
      this.refreshTerrain();
      this.events.onChange?.('undo');
    }
  }

  doRedo() {
    if (this.level?.redo()) {
      this.selected = null;
      this.events.onSelect?.(null);
      this.refreshTerrain();
      this.events.onChange?.('redo');
    }
  }

  _rgb() {
    if (this.tool === TOOLS.ERASER) return getMaterial('empty').rgb;
    return getMaterial(this.material).rgb;
  }

  // ---------- hit testing ----------

  async _hitObject(sx, sy) {
    if (!this.level) return null;
    const [ix, iy] = this.screenToImg(sx, sy);
    // iterate topmost-first (later in list draws on top)
    for (let i = this.level.objects.length - 1; i >= 0; i--) {
      const obj = this.level.objects[i];
      const vis = await this.getVisual(obj.filename || '');
      const [ox, oy] = worldToImg(obj.x, obj.y, this.level.terrain.width, this.level.terrain.height);
      // transform click into object-local space (undo rotation)
      const a = degToRad(obj.angle); // world CCW; in y-down img space rotation appears CW
      const dx = ix - ox, dy = iy - oy;
      const cos = Math.cos(a), sin = Math.sin(a);
      // inverse of rotate(-a) in y-down space:
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const b = vis.bboxPx;
      const padding = 2 / this.zoom;
      if (lx >= b.minX - padding && lx <= b.maxX + padding && ly >= b.minY - padding && ly <= b.maxY + padding) {
        return obj;
      }
    }
    return null;
  }

  _hitPathHandle(sx, sy) {
    const obj = this.selected;
    if (!obj || !this.showPaths) return null;
    const pts = obj.getPath();
    if (!pts.length) return null;
    const global = obj.properties.PathIsGlobal === '1';
    for (let i = 0; i < pts.length; i++) {
      const wx = global ? pts[i][0] : obj.x + pts[i][0];
      const wy = global ? pts[i][1] : obj.y + pts[i][1];
      const [hx, hy] = this.worldToScreen(wx, wy);
      if (Math.hypot(sx - hx, sy - hy) < 8) return { obj, index: i };
    }
    return null;
  }

  // ---------- rendering ----------

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = parent.clientWidth * dpr;
    this.canvas.height = parent.clientHeight * dpr;
    this.canvas.style.width = parent.clientWidth + 'px';
    this.canvas.style.height = parent.clientHeight + 'px';
    this._dpr = dpr;
    this.requestRender();
  }

  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.render();
    });
  }

  render() {
    const ctx = this.ctx;
    const dpr = this._dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.level) return;

    const t = this.level.terrain;
    const w = t.width * this.zoom;
    const h = t.height * this.zoom;

    // backdrop + border
    ctx.fillStyle = '#0b0f17';
    ctx.fillRect(this.panX - 2, this.panY - 2, w + 4, h + 4);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrainCanvas, this.panX, this.panY, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.panX - 0.5, this.panY - 0.5, w + 1, h + 1);

    // grid
    if (this.showGrid && this.zoom >= 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath();
      for (let x = 0; x <= t.width; x++) {
        ctx.moveTo(this.panX + x * this.zoom, this.panY);
        ctx.lineTo(this.panX + x * this.zoom, this.panY + h);
      }
      for (let y = 0; y <= t.height; y++) {
        ctx.moveTo(this.panX, this.panY + y * this.zoom);
        ctx.lineTo(this.panX + w, this.panY + y * this.zoom);
      }
      ctx.stroke();
    }

    // shape preview
    if (this.shapePreview) {
      const d = this.shapePreview;
      ctx.save();
      ctx.strokeStyle = '#5eead4';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      const x0 = this.panX + Math.min(d.x0, d.x1) * this.zoom;
      const y0 = this.panY + Math.min(d.y0, d.y1) * this.zoom;
      const x1 = this.panX + (Math.max(d.x0, d.x1) + 1) * this.zoom;
      const y1 = this.panY + (Math.max(d.y0, d.y1) + 1) * this.zoom;
      if (this.tool === TOOLS.RECT) ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      else {
        ctx.beginPath();
        ctx.moveTo(this.panX + (d.x0 + 0.5) * this.zoom, this.panY + (d.y0 + 0.5) * this.zoom);
        ctx.lineTo(this.panX + (d.x1 + 0.5) * this.zoom, this.panY + (d.y1 + 0.5) * this.zoom);
        ctx.stroke();
      }
      ctx.restore();
    }

    // connections between objects (switch -> motor, converter -> spout, …)
    const connections = [];
    const connSources = new Set();
    const connTargets = new Set();
    if (this.showConnections) {
      const byName = new Map(this.level.objects.map((o) => [o.name, o]));
      for (const obj of this.level.objects) {
        for (const [k, v] of Object.entries(obj.properties)) {
          if (!k.startsWith('Connected') || !v) continue;
          const target = byName.get(v);
          if (!target || target === obj) continue;
          const kind = k.startsWith('ConnectedSpout') ? 'spout' : k.startsWith('ConnectedYSwitch') ? 'ypipe' : 'obj';
          // switch/generator -> object arrows are color matched to the group chip
          const color = kind === 'obj' ? groupColor(obj.name) : null;
          connections.push({ from: obj, to: target, kind, color });
          connSources.add(obj);
          connTargets.add(target);
        }
        // Parent = this object is glued onto another and moves with it (pink link)
        const par = obj.properties.Parent;
        if (par) {
          const target = byName.get(par);
          if (target && target !== obj) {
            connections.push({ from: obj, to: target, kind: 'parent', color: '#f472b6' });
            connSources.add(obj);
            connTargets.add(target);
          }
        }
      }
    }

    // objects
    for (const obj of this.level.objects) {
      this._drawObject(ctx, obj);
      if (connSources.has(obj) || connTargets.has(obj)) {
        this._drawConnDot(ctx, obj, connSources.has(obj));
      }
    }

    for (const c of connections) this._drawConnection(ctx, c);

    // room marker
    if (this.level.room) {
      const [rx, ry] = this.worldToScreen(this.level.room.x, this.level.room.y);
      ctx.save();
      ctx.fillStyle = 'rgba(255,234,0,0.9)';
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(rx, ry, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 9px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('R', rx, ry + 0.5);
      ctx.restore();
    }

    // connection pick: ring the object the cursor is over
    if (this.pickObjectMode && this._pickHover) {
      const vis = this.visualCache.get((this._pickHover.filename || '').toLowerCase());
      const [hx, hy] = this.worldToScreen(this._pickHover.x, this._pickHover.y);
      const b = vis?.bboxPx || { minX: -7, minY: -7, maxX: 7, maxY: 7 };
      ctx.save();
      ctx.strokeStyle = '#ffb454';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = '#ffb454';
      ctx.shadowBlur = 10;
      ctx.strokeRect(hx + b.minX * this.zoom - 3, hy + b.minY * this.zoom - 3,
        (b.maxX - b.minX) * this.zoom + 6, (b.maxY - b.minY) * this.zoom + 6);
      ctx.restore();
    } else if (!this.pickObjectMode && this._pickHover) {
      this._pickHover = null;
    }

    // selection + path overlay
    if (this.selected) this._drawSelection(ctx, this.selected);

    // brush cursor
    if (this.tool !== TOOLS.SELECT && this._cursor && !this.dragging) {
      const [cx, cy] = this._cursor;
      const [ix, iy] = this.screenToImg(cx, cy).map(Math.floor);
      const half = Math.floor(this.brushSize / 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        this.panX + (ix - half) * this.zoom,
        this.panY + (iy - half) * this.zoom,
        this.brushSize * this.zoom,
        this.brushSize * this.zoom
      );
      ctx.restore();
    }
  }

  _drawObject(ctx, obj) {
    const vis = this.visualCache.get((obj.filename || '').toLowerCase());
    const [ox, oy] = this.worldToScreen(obj.x, obj.y);
    if (!vis) {
      this.getVisual(obj.filename || '');
      this._drawPlaceholder(ctx, ox, oy, obj);
      return;
    }
    if (!vis.sprites.length || vis.sprites.every((s) => !s.bitmap)) {
      this._drawPlaceholder(ctx, ox, oy, obj, vis.missing);
    }
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(-degToRad(obj.angle));
    ctx.imageSmoothingEnabled = true;
    for (const s of vis.sprites) {
      if (!s.bitmap || !s.rect) continue;
      ctx.save();
      ctx.translate(s.pos[0] * GRID_TO_PX * this.zoom, -s.pos[1] * GRID_TO_PX * this.zoom);
      ctx.rotate(-degToRad(s.angle));
      ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
      const dw = s.wPx * this.zoom;
      const dh = s.hPx * this.zoom;
      ctx.drawImage(s.bitmap, s.rect.x, s.rect.y, s.rect.w, s.rect.h, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
    }
    // collision shapes overlay
    if (this.showCollision && vis.shapes?.length) {
      ctx.strokeStyle = 'rgba(94,234,212,0.9)';
      ctx.lineWidth = 1.5;
      for (const shape of vis.shapes) {
        ctx.beginPath();
        shape.forEach(([px, py], i) => {
          const x = px * GRID_TO_PX * this.zoom;
          const y = -py * GRID_TO_PX * this.zoom;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Dashed arrow from a controlling object to its target. */
  _drawConnection(ctx, { from, to, kind, color: groupCol }) {
    const [x0, y0] = this.worldToScreen(from.x, from.y);
    const [x1, y1] = this.worldToScreen(to.x, to.y);
    const color = groupCol || (kind === 'spout' ? '#a78bfa' : kind === 'ypipe' ? '#5eead4' : '#2ea7ff');
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const a = Math.atan2(y1 - y0, x1 - x0);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - 9 * Math.cos(a - 0.38), y1 - 9 * Math.sin(a - 0.38));
    ctx.lineTo(x1 - 9 * Math.cos(a + 0.38), y1 - 9 * Math.sin(a + 0.38));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Small corner dot: blue = controls something, orange = is controlled. */
  _drawConnDot(ctx, obj, outgoing) {
    const vis = this.visualCache.get((obj.filename || '').toLowerCase());
    const [ox, oy] = this.worldToScreen(obj.x, obj.y);
    const b = vis?.bboxPx || { maxX: 6, minY: -6 };
    const x = ox + b.maxX * this.zoom;
    const y = oy + b.minY * this.zoom;
    // switch/generator sources use their group color; other sources stay blue
    const isController = Object.keys(obj.properties).some((k) => /^ConnectedObject\d+$/.test(k));
    ctx.save();
    ctx.fillStyle = outgoing ? (isController ? groupColor(obj.name) : '#2ea7ff') : '#ffb454';
    ctx.strokeStyle = '#0b0f17';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  _drawPlaceholder(ctx, ox, oy, obj, missing = false) {
    ctx.save();
    ctx.fillStyle = missing ? 'rgba(248,113,113,0.85)' : 'rgba(125,211,252,0.85)';
    ctx.strokeStyle = '#0b0f17';
    ctx.beginPath();
    ctx.arc(ox, oy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b0f17';
    ctx.font = 'bold 8px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((obj.type || obj.name || '?')[0]?.toUpperCase() || '?', ox, oy + 0.5);
    ctx.restore();
  }

  _drawSelection(ctx, obj) {
    const vis = this.visualCache.get((obj.filename || '').toLowerCase());
    const [ox, oy] = this.worldToScreen(obj.x, obj.y);
    const b = vis?.bboxPx || { minX: -6, minY: -6, maxX: 6, maxY: 6 };
    ctx.save();
    ctx.translate(ox, oy);
    ctx.rotate(-degToRad(obj.angle));
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(b.minX * this.zoom, b.minY * this.zoom, (b.maxX - b.minX) * this.zoom, (b.maxY - b.minY) * this.zoom);
    ctx.restore();

    // motor path
    if (!this.showPaths) return;
    const pts = obj.getPath();
    if (!pts.length) return;
    const global = obj.properties.PathIsGlobal === '1';
    const closed = obj.properties.PathIsClosed === '1';
    const screenPts = pts.map(([px, py]) =>
      this.worldToScreen(global ? px : obj.x + px, global ? py : obj.y + py)
    );
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 4]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    for (const [x, y] of screenPts) ctx.lineTo(x, y);
    if (closed && screenPts.length) ctx.lineTo(screenPts[0][0], screenPts[0][1]);
    ctx.stroke();
    ctx.setLineDash([]);
    screenPts.forEach(([x, y], i) => {
      const hot = this.hoverPathHandle && this.hoverPathHandle.index === i;
      ctx.fillStyle = hot ? '#f59e0b' : '#fbbf24';
      ctx.strokeStyle = '#0b0f17';
      ctx.beginPath();
      ctx.arc(x, y, hot ? 7 : 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#0b0f17';
      ctx.font = 'bold 8px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i), x, y + 0.5);
    });
    ctx.restore();
  }
}
