// Side panels: level browser (left), object browser (left tab), and the
// properties inspector (right).
import { categorize } from '../core/objects.js';
import { MATERIALS, nearestMaterial } from '../data/materials.js';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.append(c);
  }
  return node;
}

// ---------------- level browser ----------------

export class LevelBrowser {
  constructor(container, onOpen) {
    this.container = container;
    this.onOpen = onOpen;
    this.levels = [];
    this.activeName = null;
    this.filter = '';
  }

  setLevels(levels) {
    this.levels = levels;
    this.render();
  }

  setActive(name) {
    this.activeName = name;
    this.render();
  }

  render() {
    const q = this.filter.toLowerCase();
    const list = this.levels.filter((l) => l.name.toLowerCase().includes(q));
    this.container.replaceChildren(
      el('div', { class: 'panel-search' },
        el('input', {
          type: 'search',
          placeholder: `Search ${this.levels.length} levels…`,
          value: this.filter,
          oninput: (e) => { this.filter = e.target.value; this.render(); },
        })
      ),
      el('div', { class: 'list scroll' },
        ...list.map((l) =>
          el('button', {
            class: 'list-item' + (l.name === this.activeName ? ' active' : ''),
            onclick: () => this.onOpen(l),
            title: l.xmlPath,
          },
            el('span', { class: 'list-name', text: l.name }),
            l.pngPath ? null : el('span', { class: 'tag warn', text: 'no png' })
          )
        )
      )
    );
  }
}

// ---------------- object browser ----------------

export class ObjectBrowser {
  constructor(container, resolver, onPlace) {
    this.container = container;
    this.resolver = resolver;
    this.onPlace = onPlace;
    this.filter = '';
    this.items = [];
    this.thumbCache = new Map();
  }

  load() {
    this.items = this.resolver.listObjects();
    this.render();
  }

  async _thumb(gamePath, img) {
    if (this.thumbCache.has(gamePath)) {
      img.src = this.thumbCache.get(gamePath);
      return;
    }
    try {
      const vis = await this.resolver.resolveVisual(gamePath);
      const s = vis.sprites.find((x) => x.bitmap && x.rect);
      if (!s) return;
      const c = document.createElement('canvas');
      const size = 40;
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      const scale = Math.min(size / s.rect.w, size / s.rect.h);
      const dw = s.rect.w * scale, dh = s.rect.h * scale;
      ctx.drawImage(s.bitmap, s.rect.x, s.rect.y, s.rect.w, s.rect.h, (size - dw) / 2, (size - dh) / 2, dw, dh);
      const url = c.toDataURL();
      this.thumbCache.set(gamePath, url);
      img.src = url;
    } catch { /* keep placeholder */ }
  }

  render() {
    const q = this.filter.toLowerCase();
    const groups = new Map();
    for (const item of this.items) {
      if (q && !item.name.toLowerCase().includes(q)) continue;
      const cat = categorize(item.name);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(item);
    }
    const order = ['Collectibles', 'Spouts & pipes', 'Switches & doors', 'Hazards', 'Fans', 'Balloons',
      'Converters & portals', 'Platforms & props', 'Characters', 'Decoration', 'Other'];
    const sections = [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));

    this.container.replaceChildren(
      el('div', { class: 'panel-search' },
        el('input', {
          type: 'search',
          placeholder: `Search ${this.items.length} objects…`,
          value: this.filter,
          oninput: (e) => { this.filter = e.target.value; this.render(); },
        })
      ),
      el('div', { class: 'hint-row', text: 'Click an object, then click in the level to place it.' }),
      el('div', { class: 'scroll obj-groups' },
        ...sections.map(([cat, items]) =>
          el('details', { class: 'obj-group', open: q ? '' : null },
            el('summary', {}, el('span', { text: cat }), el('span', { class: 'count', text: items.length })),
            el('div', { class: 'obj-grid' },
              ...items.map((item) => {
                const img = el('img', { alt: '', loading: 'lazy' });
                this._thumb(item.gamePath, img);
                return el('button', {
                  class: 'obj-card',
                  title: item.gamePath,
                  onclick: () => this.onPlace(item),
                }, img, el('span', { text: item.name }));
              })
            )
          )
        )
      )
    );
  }
}

// ---------------- properties inspector ----------------

export class Inspector {
  constructor(container, callbacks) {
    this.container = container;
    this.cb = callbacks; // { onEdit(), getLevel(), onDelete(obj), onDuplicate(obj) }
    this.object = null;
  }

  setObject(obj) {
    this.object = obj;
    this.render();
  }

  /** Lightweight position refresh while dragging. */
  refreshPosition() {
    if (!this.object) return;
    const x = this.container.querySelector('[data-pos-x]');
    const y = this.container.querySelector('[data-pos-y]');
    if (x) x.value = fmt(this.object.x);
    if (y) y.value = fmt(this.object.y);
  }

  render() {
    const level = this.cb.getLevel();
    if (!level) { this.container.replaceChildren(); return; }
    if (!this.object) {
      this.container.replaceChildren(
        el('div', { class: 'inspector-empty' },
          el('h3', { text: 'Level properties' }),
          this._kvEditor(level.properties, () => this.cb.onEdit()),
          el('div', { class: 'sep' }),
          el('h3', { text: 'Level stats' }),
          this._stats(level),
          el('p', { class: 'muted small', text: 'Select an object in the level to edit it, or use the Terrain tools to paint.' })
        )
      );
      return;
    }

    const obj = this.object;
    const nameInput = el('input', {
      value: obj.name,
      onchange: (e) => { this.cb.push(); obj.name = e.target.value; this.cb.onEdit(); },
    });
    const posX = el('input', { type: 'number', step: '0.25', value: fmt(obj.x), 'data-pos-x': '1',
      onchange: (e) => { this.cb.push(); obj.x = parseFloat(e.target.value) || 0; this.cb.onEdit(); } });
    const posY = el('input', { type: 'number', step: '0.25', value: fmt(obj.y), 'data-pos-y': '1',
      onchange: (e) => { this.cb.push(); obj.y = parseFloat(e.target.value) || 0; this.cb.onEdit(); } });

    this.container.replaceChildren(
      el('div', { class: 'inspector-obj' },
        el('div', { class: 'insp-head' },
          el('h3', { text: obj.type ? `${obj.type} object` : 'Object' }),
          el('div', { class: 'row gap' },
            el('button', { class: 'btn small', text: 'Duplicate', title: 'Ctrl+D', onclick: () => this.cb.onDuplicate(obj) }),
            el('button', { class: 'btn small danger', text: 'Delete', title: 'Del', onclick: () => this.cb.onDelete(obj) })
          )
        ),
        field('Name', nameInput),
        el('div', { class: 'row gap' }, field('X (grid)', posX), field('Y (grid)', posY)),
        el('div', { class: 'sep' }),
        el('h4', { text: 'Properties' }),
        this._kvEditor(obj.properties, () => this.cb.onEdit(), obj),
        el('div', { class: 'sep' }),
        this._pathSection(obj)
      )
    );
  }

  _stats(level) {
    const hist = level.terrain.histogram();
    const total = level.terrain.width * level.terrain.height;
    const rows = [...hist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const [r, g, b] = key.split(',').map(Number);
        const mat = nearestMaterial(r, g, b);
        const exact = mat.rgb.join(',') === key;
        return el('div', { class: 'stat-row' },
          el('span', { class: 'swatch', style: `background: rgb(${key})` }),
          el('span', { class: 'stat-name', text: exact ? mat.name : `${mat.name}? (${key})` }),
          el('span', { class: 'stat-val', text: `${((count / total) * 100).toFixed(1)}%` })
        );
      });
    return el('div', { class: 'stats' },
      el('div', { class: 'stat-row' },
        el('span', { class: 'stat-name', text: 'Terrain size' }),
        el('span', { class: 'stat-val', text: `${level.terrain.width} × ${level.terrain.height} px` })
      ),
      el('div', { class: 'stat-row' },
        el('span', { class: 'stat-name', text: 'Objects' }),
        el('span', { class: 'stat-val', text: String(level.objects.length) })
      ),
      ...rows
    );
  }

  _kvEditor(record, onEdit, obj = null) {
    const wrap = el('div', { class: 'kv' });
    const rerender = () => { this.render(); };
    for (const key of Object.keys(record)) {
      const valInput = el('input', {
        value: record[key],
        onchange: (e) => { this.cb.push(); record[key] = e.target.value; onEdit(); },
      });
      wrap.append(
        el('div', { class: 'kv-row' },
          el('span', { class: 'kv-key', title: key, text: key }),
          valInput,
          el('button', {
            class: 'icon-btn', title: 'Remove property', html: '&times;',
            onclick: () => { this.cb.push(); delete record[key]; onEdit(); rerender(); },
          })
        )
      );
    }
    const newKey = el('input', { placeholder: 'New property…', list: 'prop-suggestions' });
    const addBtn = el('button', {
      class: 'btn small', text: 'Add',
      onclick: () => {
        const k = newKey.value.trim();
        if (!k || record[k] !== undefined) return;
        this.cb.push();
        record[k] = '';
        onEdit();
        rerender();
      },
    });
    wrap.append(el('div', { class: 'kv-row add' }, newKey, addBtn));
    return wrap;
  }

  _pathSection(obj) {
    const pts = obj.getPath();
    const wrap = el('div', {});
    wrap.append(el('h4', { text: 'Motor path' }));
    if (pts.length) {
      wrap.append(el('p', { class: 'muted small', text: 'Drag the yellow numbered handles in the level to move waypoints.' }));
    }
    const addBtn = el('button', {
      class: 'btn small', text: pts.length ? 'Add waypoint' : 'Create path',
      onclick: () => {
        this.cb.push();
        const next = pts.length ? [pts[pts.length - 1][0] + 4, pts[pts.length - 1][1]] : [4, 0];
        obj.setPath([...pts, next]);
        this.cb.onEdit();
        this.render();
      },
    });
    const removeBtn = pts.length
      ? el('button', {
          class: 'btn small', text: 'Remove last',
          onclick: () => {
            this.cb.push();
            obj.setPath(pts.slice(0, -1));
            this.cb.onEdit();
            this.render();
          },
        })
      : null;
    wrap.append(el('div', { class: 'row gap' }, addBtn, removeBtn));
    return wrap;
  }
}

function field(label, input) {
  return el('label', { class: 'field' }, el('span', { text: label }), input);
}

function fmt(n) { return String(Math.round(n * 1000) / 1000); }

/** Common property names, surfaced as autocomplete when adding properties. */
export function propertySuggestions() {
  return ['Angle', 'Type', 'Filename', 'FluidType', 'SpoutType', 'ExpulsionAngle', 'ExpulsionAngleVariation',
    'ParticleSpeed', 'ParticlesPerSecond', 'NumberParticles', 'Timer0', 'Timer1', 'Limit', 'Goal', 'GoalPreset',
    'PinOffset', 'PinMinAngle', 'PinMaxAngle', 'PathIsClosed', 'PathIsGlobal', 'MotorMoveSpeed', 'MotorWaitTime',
    'MotorTurnSpeed', 'MotorWaitTurn', 'MotorOn', 'MotorPingPong', 'GravityScale', 'Draggable', 'Interactive',
    'BlastRadius', 'BlastPower', 'SwitchType', 'ConnectedSpout0', 'ConnectedSpoutProbability0', 'StarType',
    'VelDamping', 'OmegaDamping', 'Parent', 'PlatinumType'];
}

export function materialPalette(container, current, onPick) {
  container.replaceChildren(
    ...MATERIALS.map((m) =>
      el('button', {
        class: 'mat' + (m.id === current ? ' active' : ''),
        title: `${m.name} — ${m.desc}`,
        onclick: () => onPick(m.id),
      },
        el('span', { class: 'swatch big', style: `background: rgb(${m.rgb.join(',')})` }),
        el('span', { class: 'mat-name', text: m.name })
      )
    )
  );
}
