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

import LEVEL_ORDER from '../data/levelOrder.json';
import { t } from '../i18n.js';

export class LevelBrowser {
  constructor(container, onOpen) {
    this.container = container;
    this.onOpen = onOpen;
    this.levels = [];
    this.activeName = null;
    this.filter = '';
    this.openPacks = new Set(['pack0']); // first world open by default
  }

  setLevels(levels) {
    this.levels = levels;
    this.byName = new Map(levels.map((l) => [l.name.toLowerCase(), l]));
    // resolve the in-game order against what is actually on disk
    this.packs = [];
    const placed = new Set();
    for (const pack of LEVEL_ORDER) {
      const entries = [];
      for (const lv of pack.levels) {
        const entry = this.byName.get(lv.file.toLowerCase());
        if (!entry) continue;
        entries.push({ entry, title: lv.title });
        placed.add(entry.name.toLowerCase());
      }
      if (entries.length) this.packs.push({ title: pack.title, character: pack.character, entries });
    }
    const rest = levels
      .filter((l) => !placed.has(l.name.toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({ entry, title: entry.name }));
    if (rest.length) this.packs.push({ title: t('levels.other'), character: '', entries: rest });
    this.render();
  }

  setActive(name) {
    this.activeName = name;
    // make sure the pack containing the active level is open
    const i = this.packs?.findIndex((p) => p.entries.some((e) => e.entry.name === name));
    if (i >= 0) this.openPacks.add('pack' + i);
    this.render();
  }

  _row({ entry, title }, num) {
    const showFile = title.toLowerCase() !== entry.name.toLowerCase();
    return el('button', {
      class: 'list-item' + (entry.name === this.activeName ? ' active' : ''),
      onclick: () => this.onOpen(entry),
      title: entry.name,
    },
      num != null ? el('span', { class: 'lvl-num', text: String(num) }) : null,
      el('span', { class: 'list-name', text: title }),
      showFile ? el('span', { class: 'lvl-file', text: entry.name }) : null,
      entry.pngPath ? null : el('span', { class: 'tag warn', text: 'no png' })
    );
  }

  render() {
    const q = this.filter.toLowerCase();
    const hadFocus = this.container.querySelector('.panel-search input') === document.activeElement;
    const caret = this.filter.length;
    const search = el('div', { class: 'panel-search' },
      el('input', {
        type: 'search',
        placeholder: t('search.levels', { n: this.levels.length }),
        value: this.filter,
        oninput: (e) => { this.filter = e.target.value; this.render(); },
      })
    );
    const restoreFocus = () => {
      if (!hadFocus) return;
      const input = search.querySelector('input');
      input.focus();
      input.setSelectionRange(caret, caret);
    };

    if (q) {
      // flat results across worlds, matching display title and filename
      const hits = [];
      for (const pack of this.packs || []) {
        for (const item of pack.entries) {
          if (item.title.toLowerCase().includes(q) || item.entry.name.toLowerCase().includes(q)) {
            hits.push(item);
          }
        }
      }
      this.container.replaceChildren(search,
        el('div', { class: 'list scroll' }, ...hits.map((item) => this._row(item))));
      restoreFocus();
      return;
    }

    let lastCharacter = null;
    const sections = [];
    (this.packs || []).forEach((pack, i) => {
      if (pack.character && pack.character !== lastCharacter) {
        lastCharacter = pack.character;
        sections.push(el('div', { class: 'world-label', text: pack.character }));
      }
      const id = 'pack' + i;
      const details = el('details', {
        class: 'obj-group',
        open: this.openPacks.has(id) ? '' : null,
        ontoggle: (e) => { e.target.open ? this.openPacks.add(id) : this.openPacks.delete(id); },
      },
        el('summary', {}, el('span', { text: pack.title }), el('span', { class: 'count', text: pack.entries.length })),
        el('div', { class: 'list' }, ...pack.entries.map((item, n) => this._row(item, n + 1)))
      );
      sections.push(details);
    });

    this.container.replaceChildren(search, el('div', { class: 'scroll obj-groups' }, ...sections));
    restoreFocus();
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
    this.openStacks = new Set();
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
    const hadFocus = this.container.querySelector('.panel-search input') === document.activeElement;
    const caret = this.filter.length;
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

    const card = (item) => {
      const img = el('img', { alt: '', loading: 'lazy' });
      this._thumb(item.gamePath, img);
      return el('button', {
        class: 'obj-card',
        title: item.gamePath,
        onclick: () => this.onPlace(item),
      }, img, el('span', { text: item.name }));
    };

    /** Numbered series like z_collectible_01..50 collapse into one stack card. */
    const stacked = (items) => {
      if (q) return items.map(card); // searching: show everything flat
      const byBase = new Map();
      for (const item of items) {
        const base = item.name.replace(/[_-]?\d+$/, '');
        if (!byBase.has(base)) byBase.set(base, []);
        byBase.get(base).push(item);
      }
      const out = [];
      for (const [base, group] of byBase) {
        if (group.length < 4) { out.push(...group.map(card)); continue; }
        const key = 'stack:' + base;
        const open = this.openStacks.has(key);
        const img = el('img', { alt: '', loading: 'lazy' });
        this._thumb(group[0].gamePath, img);
        out.push(el('button', {
          class: 'obj-card obj-stack' + (open ? ' open' : ''),
          title: `${group.length} variants of ${base}`,
          onclick: () => { open ? this.openStacks.delete(key) : this.openStacks.add(key); this.render(); },
        }, img, el('span', { text: base }), el('span', { class: 'stack-count', text: '×' + group.length })));
        if (open) out.push(el('div', { class: 'obj-grid stack-grid' }, ...group.map(card)));
      }
      return out;
    };

    this.container.replaceChildren(
      el('div', { class: 'panel-search' },
        el('input', {
          type: 'search',
          placeholder: t('search.objects', { n: this.items.length }),
          value: this.filter,
          oninput: (e) => { this.filter = e.target.value; this.render(); },
        })
      ),
      el('div', { class: 'hint-row', text: t('objects.hint') }),
      el('div', { class: 'scroll obj-groups' },
        ...sections.map(([cat, items]) =>
          el('details', { class: 'obj-group', open: q ? '' : null },
            el('summary', {}, el('span', { text: cat }), el('span', { class: 'count', text: items.length })),
            el('div', { class: 'obj-grid' }, ...stacked(items))
          )
        )
      )
    );
    if (hadFocus) {
      const input = this.container.querySelector('.panel-search input');
      input.focus();
      input.setSelectionRange(caret, caret);
    }
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
          el('h3', { text: t('insp.levelProps') }),
          this._kvEditor(level.properties, () => this.cb.onEdit()),
          el('div', { class: 'sep' }),
          el('h3', { text: t('insp.levelStats') }),
          this._stats(level),
          el('p', { class: 'muted small', text: t('insp.empty') })
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
          el('h3', { text: obj.type ? `${obj.type} ${t('insp.object')}` : t('insp.object') }),
          el('div', { class: 'row gap' },
            el('button', { class: 'btn small', text: t('btn.duplicate'), title: 'Ctrl+D', onclick: () => this.cb.onDuplicate(obj) }),
            el('button', { class: 'btn small danger', text: t('btn.delete'), title: 'Del', onclick: () => this.cb.onDelete(obj) })
          )
        ),
        field(t('insp.name'), nameInput),
        el('div', { class: 'row gap' }, field('X (grid)', posX), field('Y (grid)', posY)),
        el('div', { class: 'sep' }),
        this._spoutSection(obj),
        el('h4', { text: t('insp.props') }),
        this._kvEditor(obj.properties, () => this.cb.onEdit(), obj),
        el('div', { class: 'sep' }),
        this._pathSection(obj)
      )
    );
  }

  /** Friendly controls for spouts and drains: behavior, fluid, flow and a
   *  simple on/off timer. Writes the same properties the game reads
   *  (SpoutType, FluidType, ParticlesPerSecond, NumberParticles, Timer0/1). */
  _spoutSection(obj) {
    const isSpout = (obj.type || '').toLowerCase() === 'spout'
      || 'SpoutType' in obj.properties
      || /spout|drain/i.test(obj.properties.Filename || '');
    if (!isSpout) return null;

    const set = (key, value) => {
      this.cb.push();
      if (value === '' || value == null) delete obj.properties[key];
      else obj.properties[key] = String(value);
      this.cb.onEdit();
      this.render();
    };

    const behavior = el('select', {},
      ...[['OpenSpout', t('spout.b.open')], ['TouchSpout', t('spout.b.touch')],
          ['Drain', t('spout.b.drain')], ['DrainSpout', t('spout.b.drainspout')]]
        .map(([v, label]) => el('option', { value: v, text: label, selected: (obj.properties.SpoutType || 'OpenSpout') === v ? '' : null })));
    behavior.onchange = () => set('SpoutType', behavior.value);

    const fluid = el('select', {},
      ...[['Water', t('spout.f.water')], ['ContaminatedWater', t('spout.f.poison')], ['Lava', t('spout.f.ooze')]]
        .map(([v, label]) => el('option', { value: v, text: label, selected: (obj.properties.FluidType || 'Water') === v ? '' : null })));
    fluid.onchange = () => set('FluidType', fluid.value);

    const pps = el('input', { type: 'number', step: '1', min: '0', value: obj.properties.ParticlesPerSecond || '',
      placeholder: '60', onchange: () => set('ParticlesPerSecond', pps.value) });
    const limit = el('input', { type: 'number', step: '1', value: obj.properties.NumberParticles || '',
      placeholder: '-1', onchange: () => set('NumberParticles', limit.value) });

    // Timer0 "1 3.0" = on for 3s, Timer1 "0 2.0" = off for 2s, then loop
    const t0 = (obj.properties.Timer0 || '').split(' ');
    const t1 = (obj.properties.Timer1 || '').split(' ');
    const hasTimer = obj.properties.Timer0 != null;
    const onTime = el('input', { type: 'number', step: '0.5', min: '0.5', value: t0[0] === '1' ? t0[1] : (t1[0] === '1' ? t1[1] : '3') });
    const offTime = el('input', { type: 'number', step: '0.5', min: '0.5', value: t0[0] === '0' ? t0[1] : (t1[0] === '0' ? t1[1] : '2') });
    const timerChk = el('input', { type: 'checkbox' });
    timerChk.checked = hasTimer;
    const applyTimer = () => {
      this.cb.push();
      if (timerChk.checked) {
        obj.properties.Timer0 = `1 ${parseFloat(onTime.value) || 3}`;
        obj.properties.Timer1 = `0 ${parseFloat(offTime.value) || 2}`;
      } else {
        delete obj.properties.Timer0;
        delete obj.properties.Timer1;
      }
      this.cb.onEdit();
      this.render();
    };
    timerChk.onchange = applyTimer;
    onTime.onchange = applyTimer;
    offTime.onchange = applyTimer;

    return el('div', { class: 'spout-box' },
      el('h4', { text: t('spout.title') }),
      el('div', { class: 'field' }, el('label', { text: t('spout.behavior') }), behavior),
      el('div', { class: 'field' }, el('label', { text: t('spout.fluid') }), fluid),
      el('div', { class: 'row gap' },
        el('div', { class: 'field grow' }, el('label', { text: t('spout.flow') }), pps),
        el('div', { class: 'field grow' }, el('label', { text: t('spout.limit') }), limit)),
      el('label', { class: 'check-row' }, timerChk, el('span', { text: t('spout.timer') })),
      hasTimer
        ? el('div', { class: 'row gap' },
            el('div', { class: 'field grow' }, el('label', { text: t('spout.on') }), onTime),
            el('div', { class: 'field grow' }, el('label', { text: t('spout.off') }), offTime))
        : null,
      el('div', { class: 'sep' })
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
          el('span', { class: 'stat-name', text: exact ? t('mat.' + mat.id) : `${t('mat.' + mat.id)}? (${key})` }),
          el('span', { class: 'stat-val', text: `${((count / total) * 100).toFixed(1)}%` })
        );
      });
    return el('div', { class: 'stats' },
      el('div', { class: 'stat-row' },
        el('span', { class: 'stat-name', text: t('insp.terrainSize') }),
        el('span', { class: 'stat-val', text: `${level.terrain.width} × ${level.terrain.height} px` })
      ),
      el('div', { class: 'stat-row' },
        el('span', { class: 'stat-name', text: t('insp.objects') }),
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
    const newKey = el('input', { placeholder: t('insp.newProp'), list: 'prop-suggestions' });
    const addBtn = el('button', {
      class: 'btn small', text: t('btn.add'),
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
    wrap.append(el('h4', { text: t('insp.motorPath') }));
    if (pts.length) {
      wrap.append(el('p', { class: 'muted small', text: 'Drag the yellow numbered handles in the level to move waypoints.' }));
    }
    const addBtn = el('button', {
      class: 'btn small', text: pts.length ? t('insp.addWaypoint') : t('insp.createPath'),
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
        title: `${t('mat.' + m.id)}. ${m.desc}`,
        onclick: () => onPick(m.id),
      },
        el('span', { class: 'swatch big', style: `background: rgb(${m.rgb.join(',')})` }),
        el('span', { class: 'mat-name', text: t('mat.' + m.id) })
      )
    )
  );
}
