// Side panels: level browser (left), object browser (left tab), and the
// properties inspector (right).
import { categorize } from '../core/objects.js';
import { GRID_TO_PX, degToRad, groupColor } from '../core/coords.js';
import { MATERIALS, nearestMaterial, materialForColor } from '../data/materials.js';
import { CONDITIONS, FLUID_VALUES, DESC_KEYS, buildRequirements, conditionFor } from '../core/challenge.js';

/** Every fluid the game ships levels with (found by scanning all 636 levels). */
const FLUIDS = [
  ['Water', 'spout.f.water'],
  ['ContaminatedWater', 'spout.f.poison'],
  ['Lava', 'spout.f.ooze'],
  ['Steam', 'spout.f.steam'],
  ['Mud', 'spout.f.mud'],
  ['wetmud', 'spout.f.wetmud'],
  ['drymud', 'spout.f.drymud'],
];

// generators are powered by one of these fluids (AllowedFluids in the .hs)
const GEN_FLUIDS = [
  ['water', 'spout.f.water'],
  ['steam', 'spout.f.steam'],
  ['blackooze', 'gen.f.ooze'],
];

// temperature rays: TemperatureType drives what they do to the fluid they hit
const RAY_TYPES = [
  ['hot', 'ray.t.hot'],
  ['cold', 'ray.t.cold'],
  ['sludge', 'ray.t.sludge'],
  ['matter', 'ray.t.matter'],
  ['turf', 'ray.t.turf'],
];

// collectibles (ducks/stars): GnomeType is the Perry mod field; the real WMW
// game uses StarType (baby/allie/mega ducks, music note, teleporter).
const GNOME_TYPES = [
  ['water', 'gnome.water'],
  ['steam', 'gnome.steam'],
  ['sludge', 'gnome.sludge'],
];
const STAR_TYPES = [
  ['baby', 'star.baby'],
  ['allie', 'star.allie'],
  ['mega', 'star.mega'],
  ['note', 'star.note'],
  ['teleport', 'star.teleport'],
];

// properties that are really yes/no, so the raw editor shows a toggle not a box
const PROP_BOOL = new Set([
  'Draggable', 'Interactive', 'MotorOn', 'MotorPingPong', 'MotorEase', 'VacuumOn',
  'HasString', 'FingerPoppable', 'PathIsClosed', 'PathIsGlobal', 'ShowTopEdge',
  'HeavyIntro', 'IgnoreInEditorObjectSelect', 'IgnoreMixing',
]);

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
    this.customWorlds = [];
    this.activeName = null;
    this.filter = '';
    this.openPacks = new Set(['pack0']); // first world open by default
  }

  /** Custom worlds (from the world builder) shown under their character. */
  setCustomWorlds(worlds) {
    this.customWorlds = worlds || [];
    if (this.levels.length) this.setLevels(this.levels);
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
    // splice custom worlds in right after the last pack of their character
    const STORYLINE_CHAR = { 0: 'Swampy', 1: 'Cranky', 3: 'Mystery Duck', 6: 'Allie' };
    for (const w of this.customWorlds) {
      const character = STORYLINE_CHAR[w.storyline ?? 0] || 'Swampy';
      const entries = [];
      for (const lv of (w.levels || [])) {
        const base = String(lv.filename || '').split('/').pop().toLowerCase();
        const entry = this.byName.get(base);
        if (entry) entries.push({ entry, title: entry.name });
      }
      if (!entries.length) continue;
      const pack = { title: w.displayName, character, entries, custom: true };
      let idx = -1;
      for (let i = 0; i < this.packs.length; i++) if (this.packs[i].character === character) idx = i;
      if (idx >= 0) this.packs.splice(idx + 1, 0, pack); else this.packs.push(pack);
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
    const prevScroll = this.container.querySelector('.scroll')?.scrollTop;
    const search = searchBox(t('search.levels', { n: this.levels.length }), this.filter,
      (e) => { this.filter = e.target.value; this.render(); });
    const restoreFocus = () => {
      if (!hadFocus) return;
      const input = search.querySelector('input');
      input.focus();
      input.setSelectionRange(caret, caret);
    };
    const restoreScroll = () => {
      const scroller = this.container.querySelector('.scroll');
      if (scroller && prevScroll) scroller.scrollTop = prevScroll;
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
      restoreScroll();
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
        el('summary', {}, el('span', { text: pack.title }),
          pack.custom ? el('span', { class: 'tag', text: t('world.tag') }) : null,
          el('span', { class: 'count', text: pack.entries.length })),
        el('div', { class: 'list' }, ...pack.entries.map((item, n) => this._row(item, n + 1)))
      );
      sections.push(details);
    });

    this.container.replaceChildren(search, el('div', { class: 'scroll obj-groups' }, ...sections));
    restoreFocus();
    restoreScroll();
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

  /** Composite thumbnail: draws every sprite of the object, scaled to fit,
   *  the same way the canvas renders it (so multi part objects are complete). */
  async _thumb(gamePath, img) {
    if (this.thumbCache.has(gamePath)) {
      img.src = this.thumbCache.get(gamePath);
      return;
    }
    try {
      const vis = await this.resolver.resolveVisual(gamePath);
      const all = vis.sprites.filter((s) => s.bitmap && s.rect);
      // prefer foreground parts so the actual object fills the thumbnail; only
      // fall back to background sprites when that is all the object has
      const fg = all.filter((s) => !s.isBackground);
      const drawable = fg.length ? fg : all;
      if (!drawable.length) return;
      const size = 40;
      const c = document.createElement('canvas');
      c.width = size; c.height = size;
      const ctx = c.getContext('2d');
      // tight bbox over the actual sprite rectangles (bboxPx is rotation padded)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const s of drawable) {
        const cx = s.pos[0] * GRID_TO_PX, cy = -s.pos[1] * GRID_TO_PX;
        const r = Math.hypot(s.wPx, s.hPx) / 2;
        minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
        minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
      }
      const scale = (size - 2) / Math.max(maxX - minX, maxY - minY, 1);
      ctx.translate(size / 2 - ((minX + maxX) / 2) * scale, size / 2 - ((minY + maxY) / 2) * scale);
      for (const s of drawable) {
        ctx.save();
        ctx.translate(s.pos[0] * GRID_TO_PX * scale, -s.pos[1] * GRID_TO_PX * scale);
        ctx.rotate(-degToRad(s.angle));
        ctx.scale(s.flipX ? -1 : 1, s.flipY ? -1 : 1);
        const dw = s.wPx * scale, dh = s.hPx * scale;
        ctx.drawImage(s.bitmap, s.rect.x, s.rect.y, s.rect.w, s.rect.h, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
      }
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
        if (group.length < 10) { out.push(...group.map(card)); continue; }
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
  vacuum: '#06b6d4',
  balloon: '#19c8a8',
  switch: '#ffb454',
  converter: '#a78bfa',
  ypipe: '#5eead4',
  brokenpipe: '#d97706',
  teleport: '#60a5fa',
  sprinkler: '#38bdf8',
  motor: '#94a6bb',
  collectible: '#fbbf24',
  ray: '#fb7185',
  generator: '#a3e635',
  pipe: '#a8a29e',
  mirror: '#67e8f9',
  generic: '#5c6f85',
};

const KIND_SECTION_KEY = {
  bomb: 'sec.bomb', fan: 'sec.fan', vacuum: 'sec.vacuum', balloon: 'sec.balloon', switch: 'sec.switch',
  converter: 'sec.converter', ypipe: 'sec.ypipe', brokenpipe: 'sec.brokenpipe',
  teleport: 'sec.teleport', sprinkler: 'sec.sprinkler', motor: 'sec.motor',
  ray: 'sec.ray', collectible: 'sec.collectible', generator: 'sec.generator',
  pipe: 'sec.pipe', mirror: 'sec.mirror',
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
    if (/vacuum/.test(fn)) return 'vacuum';
    if (/fan/.test(fn)) return 'fan';
    if (type === 'temperatureray' || p.TemperatureType !== undefined || p.RayAngle !== undefined) return 'ray';
    if (type === 'generator' || p.GeneratorSprites !== undefined) return 'generator';
    if (/balloon|bubble/.test(fn)) return 'balloon';
    if (/y[_-]?switch|pipe_y/.test(fn) || p.YSwitchPosition !== undefined) return 'ypipe';
    if (/switch|lever/.test(fn) || p.SwitchType !== undefined) return 'switch';
    if (type === 'fluidconverter' || /converter/.test(fn)) return 'converter';
    if (/broken/.test(fn)) return 'brokenpipe';
    if (/teleport|portal/.test(fn)) return 'teleport';
    if (/sprinkler/.test(fn) || p.SprinklerWidth !== undefined) return 'sprinkler';
    if (type === 'spout' || /spout|drain|faucet|shower|valve/.test(fn) || p.SpoutType !== undefined) return 'spout';
    if (type === 'star' || type === 'collectible' || p.StarType !== undefined || p.GnomeType !== undefined || /star|duck|note|collect|gnome/.test(fn)) return 'collectible';
    // motors first: a pivoting mirror wall has motor props and should stay a motor
    if (p.PathPos0 !== undefined || p.MotorMoveSpeed !== undefined || p.MotorOn !== undefined || p.MotorTurnSpeed !== undefined) return 'motor';
    if (type === 'mirror' || /mirror/.test(fn)) return 'mirror';
    if (type === 'pipe' || p.PipeType !== undefined || p.PipeWidth !== undefined) return 'pipe';
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
          el('h3', { text: t('insp.levelSettings') }),
          this._kvEditor(level.properties, () => this.cb.onEdit()),
          el('div', { class: 'sep' }),
          this._challengeSection(level),
          this._groupsOverview(level),
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
        this._pathSection(obj, kind)
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
      case 'vacuum': return this._vacuumSection(obj);
      case 'balloon': return this._balloonSection(obj);
      case 'switch': return this._switchSection(obj);
      case 'converter': return this._converterSection(obj);
      case 'ypipe': return this._ypipeSection(obj);
      case 'brokenpipe': return this._brokenpipeSection(obj);
      case 'teleport': return this._teleportSection(obj);
      case 'sprinkler': return this._sprinklerSection(obj);
      case 'motor': return this._motorSection(obj);
      case 'ray': return this._raySection(obj);
      case 'generator': return this._generatorSection(obj);
      case 'collectible': return this._collectibleSection(obj);
      case 'pipe': return this._pipeSection(obj);
      case 'mirror': return this._mirrorSection(obj);
      default: return this._genericPhysicsSection(obj);
    }
  }

  /** Shared small controls. Every write goes through set(): push undo,
   *  stringify, delete when emptied, notify. */
  _controls(obj) {
    // unset checkboxes reflect the object's .hs default, so the UI tells the
    // truth even when a level never re authored the property
    const defaults = this.cb.getDefaults?.(obj) || {};
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
      const v = obj.properties[key] ?? defaults[key];
      c.checked = v === '1' || v === 'true';
      c.onchange = () => set(key, c.checked ? '1' : '0');
      return el('label', { class: 'check-row' }, c, el('span', { text: t(labelKey) }));
    };
    const sel = (key, labelKey, options, dflt = '', labelParams = {}) => {
      // the game treats these values case insensitively (levels ship 'lava', 'Lava', …)
      const cur = String(obj.properties[key] ?? dflt).toLowerCase();
      const s = el('select', {}, ...options.map(([v, lk]) =>
        el('option', { value: v, text: t(lk), selected: cur === v.toLowerCase() ? '' : null })));
      s.onchange = () => set(key, s.value);
      return el('div', { class: 'field' }, el('label', { text: t(labelKey, labelParams) }), s);
    };
    // Draggable alone does nothing in game: the engine only reacts to touch
    // when Interactive is on too (and e.g. bomb.hs does not author it)
    const dragChk = () => {
      const c = el('input', { type: 'checkbox' });
      c.checked = obj.properties.Draggable === '1' || obj.properties.Draggable === 'true';
      c.onchange = () => {
        this.cb.push();
        obj.properties.Draggable = c.checked ? '1' : '0';
        if (c.checked && obj.properties.Interactive === undefined) obj.properties.Interactive = '1';
        this.cb.onEdit();
      };
      return el('div', { class: 'field' },
        el('label', { class: 'check-row' }, c, el('span', { text: t('prop.draggable') })),
        el('span', { class: 'muted small', text: t('prop.dragHint') }));
    };
    return { set, num, chk, sel, dragChk };
  }

  _section(kind, titleKey, ...children) {
    const color = KIND_COLORS[kind] || KIND_COLORS.generic;
    return el('div', { class: 'smart-box', style: `border-left-color:${color}` },
      el('h4', { style: `color:${color}`, text: t(titleKey) }),
      ...children.filter(Boolean));
  }

  _bombSection(obj) {
    const { num, dragChk } = this._controls(obj);
    return this._section('bomb', 'sec.bomb',
      el('div', { class: 'row gap' },
        num('BlastRadius', 'prop.blastRadius', '5', '0.5'),
        num('BlastPower', 'prop.blastPower', '4000', '100')),
      num('GravityScale', 'prop.gravity', '0', '0.1'),
      dragChk());
  }

  _fanSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('fan', 'sec.fan',
      this._controlledByBlock(obj),
      chk('VacuumOn', 'prop.fanOn'),
      el('div', { class: 'row gap' },
        num('VacuumMaxForce', 'prop.fanStrength', '100', '10'),
        num('VacuumMaxD', 'prop.fanRange', '', '1')),
      el('div', { class: 'row gap' },
        num('VacuumMinAngle', 'prop.fanAngleMin', '', '5'),
        num('VacuumMaxAngle', 'prop.fanAngleMax', '', '5')),
      num('VacuumFriction', 'prop.vacuumFriction', '', '0.05'));
  }

  _vacuumSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('vacuum', 'sec.vacuum',
      this._controlledByBlock(obj),
      chk('VacuumOn', 'prop.vacuumOn'),
      el('div', { class: 'row gap' },
        num('VacuumMaxForce', 'prop.vacuumStrength', '100', '10'),
        num('VacuumMaxD', 'prop.vacuumRange', '', '1')),
      el('div', { class: 'row gap' },
        num('VacuumMinAngle', 'prop.vacuumAngleMin', '', '5'),
        num('VacuumMaxAngle', 'prop.vacuumAngleMax', '', '5')),
      num('VacuumFriction', 'prop.vacuumFriction', '', '0.05'),
      // where the sucked up fluid comes back out — connect it to a spout
      this._outputSpoutBlock(obj));
  }

  /** Connection block: the spout(s) a drain or vacuum pushes its fluid out of. */
  _outputSpoutBlock(obj) {
    const slots = this._connSlots(obj, 'ConnectedSpout');
    return el('div', { class: 'field' },
      el('label', { text: t('conn.outTitle') }),
      ...slots.map((i) => this._connPicker(obj, 'ConnectedSpout' + i, t('conn.output', { n: i }))),
      el('button', {
        class: 'btn small', text: '+ ' + t('conn.add'),
        onclick: () => this.cb.onPickConnection?.(obj, 'ConnectedSpout' + slots.length),
      }));
  }

  _balloonSection(obj) {
    const { num, chk, dragChk } = this._controls(obj);
    const defaults = this.cb.getDefaults?.(obj) || {};
    // InitialParticles is "<fluid> <count>" in the game ("water 70", "Steam 50", …)
    const init = String(obj.properties.InitialParticles || defaults.InitialParticles || 'water 10').trim().split(/\s+/);
    const curFluid = (init[0] || 'water').toLowerCase();
    const curCount = init[1] || '10';
    const write = () => {
      this.cb.push();
      obj.properties.InitialParticles = fluidSel.value.toLowerCase() + ' ' + (parseInt(countInp.value, 10) || 0);
      this.cb.onEdit();
    };
    const fluidSel = el('select', {}, ...FLUIDS.map(([v, lk]) =>
      el('option', { value: v, text: t(lk), selected: curFluid === v.toLowerCase() ? '' : null })));
    const countInp = el('input', { type: 'number', step: '5', min: '0', value: curCount });
    fluidSel.onchange = write;
    countInp.onchange = write;
    // HasString / FingerPoppable are Perry mod fields; only show them when the
    // balloon actually carries one, so WMW balloons do not get dead toggles
    const hasPerryFlags = ['HasString', 'FingerPoppable'].some((k) =>
      obj.properties[k] !== undefined || defaults[k] !== undefined);
    return this._section('balloon', 'sec.balloon',
      el('div', { class: 'row gap' },
        el('div', { class: 'field grow' }, el('label', { text: t('prop.initialFluid') }), fluidSel),
        el('div', { class: 'field grow' }, el('label', { text: t('prop.initialCount') }), countInp)),
      num('MaxParticles', 'prop.maxParticles', '70', '5'),
      this._connPicker(obj, 'ConnectedSpout', t('conn.balloon')),
      num('GravityScale', 'prop.buoyancy', '', '0.1'),
      num('VelDamping', 'prop.damping', '', '0.01'),
      hasPerryFlags ? chk('HasString', 'prop.hasString') : null,
      hasPerryFlags ? chk('FingerPoppable', 'prop.poppable') : null,
      dragChk());
  }

  _connSlots(obj, prefix) {
    const out = [];
    for (let i = 0; obj.properties[prefix + i] !== undefined; i++) out.push(i);
    return out;
  }

  _switchSection(obj) {
    // The switch type (flip vs momentary) is decided by which switch object was
    // placed, never by the level, so it is shown read only instead of editable.
    const defaults = this.cb.getDefaults?.(obj) || {};
    const momentary = String(obj.properties.SwitchType || defaults.SwitchType || 'flip').toLowerCase() === 'momentary';
    return this._section('switch', 'sec.switch',
      el('p', { class: 'muted small', text: t(momentary ? 'prop.switchMomentary' : 'prop.switchFlip') }),
      this._groupMembersBlock(obj));
  }

  /** Re-pack ConnectedObject0..N so there are no gaps after a removal. */
  _compactConn(obj) {
    const vals = Object.keys(obj.properties)
      .filter((k) => /^ConnectedObject\d+$/.test(k))
      .sort((a, b) => parseInt(a.slice(15), 10) - parseInt(b.slice(15), 10))
      .map((k) => obj.properties[k]);
    Object.keys(obj.properties).forEach((k) => { if (/^ConnectedObject\d+$/.test(k)) delete obj.properties[k]; });
    vals.forEach((v, i) => { obj.properties['ConnectedObject' + i] = v; });
  }

  /** The colored "group" a switch or generator drives: when triggered, every
   *  object below turns on together. Members are the ConnectedObjectN targets. */
  _groupMembersBlock(obj) {
    const color = groupColor(obj.name);
    const slots = this._connSlots(obj, 'ConnectedObject');
    return el('div', { class: 'group-box', style: `border-color:${color}` },
      el('div', { class: 'group-head' },
        el('span', { class: 'group-chip', style: `background:${color}` }),
        el('span', { class: 'group-title', style: `color:${color}`, text: t('group.title') })),
      el('p', { class: 'muted small', text: t('group.explain') }),
      ...slots.map((i) => {
        const target = obj.properties['ConnectedObject' + i] || '';
        return el('div', { class: 'conn-row' },
          el('span', { class: 'conn-value' + (target ? '' : ' none'), title: target, text: target || t('conn.none') }),
          el('button', {
            class: 'icon-btn', title: t('conn.clear'), html: '&times;',
            onclick: () => { this.cb.push(); delete obj.properties['ConnectedObject' + i]; this._compactConn(obj); this.cb.onEdit(); this.render(); },
          }));
      }),
      el('button', {
        class: 'btn small', text: '+ ' + t('group.addMember'),
        onclick: () => this.cb.onPickConnection?.(obj, 'ConnectedObject' + slots.length),
      }));
  }

  /** Reverse view for a controllable object: which switch group(s) drive it,
   *  shown at the top so it reads like "this fan belongs to group X". */
  _controlledByBlock(obj) {
    const level = this.cb.getLevel();
    if (!level || !obj.name) return null;
    const controllers = [];
    for (const o of level.objects) {
      if (o === obj) continue;
      for (const [k, v] of Object.entries(o.properties)) {
        if (k.startsWith('ConnectedObject') && v === obj.name) { controllers.push({ o, key: k }); break; }
      }
    }
    return el('div', { class: 'group-box ctrl' },
      el('div', { class: 'group-head' },
        el('span', { class: 'group-title', text: t('group.controlledBy') })),
      controllers.length
        ? el('div', {}, ...controllers.map(({ o, key }) => {
            const color = groupColor(o.name);
            return el('div', { class: 'conn-row' },
              el('span', { class: 'group-chip sm', style: `background:${color}` }),
              el('span', { class: 'conn-value', title: o.name, text: o.name }),
              el('button', {
                class: 'icon-btn', title: t('conn.clear'), html: '&times;',
                onclick: () => { this.cb.push(); delete o.properties[key]; this.cb.onEdit(); this.render(); },
              }));
          }))
        : el('p', { class: 'muted small', text: t('group.notControlled') }),
      el('button', {
        class: 'btn small', text: t('group.controlWith'),
        onclick: () => this.cb.onPickController?.(obj),
      }));
  }

  /** Custom challenge builder for the level. Conditions map 1:1 to the real
   *  game tokens; "Write to game" upserts them into water.db via the callbacks. */
  _challengeSection(level) {
    const ch = level.challenge || (level.challenge = { conditions: [], desc: '' });
    const namesByKind = (kinds) => level.objects
      .filter((o) => o.name && kinds.includes(this._objectKind(o)))
      .map((o) => o.name);
    const rerender = () => this.render();

    const valueControl = (item) => {
      const c = conditionFor(item.token);
      if (!c || c.kind === 'flag') return el('span', { class: 'muted small', text: t('ch.flagOn') });
      if (c.kind === 'int') {
        return el('input', { type: 'number', step: '1', value: item.value ?? c.dflt ?? '0',
          onchange: (e) => { item.value = e.target.value; rerender(); } });
      }
      const opts = c.kind === 'fluid' ? FLUID_VALUES : namesByKind(c.objKinds);
      const list = opts.length ? opts : [''];
      const cur = item.value ?? (c.kind === 'fluid' ? c.dflt : list[0]);
      const sel = el('select', {}, ...list.map((v) => el('option', { value: v, text: v || t('ch.noObj'), selected: v === cur ? '' : null })));
      sel.onchange = () => { item.value = sel.value; rerender(); };
      return sel;
    };

    const condRow = (item, idx) => {
      const typeSel = el('select', {}, ...CONDITIONS.map((cc) =>
        el('option', { value: cc.token, text: cc.label, selected: cc.token === item.token ? '' : null })));
      typeSel.onchange = () => {
        const nc = conditionFor(typeSel.value);
        item.token = typeSel.value;
        item.value = nc.kind === 'flag' ? undefined
          : (nc.kind === 'object' ? (namesByKind(nc.objKinds)[0] || '') : (nc.dflt || '0'));
        rerender();
      };
      return el('div', { class: 'conn-row' }, typeSel, valueControl(item),
        el('button', { class: 'icon-btn', html: '&times;', title: t('conn.clear'),
          onclick: () => { ch.conditions.splice(idx, 1); rerender(); } }));
    };

    const reqStr = buildRequirements(ch.conditions);
    const descSel = el('select', {}, ...DESC_KEYS.map((k) =>
      el('option', { value: k, text: k, selected: k === ch.desc ? '' : null })));
    descSel.onchange = () => { ch.desc = descSel.value; rerender(); };
    const reqOut = el('input', { value: reqStr, readonly: '', class: 'mono', title: reqStr });

    return el('details', { class: 'challenge-box', open: ch.conditions.length ? '' : null },
      el('summary', {}, el('span', { class: 'ch-title', text: t('ch.title') })),
      el('p', { class: 'muted small', text: t('ch.hint') }),
      ch.conditions.length
        ? el('div', {}, ...ch.conditions.map((item, i) => condRow(item, i)))
        : el('p', { class: 'muted small', text: t('ch.none') }),
      el('button', { class: 'btn small', text: '+ ' + t('ch.addCond'),
        onclick: () => { ch.conditions.push({ token: 'ducks', value: '3' }); rerender(); } }),
      el('div', { class: 'field' }, el('label', { text: t('ch.desc') }), descSel),
      el('div', { class: 'field' }, el('label', { text: t('ch.requirements') }), reqOut),
      el('div', { class: 'row gap wrap' },
        el('button', { class: 'btn small primary', text: t('ch.write'),
          onclick: (e) => this.cb.onChallengeWrite?.(reqStr, ch.desc, e.target) }),
        el('button', { class: 'btn small', text: t('ch.load'),
          onclick: () => this.cb.onChallengeLoad?.() }),
        el('button', { class: 'btn small danger', text: t('ch.clear'),
          onclick: () => { ch.conditions = []; rerender(); } })),
      el('p', { class: 'muted small', text: t('ch.caveat') }),
      el('div', { class: 'sep' }));
  }

  /** A friendly menu of every switch/generator group in the level. Each row is
   *  color matched to the canvas arrows; clicking opens that controller. */
  _groupsOverview(level) {
    const isMember = (o, k) => /^ConnectedObject\d+$/.test(k) && o.properties[k];
    const controllers = level.objects.filter((o) => Object.keys(o.properties).some((k) => isMember(o, k)));
    if (!controllers.length) return null;
    return el('div', { class: 'groups-overview' },
      el('h3', { text: t('group.overview') }),
      el('p', { class: 'muted small', text: t('group.overviewHint') }),
      ...controllers.map((o) => {
        const color = groupColor(o.name);
        const n = Object.keys(o.properties).filter((k) => isMember(o, k)).length;
        return el('button', {
          class: 'group-row', style: `border-left-color:${color}`,
          onclick: () => this.cb.onSelect?.(o),
        },
          el('span', { class: 'group-chip', style: `background:${color}` }),
          el('span', { class: 'group-row-name', title: o.name, text: o.name }),
          el('span', { class: 'muted small', text: t('group.members', { n }) }));
      }),
      el('div', { class: 'sep' }));
  }

  _converterSection(obj) {
    const { sel } = this._controls(obj);
    const defaults = this.cb.getDefaults?.(obj) || {};
    const isDynamic = (obj.properties.ConverterType || defaults.ConverterType || '').toLowerCase() === 'dynamic'
      || obj.properties.FluidType0 !== undefined || defaults.FluidType0 !== undefined;

    if (isDynamic) {
      return this._section('converter', 'sec.converter',
        el('p', { class: 'muted small', text: t('conv.dynamicHint') }),
        ...[0, 1, 2, 3, 4, 5].map((i) => sel('FluidType' + i, 'conv.fluidSlot', FLUIDS, defaults['FluidType' + i] || 'Water', { n: i })));
    }
    return this._section('converter', 'sec.converter',
      el('p', { class: 'muted small', text: t('conv.staticHint') }),
      sel('FluidType', 'prop.outputFluid', FLUIDS, defaults.FluidType || 'Water'));
  }

  _ypipeSection(obj) {
    const { sel } = this._controls(obj);
    return this._section('ypipe', 'sec.ypipe',
      sel('YSwitchPosition', 'prop.switchType', [['left', 'left'], ['right', 'right']], 'left'),
      this._connPicker(obj, 'ConnectedYSwitchPort0', t('conn.switch')),
      this._connPicker(obj, 'ConnectedConverter', t('conn.converter')),
      el('p', { class: 'muted small', text: t('conv.ypipeHint') }));
  }

  _brokenpipeSection(obj) {
    const { num, dragChk } = this._controls(obj);
    return this._section('brokenpipe', 'sec.brokenpipe',
      dragChk(),
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
      sel('FluidType', 'prop.outputFluid', FLUIDS, 'Water'),
      el('div', { class: 'row gap' },
        num('ParticlesPerSecond', 'spout.flow', '60', '1'),
        num('NumberParticles', 'spout.limit', '-1', '1')));
  }

  _motorSection(obj) {
    const { num, chk } = this._controls(obj);
    return this._section('motor', 'sec.motor',
      this._controlledByBlock(obj),
      chk('MotorOn', 'prop.motorOn'),
      el('div', { class: 'row gap' },
        num('MotorMoveSpeed', 'prop.moveSpeed', '1', '0.5'),
        num('MotorWaitTime', 'prop.waitTime', '0', '0.1')),
      el('div', { class: 'row gap' },
        num('MotorTurnSpeed', 'prop.turnSpeed', '', '5'),
        num('MotorWaitTurn', 'prop.waitTurn', '', '5')),
      chk('MotorPingPong', 'prop.pingPong'),
      chk('MotorEase', 'prop.motorEase'),
      el('p', { class: 'muted small', text: t('motor.hint') }));
  }

  /** Temperature ray: heats, freezes or contaminates the fluid it hits. */
  _raySection(obj) {
    const { num, sel } = this._controls(obj);
    const defaults = this.cb.getDefaults?.(obj) || {};
    return this._section('ray', 'sec.ray',
      sel('TemperatureType', 'prop.rayType', RAY_TYPES, defaults.TemperatureType || 'hot'),
      sel('RayBeamType', 'prop.rayBeam', [['', 'ray.b.cont'], ['touch', 'ray.b.touch']], defaults.RayBeamType || ''),
      num('RayAngle', 'prop.rayAngle', '0', '5'),
      el('p', { class: 'muted small', text: t('ray.hint') }));
  }

  /** Generator: powered while a fluid runs over it, drives connected objects. */
  _generatorSection(obj) {
    const { sel } = this._controls(obj);
    const defaults = this.cb.getDefaults?.(obj) || {};
    return this._section('generator', 'sec.generator',
      sel('AllowedFluids', 'prop.genFluid', GEN_FLUIDS, defaults.AllowedFluids || 'water'),
      this._groupMembersBlock(obj),
      el('p', { class: 'muted small', text: t('gen.hint') }));
  }

  /** Collectible (duck/star): the fluid type that can pick it up. */
  _collectibleSection(obj) {
    const { num, sel } = this._controls(obj);
    const defaults = this.cb.getDefaults?.(obj) || {};
    const rows = [
      sel('StarType', 'prop.starType', STAR_TYPES, defaults.StarType || 'baby'),
      num('CutRadius', 'prop.cutRadius', '6', '0.5'),
    ];
    // the Perry mod variant keys ducks by GnomeType instead; show it when present
    if (obj.properties.GnomeType !== undefined || defaults.GnomeType !== undefined) {
      rows.push(sel('GnomeType', 'prop.gnomeType', GNOME_TYPES, defaults.GnomeType || 'water'));
    }
    rows.push(el('p', { class: 'muted small', text: t('coll.hint') }));
    return this._section('collectible', 'sec.collectible', ...rows);
  }

  /** Pipe: visual routing guide. Width plus a note about how flow really works. */
  _pipeSection(obj) {
    const { num } = this._controls(obj);
    return this._section('pipe', 'sec.pipe',
      num('PipeWidth', 'prop.pipeWidth', '1.4', '0.1'),
      el('p', { class: 'muted small', text: t('pipe.hint') }));
  }

  /** Mirror: rotate to bounce a temperature ray toward its target. */
  _mirrorSection(obj) {
    return this._section('mirror', 'sec.mirror',
      el('p', { class: 'muted small', text: t('mirror.hint') }));
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

    // If a drain or vacuum feeds this spout (its ConnectedSpoutN points here), the
    // spout only re-emits what that source swallows, so its own behavior/fluid/flow
    // do nothing. Show the link instead of the misleading "Always running" controls.
    const lvl = this.cb.getLevel();
    const feeder = (lvl && obj.name) ? lvl.objects.find((o) => o !== obj &&
      Object.entries(o.properties).some(([k, v]) => k.startsWith('ConnectedSpout') && v === obj.name)) : null;
    if (feeder) {
      return el('div', { class: 'spout-box' },
        el('h4', { text: t('spout.title') }),
        el('div', { class: 'conn-row' },
          el('span', { class: 'group-chip sm', style: `background:${groupColor(feeder.name)}` }),
          el('span', { class: 'conn-value', title: feeder.name, text: t('spout.fedBy', { name: feeder.name }) })),
        el('p', { class: 'muted small', text: t('spout.fedHint') }));
    }

    const set = (key, value) => {
      this.cb.push();
      if (value === '' || value == null) delete obj.properties[key];
      else obj.properties[key] = String(value);
      this.cb.onEdit();
      this.render();
    };

    // the game reads unset values from the object's .hs DefaultProperties
    // (e.g. basic_drain.hs ships SpoutType=DrainSpout, murky spouts ship
    // FluidType=ContaminatedWater) — mirror that so the UI tells the truth
    const defaults = this.cb.getDefaults?.(obj) || {};
    const effType = obj.properties.SpoutType || defaults.SpoutType || 'OpenSpout';
    const effFluid = String(obj.properties.FluidType || defaults.FluidType || 'Water').toLowerCase();

    const behavior = el('select', {},
      ...[['OpenSpout', t('spout.b.open')], ['TouchSpout', t('spout.b.touch')],
          ['Drain', t('spout.b.drain')], ['DrainSpout', t('spout.b.drainspout')]]
        .map(([v, label]) => el('option', { value: v, text: label, selected: effType === v ? '' : null })));
    behavior.onchange = () => set('SpoutType', behavior.value);

    const fluid = el('select', {},
      ...FLUIDS.map(([v, lk]) => el('option', { value: v, text: t(lk), selected: effFluid === v.toLowerCase() ? '' : null })));
    fluid.onchange = () => set('FluidType', fluid.value);

    const pps = el('input', { type: 'number', step: '1', min: '0', value: obj.properties.ParticlesPerSecond || '',
      placeholder: defaults.ParticlesPerSecond || '60', onchange: () => set('ParticlesPerSecond', pps.value) });
    const limit = el('input', { type: 'number', step: '1', value: obj.properties.NumberParticles || '',
      placeholder: defaults.NumberParticles || '-1', onchange: () => set('NumberParticles', limit.value) });
    const speed = el('input', { type: 'number', step: '1', min: '0', value: obj.properties.ParticleSpeed || '',
      placeholder: defaults.ParticleSpeed || '30', onchange: () => set('ParticleSpeed', speed.value) });

    // aim and spread of the stream, relative to the object's own rotation
    const aim = el('input', { type: 'number', step: '5', value: obj.properties.ExpulsionAngle ?? '',
      placeholder: defaults.ExpulsionAngle ?? '0', onchange: () => set('ExpulsionAngle', aim.value) });
    const spread = el('input', { type: 'number', step: '5', min: '0', value: obj.properties.ExpulsionAngleVariation ?? '',
      placeholder: defaults.ExpulsionAngleVariation ?? '0', onchange: () => set('ExpulsionAngleVariation', spread.value) });

    // drains push what they swallow out of their connected spouts
    const isDrain = effType === 'Drain' || effType === 'DrainSpout';
    // a pure Drain only swallows, so aim/spread make no sense there
    const canExpel = effType !== 'Drain';
    const slots = this._connSlots(obj, 'ConnectedSpout');
    const probInput = (i) => el('input', { type: 'number', step: '5', min: '0', max: '100',
      value: obj.properties['ConnectedSpoutProbability' + i] || '', placeholder: '100',
      onchange: (e) => set('ConnectedSpoutProbability' + i, e.target.value) });
    const drainBlock = isDrain
      ? el('div', { class: 'field' },
          el('label', { text: t('conn.title') }),
          ...slots.flatMap((i) => [
            this._connPicker(obj, 'ConnectedSpout' + i, t('conn.output', { n: i })),
            el('div', { class: 'row gap', style: 'align-items:center; margin-bottom:6px' },
              el('span', { class: 'conn-label', text: t('prop.probability') }), probInput(i)),
          ]),
          el('button', {
            class: 'btn small', text: '+ ' + t('conn.add'),
            onclick: () => this.cb.onPickConnection?.(obj, 'ConnectedSpout' + slots.length),
          }))
      : null;

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
        el('div', { class: 'field grow' }, el('label', { text: t('prop.particleSpeed') }), speed),
        el('div', { class: 'field grow' }, el('label', { text: t('spout.limit') }), limit)),
      canExpel
        ? el('div', { class: 'row gap' },
            el('div', { class: 'field grow' }, el('label', { text: t('prop.expulsionAngle') }), aim),
            el('div', { class: 'field grow' }, el('label', { text: t('prop.expulsionSpread') }), spread))
        : null,
      drainBlock,
      el('label', { class: 'check-row' }, timerChk, el('span', { text: t('spout.timer') })),
      hasTimer
        ? el('div', { class: 'row gap' },
            el('div', { class: 'field grow' }, el('label', { text: t('spout.on') }), onTime),
            el('div', { class: 'field grow' }, el('label', { text: t('spout.off') }), offTime))
        : null,
      el('div', { class: 'sep' }),
      this._connPicker(obj, 'ConnectedConverter', t('conn.converter')),
      el('p', { class: 'muted small', text: t('conv.spoutHint') }),
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

  /** Pick a sensible control for a raw property: yes/no for booleans, a dropdown
   *  for known fluids and enums, a plain box otherwise. */
  _smartInput(key, record, onEdit) {
    const set = (v) => { this.cb.push(); record[key] = v; onEdit(); };
    const cur = String(record[key] ?? '');
    const dropdown = (opts, ci = false) => {
      const c = ci ? cur.toLowerCase() : cur;
      const s = el('select', {}, ...opts.map(([v, label]) =>
        el('option', { value: v, text: label, selected: (ci ? v.toLowerCase() : v) === c ? '' : null })));
      s.onchange = () => set(s.value);
      return s;
    };
    if (PROP_BOOL.has(key)) {
      const on = cur === '1' || cur.toLowerCase() === 'true';
      const s = el('select', {},
        el('option', { value: '1', text: t('opt.yes'), selected: on ? '' : null }),
        el('option', { value: '0', text: t('opt.no'), selected: on ? null : '' }));
      s.onchange = () => set(s.value);
      return s;
    }
    if (key === 'FluidType' || /^FluidType\d+$/.test(key)) return dropdown(FLUIDS.map(([v, lk]) => [v, t(lk)]), true);
    if (key === 'SpoutType') return dropdown([['OpenSpout', t('spout.b.open')], ['TouchSpout', t('spout.b.touch')], ['Drain', t('spout.b.drain')], ['DrainSpout', t('spout.b.drainspout')]]);
    if (key === 'GnomeType') return dropdown(GNOME_TYPES.map(([v, lk]) => [v, t(lk)]), true);
    if (key === 'TemperatureType') return dropdown(RAY_TYPES.map(([v, lk]) => [v, t(lk)]), true);
    const inp = el('input', { value: record[key], onchange: (e) => set(e.target.value) });
    return inp;
  }

  _kvEditor(record, onEdit, obj = null) {
    const wrap = el('div', { class: 'kv' });
    const rerender = () => { this.render(); };
    for (const key of Object.keys(record)) {
      const valInput = this._smartInput(key, record, onEdit);
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

  _pathSection(obj, kind) {
    const pts = obj.getPath();
    // spouts and drains crash the game when given a motor path: the engine has
    // no path follower for that object class. Block adding new waypoints, but
    // still allow removing one to fix levels that already have this problem.
    const blocked = kind === 'spout';
    const wrap = el('div', {});
    wrap.append(el('h4', { text: t('insp.motorPath') }));
    if (blocked && !pts.length) {
      wrap.append(el('p', { class: 'tag warn', text: t('insp.pathSpoutBlocked') }));
      return wrap;
    }
    if (pts.length) {
      wrap.append(el('p', { class: 'muted small', text: t('insp.pathDragHint') }));
      if (blocked) wrap.append(el('p', { class: 'tag warn', text: t('insp.pathSpoutWarn') }));
    }
    const addBtn = blocked ? null : el('button', {
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
          class: 'btn small', text: t('insp.removeLast'),
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
