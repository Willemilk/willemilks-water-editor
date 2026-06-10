// Level model: terrain + object list + room marker + level properties,
// XML (de)serialization compatible with the game, and snapshot-based undo/redo.
import { Terrain } from './terrain.js';

let objectCounter = 0;

export class LevelObject {
  constructor({ name = '', x = 0, y = 0, properties = {} } = {}) {
    this.id = ++objectCounter;
    this.name = name;
    this.x = x;
    this.y = y;
    /** @type {Record<string, string>} ordered via insertion */
    this.properties = { ...properties };
  }

  get filename() { return this.properties.Filename || ''; }
  get angle() { return parseFloat(this.properties.Angle || '0') || 0; }
  set angle(v) { this.properties.Angle = String(v); }

  get type() {
    return this.properties.Type || '';
  }

  /** PathPos0..N parsed as [[x,y],...] (world units, relative unless PathIsGlobal). */
  getPath() {
    const pts = [];
    for (let i = 0; ; i++) {
      const v = this.properties['PathPos' + i];
      if (v === undefined) break;
      const [px, py] = v.trim().split(/\s+/).map(Number);
      pts.push([px || 0, py || 0]);
    }
    return pts;
  }

  setPath(points) {
    let i = 0;
    while (this.properties['PathPos' + i] !== undefined) {
      delete this.properties['PathPos' + i];
      i++;
    }
    points.forEach((p, idx) => {
      this.properties['PathPos' + idx] = `${round6(p[0])} ${round6(p[1])}`;
    });
  }

  clone() {
    return new LevelObject({
      name: this.name,
      x: this.x,
      y: this.y,
      properties: { ...this.properties },
    });
  }
}

function round6(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e6) / 1e6);
}

export class Level {
  constructor(name) {
    this.name = name;
    this.terrain = Terrain.blank();
    /** @type {LevelObject[]} */
    this.objects = [];
    this.room = null; // {x, y} or null
    /** @type {Record<string, string>} */
    this.properties = {};
    this.xmlPath = null;
    this.pngPath = null;

    this._undo = [];
    this._redo = [];
    this.dirty = false;
  }

  // ---------- XML ----------

  static parseXML(name, xmlText) {
    const level = new Level(name);
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error(`Could not parse ${name}.xml — ${err.textContent.slice(0, 200)}`);
    const root = doc.documentElement; // <Objects>

    for (const el of Array.from(root.children)) {
      if (el.tagName === 'Object') {
        const obj = new LevelObject({ name: el.getAttribute('name') || '' });
        const loc = el.querySelector(':scope > AbsoluteLocation');
        if (loc) {
          const [x, y] = (loc.getAttribute('value') || '0 0').trim().split(/\s+/).map(Number);
          obj.x = x || 0;
          obj.y = y || 0;
        }
        const props = el.querySelector(':scope > Properties');
        if (props) {
          for (const p of Array.from(props.querySelectorAll(':scope > Property'))) {
            obj.properties[p.getAttribute('name')] = p.getAttribute('value') ?? '';
          }
        }
        level.objects.push(obj);
      } else if (el.tagName === 'Room') {
        const loc = el.querySelector(':scope > AbsoluteLocation');
        if (loc) {
          const [x, y] = (loc.getAttribute('value') || '0 0').trim().split(/\s+/).map(Number);
          level.room = { x: x || 0, y: y || 0 };
        }
      } else if (el.tagName === 'Properties') {
        for (const p of Array.from(el.querySelectorAll(':scope > Property'))) {
          level.properties[p.getAttribute('name')] = p.getAttribute('value') ?? '';
        }
      }
    }
    return level;
  }

  serializeXML() {
    const esc = (s) =>
      String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('"', '&quot;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    const L = [];
    L.push('<?xml version="1.0"?>');
    L.push('<Objects>');
    for (const obj of this.objects) {
      L.push(`  <Object name="${esc(obj.name)}">`);
      L.push(`    <AbsoluteLocation value="${round6(obj.x)} ${round6(obj.y)}"/>`);
      L.push('    <Properties>');
      for (const [k, v] of Object.entries(obj.properties)) {
        L.push(`      <Property name="${esc(k)}" value="${esc(v)}"/>`);
      }
      L.push('    </Properties>');
      L.push('  </Object>');
    }
    if (this.room) {
      L.push('  <Room>');
      L.push(`    <AbsoluteLocation value="${round6(this.room.x)} ${round6(this.room.y)}"/>`);
      L.push('  </Room>');
    }
    if (Object.keys(this.properties).length) {
      L.push('  <Properties>');
      for (const [k, v] of Object.entries(this.properties)) {
        L.push(`    <Property name="${esc(k)}" value="${esc(v)}"/>`);
      }
      L.push('  </Properties>');
    }
    L.push('</Objects>');
    return L.join('\r\n') + '\r\n';
  }

  // ---------- objects ----------

  uniqueObjectName(base) {
    const names = new Set(this.objects.map((o) => o.name));
    if (!names.has(base) && base) return base;
    let i = 0;
    let n;
    do n = `${base || 'Obj'}${i++}`;
    while (names.has(n));
    return n;
  }

  addObject(hsPath, x, y, type = '') {
    const base = hsPath.split('/').pop().replace(/\.hs$/i, '');
    const obj = new LevelObject({
      name: this.uniqueObjectName(base),
      x, y,
      properties: { Angle: '0', Filename: hsPath },
    });
    if (type) obj.properties.Type = type;
    this.objects.push(obj);
    return obj;
  }

  removeObject(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
  }

  duplicateObject(obj) {
    const copy = obj.clone();
    copy.name = this.uniqueObjectName(obj.name.replace(/\d+$/, ''));
    copy.x += 2;
    copy.y -= 2;
    this.objects.push(copy);
    return copy;
  }

  // ---------- undo / redo ----------

  _snapshot() {
    return {
      terrain: new Uint8ClampedArray(this.terrain.data),
      tw: this.terrain.width,
      th: this.terrain.height,
      objects: this.objects.map((o) => ({ name: o.name, x: o.x, y: o.y, properties: { ...o.properties } })),
      room: this.room ? { ...this.room } : null,
      properties: { ...this.properties },
    };
  }

  _restore(s) {
    this.terrain = new Terrain(s.tw, s.th, new Uint8ClampedArray(s.terrain));
    this.objects = s.objects.map((o) => new LevelObject(o));
    this.room = s.room ? { ...s.room } : null;
    this.properties = { ...s.properties };
  }

  /** Call BEFORE mutating; records current state as an undo point. */
  pushUndo() {
    this._undo.push(this._snapshot());
    if (this._undo.length > 100) this._undo.shift();
    this._redo.length = 0;
    this.dirty = true;
  }

  undo() {
    if (!this._undo.length) return false;
    this._redo.push(this._snapshot());
    this._restore(this._undo.pop());
    return true;
  }

  redo() {
    if (!this._redo.length) return false;
    this._undo.push(this._snapshot());
    this._restore(this._redo.pop());
    return true;
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
}
