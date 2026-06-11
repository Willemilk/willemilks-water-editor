// Side panels: level browser (left), object browser (left tab), and the
// properties inspector (right).
import { categorize } from '../core/objects.js';
import { MATERIALS, nearestMaterial, materialForColor } from '../data/materials.js';

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

/** Search input with a clear button that appears while there is text. */
function searchBox(placeholder, value, oninput) {
  const input = el('input', { type: 'search', placeholder, value, oninput });
  return el('div', { class: 'panel-search' },
    input,
    value
      ? el('button', {
          class: 'search-clear', title: t('btn.cancel'), html: '&times;',
          onclick: () => { input.value = ''; oninput({ target: input }); },
        })
      : null);
}

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

  _row({ entry, title }, num, packTitle = null) {
    const showFile = title.toLowerCase() !== entry.name.toLowerCase();
    return el('button', {
      class: 'list-item' + (entry.name === this.activeName ? ' active' : ''),
      onclick: () => this.onOpen(entry),
      title: entry.name,
    },
      num != null ? el('span', { class: 'lvl-num', text: String(num) }) : null,
      el('span', { class: 'list-name', text: title }),
      packTitle ? el('span', { class: 'tag', text: packTitle }) : null,
      showFile && !packTitle ? el('span', { class: 'lvl-file', text: entry.name }) : null,
      entry.pngPath ? null : el('span', { class: 'tag warn', text: 'no png' })
    );
  }

  render() {
    const q = this.filter.toLowerCase();
    const hadFocus = this.container.querySelector('.panel-search input') === document.activeElement;
    const caret = this.filter.length;
    const search = searchBox(t('search.levels', { n: this.levels.length }), this.filter,
      (e) => { this.filter = e.target.value; this.render(); });
    const restoreFocus = () => {
      if (!hadFocus) return;
      const input = search.querySelector('input');
      input.focus();
      input.setSelectionRange(caret, caret);
    };

    if (q) {
      // flat results across worlds, matching display title and filename;
      // each hit shows which world it belongs to
      const hits = [];
      for (const pack of this.packs || []) {
        for (const item of pack.entries) {
          if (item.title.toLowerCase().includes(q) || item.entry.name.toLowerCase().includes(q)) {
            hits.push({ item, pack });
          }
        }
      }
      this.container.replaceChildren(search,
        el('div', { class: 'list scroll' }, ...hits.map(({ item, pack }) => this._row(item, null, pack.title))));
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
      searchBox(t('search.objects', { n: this.items.length }), this.filter,
        (e) => { this.filter = e.target.value; this.render(); }),
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

/** Accent color per object kind, used for section borders and badges. */
const KIND_COLORS = {
  spout: '#2ea7ff',
  bomb: '#ff5d5d',
  fan: '#3ddc84',
  balloon: '#19c8a8',
  switch: '#ffb454',
  converter: '#a78bfa',
  ypipe: '#5eead4',
  brokenpipe: '#d97706',
  teleport: '#60a5fa',
  sprinkler: '#38bdf8',
  motor: '#94a6bb',
  collectible: '#fbbf24',
  generic: '#5c6f85',
};

const KIND_SECTION_KEY = {
  bomb: 'sec.bomb', fan: 'sec.fan', balloon: 'sec.balloon', switch: 'sec.switch',
  converter: 'sec.converter', ypipe: 'sec.ypipe', brokenpipe: 'sec.brokenpipe',
  teleport: 'sec.teleport', sprinkler: 'sec.sprinkler', motor: 'sec.motor',
};

export class Inspector {
  constructor(container, callbacks) {
    this.container = container;
    // { onEdit(), getLevel(), push(), onDelete(obj), onDuplicate(obj), onPickConnection(obj, propName) }
    this.cb = callbacks;
    this.object = null;
    this._advOpen = null; // remembers the Advanced properties fold per object
  }

  setObject(obj) {
    this.object = obj;
    this._advOpen = null;
    this.render();
  }

  /** Classify the selected object so the right quick editor shows up. */
  _objectKind(obj) {
    const fn = (obj.properties.Filename || '').toLowerCase();
    const type = (obj.type || '').toLowerCase();
    const p = obj.properties;
    if (/bomb|mine/.test(fn)) return 'bomb';
    if (/fan|vacuum/.test(fn)) return 'fan';
    if (/balloon|bubble/.test(fn)) return 'balloon';
    if (/y[_-]?switch|pipe_y/.test(fn) || p.YSwitchPosition !== undefined) return 'ypipe';
    if (/switch|lever/.test(fn) || p.SwitchType !== undefined) return 'switch';
    if (/converter/.test(fn) || p.ConnectedConverter !== undefined) return 'converter';
    if (/broken/.test(fn)) return 'brokenpipe';
    if (/teleport|portal/.test(fn)) return 'teleport';
    if (/sprinkler/.test(fn) || p.SprinklerWidth !== undefined) return 'sprinkler';
    if (type === 'spout' || /spout|drain|faucet|shower|valve/.test(fn) || p.SpoutType !== undefined) return 'spout';
    if (/star|duck|note|collect/.test(fn)) return 'collectible';
    if (p.PathPos0 !== undefined || p.MotorMoveSpeed !== undefined || p.MotorOn !== undefined) return 'motor';
    return 'generic';
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

    const kind = this._objectKind(obj);
    const color = KIND_COLORS[kind] || KIND_COLORS.generic;
    const badgeText = kind === 'spout' ? (obj.type || 'spout') : (KIND_SECTION_KEY[kind] ? t(KIND_SECTION_KEY[kind]) : obj.type);
    const smart = this._smartSection(obj, kind);
    // objects of any kind can sit on a motor path; surface those props too
    const extraMotor = kind !== 'motor' && obj.properties.PathPos0 !== undefined ? this._motorSection(obj) : null;
    const advOpen = this._advOpen ?? (kind === 'generic' && !smart);

    this.container.replaceChildren(
      el('div', { class: 'inspector-obj' },
        el('div', { class: 'insp-head' },
          el('h3', { text: obj.type ? `${obj.type} ${t('insp.object')}` : t('insp.object') }),
          badgeText ? el('span', { class: 'obj-badge', style: `color:${color};border-color:${color}`, text: badgeText }) : null,
          el('div', { class: 'row gap', style: 'margin-left:auto' },
            el('button', { class: 'btn small', text: t('btn.duplicate'), title: 'Ctrl+D', onclick: () => this.cb.onDuplicate(obj) }),
            el('button', { class: 'btn small danger', text: t('btn.delete'), title: 'Del', onclick: () => this.cb.onDelete(obj) })
          )
        ),
        field(t('insp.name'), nameInput),
        el('div', { class: 'row gap' }, field('X (grid)', posX), field('Y (grid)', posY)),
        this._bulkRow(obj),
        el('div', { class: 'sep' }),
        smart,
        extraMotor,
        el('details', {
          class: 'adv-props',
          open: advOpen ? '' : null,
          ontoggle: (e) => { this._advOpen = e.target.open; },
        },
          el('summary', { text: t('sec.advanced') }),
          this._kvEditor(obj.properties, () => this.cb.onEdit(), obj)),
        el('div', { class: 'sep' }),
        this._pathSection(obj)
      )
    );
  }

  /** Copy properties as JSON, and apply them to all objects of the same kind. */
  _bulkRow(obj) {
    const level = this.cb.getLevel();
    const alike = level ? level.objects.filter((o) => o.properties.Filename && o.properties.Filename === obj.properties.Filename) : [];
    const copyBtn = el('button', {
      class: 'btn small ghost', text: t('insp.copyProps'),
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(
            { name: obj.name, x: obj.x, y: obj.y, properties: obj.properties }, null, 2));
          copyBtn.textContent = t('insp.copied');
          setTimeout(() => { copyBtn.textContent = t('insp.copyProps'); }, 1500);
        } catch { /* clipboard unavailable */ }
      },
    });
    const applyBtn = alike.length > 1
      ? el('button', {
          class: 'btn small ghost', text: t('insp.applyAll', { n: alike.length }),
          onclick: () => {
            if (!confirm(t('insp.applyAllAsk', { n: alike.length }))) return;
            this.cb.push();
            for (const o of alike) {
              if (o === obj) continue;
              for (const [k, v] of Object.entries(obj.properties)) {
                // keep identity, placement and per object wiring out of the bulk copy
                if (k === 'Filename' || k === 'Type' || k === 'Angle') continue;
                if (/^PathPos/.test(k) || /^Connected/.test(k)) continue;
                o.properties[k] = v;
              }
            }
            this.cb.onEdit();
          },
        })
      : null;
    return el('div', { class: 'row gap', style: 'margin-bottom:9px' }, copyBtn, applyBtn);
  }

  // ---------------- smart sections per object kind ----------------

  _smartSection(obj, kind) {
    switch (kind) {
      case 'spout': return this._spoutSection(obj);
      case 'bomb': return this._bombSection(obj);
      case 'fan': return this._fanSection(obj);
      case 'balloon': return this._balloonSection(obj);
      case 'switch': return this._switchSection(obj);
      case 'converter': return this._converterSection(obj);
      case 'ypipe': return this._ypipeSection(obj);
      case 'brokenpipe': return this._brokenpipeSection(obj);
      case 'teleport': return this._teleportSection(obj);
      case 'sprinkler': return this._sprinklerSection(obj);
      case 'motor': return this._motorSection(obj);
      default: return this._genericPhysicsSection(obj);
    }
  }

  /** Shared small controls. Every write goes through set(): push undo,
   *  stringify, delete when emptied, notify. */
  _controls(obj) {
    const set = (key, value) => {
      this.cb.push();
      if (value === '' || value == null) delete obj.properties[key];
      else obj.properties[key] = String(value);
      this.cb.onEdit();
    };
    const num = (key, labelKey, ph = '', step = '0.1') => {
      const inp = el('input', {
        type: 'number', step, value: obj.properties[key] ?? '', placeholder: ph,
        onchange: () => set(key, inp.value),
      });
      return el('div', { class: 'field grow' }, el('label', { text: t(labelKey) }), inp);
    };
    const chk = (key, labelKey) => {
      const c = el('input', { type: 'checkbox' });
      c.checked = obj.properties[key] === '1' || obj.properties[key] === 'true';
      c.onchange = () => set(key, c.checked ? '1' : '0');
      return el('label', { class: 'check-row' }, c, el('span', { text: t(labelKey) }));
    };
    const sel = (key, labelKey, options, dflt = '') => {
      const s = el('select', {}, ...options.map(([v, lk]) =>
        el('option', { value: v, text: t(lk), selected: (obj.properties[key] ?? dflt) === v ? '' : null })));
      s.onchange = () => set(key, s.value);
      return el('div', { class: 'field' }, el('label', { text: t(labelKey) }), s);
    };
    return { set, num, chk, sel };
  }

  _section(kind, titleKey, ...children) {
    const color = KIND_COLORS[kind] || KIND_COLORS.generic;
    return el('div', { class: 'smart-box', style: `border-left-color:${color}` },
      el('h4', { style: `color:${color}`, text: t(titleKey) }),
      ...children.filter(Boolean));
  }

  _bombSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('bomb', 'sec.bomb',
      el('div', { class: 'row gap' },
        num('BlastRadius', 'prop.blastRadius', '5', '0.5'),
        num('BlastPower', 'prop.blastPower', '4000', '100')),
      num('GravityScale', 'prop.gravity', '0', '0.1'),
      chk('Draggable', 'prop.draggable'));
  }

  _fanSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('fan', 'sec.fan',
      chk('VacuumOn', 'prop.fanOn'),
      el('div', { class: 'row gap' },
        num('VacuumMaxForce', 'prop.fanStrength', '100', '10'),
        num('VacuumMaxD', 'prop.fanRange', '', '1')),
      el('div', { class: 'row gap' },
        num('VacuumMinAngle', 'prop.fanAngleMin', '', '5'),
        num('VacuumMaxAngle', 'prop.fanAngleMax', '', '5')));
  }

  _balloonSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('balloon', 'sec.balloon',
      num('GravityScale', 'prop.buoyancy', '-1', '0.1'),
      num('VelDamping', 'prop.damping', '0.99', '0.01'),
      chk('Draggable', 'prop.draggable'));
  }

  _connSlots(obj, prefix) {
    const out = [];
    for (let i = 0; obj.properties[prefix + i] !== undefined; i++) out.push(i);
    return out;
  }

  _switchSection(obj) {
    const { sel } = this._controls(obj);
    const slots = this._connSlots(obj, 'ConnectedObject');
    return this._section('switch', 'sec.switch',
      sel('SwitchType', 'prop.switchType',
        [['Flip', 'prop.switchFlip'], ['Momentary', 'prop.switchMomentary']], 'Flip'),
      el('div', { class: 'field' },
        el('label', { text: t('conn.title') }),
        ...slots.map((i) => this._connPicker(obj, 'ConnectedObject' + i, t('conn.controls', { n: i }))),
        el('button', {
          class: 'btn small', text: '+ ' + t('conn.add'),
          onclick: () => this.cb.onPickConnection?.(obj, 'ConnectedObject' + slots.length),
        })));
  }

  _converterSection(obj) {
    const { sel, num } = this._controls(obj);
    const slots = this._connSlots(obj, 'ConnectedSpout');
    return this._section('converter', 'sec.converter',
      sel('FluidType', 'prop.outputFluid',
        [['Water', 'spout.f.water'], ['ContaminatedWater', 'spout.f.poison'], ['Lava', 'spout.f.ooze']], 'Water'),
      el('div', { class: 'field' },
        el('label', { text: t('conn.title') }),
        ...slots.flatMap((i) => [
          this._connPicker(obj, 'ConnectedSpout' + i, t('conn.output', { n: i })),
          num('ConnectedSpoutProbability' + i, 'prop.probability', '100', '5'),
        ]),
        el('button', {
          class: 'btn small', text: '+ ' + t('conn.add'),
          onclick: () => this.cb.onPickConnection?.(obj, 'ConnectedSpout' + slots.length),
        })),
      this._connPicker(obj, 'ConnectedConverter', t('conn.converter')));
  }

  _ypipeSection(obj) {
    const { sel } = this._controls(obj);
    return this._section('ypipe', 'sec.ypipe',
      sel('YSwitchPosition', 'prop.switchType', [['left', 'left'], ['right', 'right']], 'left'),
      this._connPicker(obj, 'ConnectedYSwitchPort0', t('conn.switch')));
  }

  _brokenpipeSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('brokenpipe', 'sec.brokenpipe',
      chk('Draggable', 'prop.draggable'),
      num('GravityScale', 'prop.gravity', '0', '0.1'));
  }

  _teleportSection(obj) {
    const { num } = this._controls(obj);
    return this._section('teleport', 'sec.teleport',
      this._connPicker(obj, 'ConnectedObject0', t('conn.exit')),
      el('div', { class: 'row gap' },
        num('TeleportWaitTime', 'prop.teleWait', '', '0.1'),
        num('TeleportMoveTime', 'prop.teleTime', '', '0.1')));
  }

  _sprinklerSection(obj) {
    const { num, sel } = this._controls(obj);
    return this._section('sprinkler', 'sec.sprinkler',
      el('div', { class: 'row gap' },
        num('SprinklerWidth', 'prop.sprinkWidth', '8', '1'),
        num('SprinklerSteps', 'prop.sprinkSteps', '', '1')),
      sel('FluidType', 'prop.outputFluid',
        [['Water', 'spout.f.water'], ['ContaminatedWater', 'spout.f.poison'], ['Lava', 'spout.f.ooze']], 'Water'),
      el('div', { class: 'row gap' },
        num('ParticlesPerSecond', 'spout.flow', '60', '1'),
        num('NumberParticles', 'spout.limit', '-1', '1')));
  }

  _motorSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('motor', 'sec.motor',
      chk('MotorOn', 'prop.motorOn'),
      el('div', { class: 'row gap' },
        num('MotorMoveSpeed', 'prop.moveSpeed', '1', '0.5'),
        num('MotorWaitTime', 'prop.waitTime', '0', '0.1')),
      chk('MotorPingPong', 'prop.pingPong'),
      num('MotorTurnSpeed', 'prop.turnSpeed', '', '1'));
  }

  /** Physics quick controls, only for properties the object actually has. */
  _genericPhysicsSection(obj) {
    const { num, chk } = this._controls(obj);
    const rows = [];
    if (obj.properties.GravityScale !== undefined) rows.push(num('GravityScale', 'prop.gravity', '', '0.1'));
    if (obj.properties.Draggable !== undefined) rows.push(chk('Draggable', 'prop.draggable'));
    if (obj.properties.Interactive !== undefined) rows.push(chk('Interactive', 'prop.interactive'));
    if (obj.properties.VelDamping !== undefined) rows.push(num('VelDamping', 'prop.damping', '', '0.01'));
    if (!rows.length) return null;
    return this._section('generic', 'sec.physics', ...rows);
  }

  /** One connection slot: current target, pick in level, disconnect. */
  _connPicker(obj, propName, label) {
    const val = obj.properties[propName] || '';
    return el('div', { class: 'conn-row' },
      el('span', { class: 'conn-label', text: label }),
      el('span', { class: 'conn-value' + (val ? '' : ' none'), title: val || propName, text: val || t('conn.none') }),
      el('button', { class: 'btn small', text: t('conn.pick'), onclick: () => this.cb.onPickConnection?.(obj, propName) }),
      val
        ? el('button', {
            class: 'icon-btn', title: t('conn.clear'), html: '&times;',
            onclick: () => { this.cb.push(); delete obj.properties[propName]; this.cb.onEdit(); this.render(); },
          })
        : null);
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
        // aliases (compression era color variants) count as exact matches
        const exact = !!materialForColor(r, g, b);
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
