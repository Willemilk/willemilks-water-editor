// Willemilks Water Editor — app bootstrap and glue.
import './styles.css';
import { loadFromZipFile, loadFromFolder, listLevels } from './core/vfs.js';
import { Level } from './core/level.js';
import { Terrain } from './core/terrain.js';
import { ObjectResolver } from './core/objects.js';
import { saveIntoVFS, downloadLevelZip, downloadAssetsZip, downloadBytes, levelToFiles } from './core/export.js';
import { Editor, TOOLS } from './ui/editor.js';
import { LevelBrowser, ObjectBrowser, Inspector, materialPalette, propertySuggestions, el } from './ui/panels.js';
import { startTutorial, shouldShowTutorial, toast } from './ui/tutorial.js';
import { DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT } from './data/materials.js';
import { rebuildApk } from './core/apk.js';
import { parseRequirements } from './core/challenge.js';
import { t, getPref, setPref, setLang, currentLang, LANGS } from './i18n.js';

const app = document.getElementById('app');

const APP_VERSION = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;

const state = {
  vfs: null,
  resolver: null,
  levels: [],
  level: null,
  editor: null,
  placing: null, // object waiting for a placement click
};

// ============================================================ welcome screen

function renderWelcome(error = '') {
  app.replaceChildren(
    el('div', { class: 'welcome' },
      el('div', { class: 'welcome-card', id: 'dropzone' },
        el('div', { class: 'logo' }, logoSvg(42), el('h1', { text: 'Willemilks Water Editor' })),
        el('p', { class: 'tagline', text: t('welcome.tagline') }),
        el('label', { class: 'drop-area', id: 'drop-label' },
          dropIcon(),
          el('p', { class: 'drop-title', text: t('welcome.dropTitle') }),
          el('p', { class: 'muted small', text: t('welcome.dropSub') })
        ),
        el('div', { class: 'welcome-actions', id: 'welcome-actions' },
          el('button', { class: 'btn primary', id: 'btn-choose-zip', text: t('welcome.chooseZip'), onclick: () => fileInput.click() }),
          el('button', { class: 'btn', text: t('welcome.chooseFolder'), onclick: () => folderInput.click() })
        ),
        error ? el('p', { class: 'error', text: error }) : null,
        el('div', { class: 'welcome-foot' },
          el('p', { class: 'muted small', text: t('welcome.tip') }),
          el('button', { class: 'btn ghost small', text: t('settings.title'), onclick: showSettings })
        ),
        el('p', { class: 'muted small credits', text: t('welcome.credits') }),
        el('span', { class: 'version-tag', text: 'v' + APP_VERSION })
      )
    )
  );

  const fileInput = el('input', { type: 'file', accept: '.zip,.apk,.xapk', style: 'display:none' });
  const folderInput = el('input', { type: 'file', webkitdirectory: '', style: 'display:none' });
  app.append(fileInput, folderInput);
  fileInput.addEventListener('change', () => fileInput.files[0] && ingestFromFile(fileInput.files[0]));
  folderInput.addEventListener('change', () => folderInput.files.length && ingest(() => loadFromFolder(folderInput.files, setBusy)));

  const dz = document.getElementById('dropzone');
  const label = document.getElementById('drop-label');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); label.classList.add('drag'); }));
  dz.addEventListener('dragleave', (e) => { if (!dz.contains(e.relatedTarget)) label.classList.remove('drag'); });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    label.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) ingestFromFile(f);
  });

  hydrateContinueButton();
}

function ingestFromFile(f) {
  ingest(() => loadFromZipFile(f, setBusy));
}

/** When the desktop app has cached game files, offer a one click resume. */
async function hydrateContinueButton() {
  if (!window.native?.cachedApkMeta) return;
  try {
    const meta = await window.native.cachedApkMeta();
    if (!meta) return;
    const actions = document.getElementById('welcome-actions');
    if (!actions) return;
    document.getElementById('btn-choose-zip')?.classList.remove('primary');
    actions.prepend(el('button', {
      class: 'btn primary', text: '▶ ' + t('welcome.continue'),
      title: t('welcome.cachedNote'), onclick: continueLastSession,
    }));
    const last = getPref('lastLevel');
    const parts = [meta.name, (meta.size / 1048576).toFixed(1) + ' MB'];
    if (last) parts.push(last);
    actions.after(el('p', { class: 'muted small continue-note', text: parts.join(' · ') }));
  } catch { /* cache unavailable */ }
}

async function continueLastSession() {
  if (!window.native?.readCachedApk) return toast(t('toast.noRecent'), 'err');
  try {
    setBusy('Loading cached game files…');
    const res = await window.native.readCachedApk();
    if (!res) { setBusy(null); return toast(t('toast.noRecent'), 'err'); }
    ingest(() => loadFromZipFile(new File([res.buffer], res.name), setBusy));
  } catch {
    setBusy(null);
    toast(t('toast.noRecent'), 'err');
  }
}

function logoSvg(size) {
  const span = el('span', { class: 'logo-drop' });
  span.innerHTML = `<svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
    <defs><linearGradient id="wd" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5ec2ff"/><stop offset="1" stop-color="#1f8fe0"/>
    </linearGradient></defs>
    <path d="M32 4 C32 4 12 28 12 41 a20 20 0 0 0 40 0 C52 28 32 4 32 4 Z" fill="url(#wd)" stroke="#0d3a5c" stroke-width="2.5"/>
    <circle cx="24.5" cy="40" r="4.4" fill="#fff"/><circle cx="39.5" cy="40" r="4.4" fill="#fff"/>
    <circle cx="25.5" cy="41" r="2.1" fill="#10222f"/><circle cx="38.5" cy="41" r="2.1" fill="#10222f"/>
    <path d="M26 50 q6 4.5 12 0" fill="none" stroke="#0d3a5c" stroke-width="2.4" stroke-linecap="round"/></svg>`;
  return span;
}

function dropIcon() {
  const span = el('span', { class: 'drop-glyph' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path d="M12 3v12m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  return span;
}

let busyEl = null;
function setBusy(msg) {
  if (!msg) { busyEl?.remove(); busyEl = null; return; }
  if (!busyEl) {
    busyEl = el('div', { class: 'busy' }, el('div', { class: 'spinner' }), el('span', { class: 'busy-msg' }));
    document.body.append(busyEl);
  }
  busyEl.querySelector('.busy-msg').textContent = msg;
}

async function ingest(loader) {
  try {
    setBusy('Loading game files…');
    state.vfs = await loader();
    state.resolver = new ObjectResolver(state.vfs);
    state.levels = listLevels(state.vfs);
    setBusy(null);
    renderEditor();
    toast(`Loaded ${state.levels.length} levels from ${state.vfs.sourceName}`, 'ok');
    // desktop app: cache the APK in the background so the next session is one click
    if (window.native?.cacheApk && state.vfs.sourceApk) {
      const { name, data } = state.vfs.sourceApk;
      setTimeout(() => window.native.cacheApk(name, data).catch(() => {}), 400);
    }
    // reopen the level you were working on last time
    const last = getPref('lastLevel');
    const entry = last ? state.levels.find((l) => l.name === last) : null;
    if (entry) openLevel(entry);
    if (shouldShowTutorial()) setTimeout(startTutorial, 350);
  } catch (err) {
    setBusy(null);
    console.error(err);
    renderWelcome(err.message || String(err));
  }
}

// ============================================================ editor screen

function renderEditor() {
  app.replaceChildren(
    el('div', { class: 'shell' },
      // top bar
      el('header', { class: 'topbar' },
        el('div', { class: 'brand' }, logoSvg(22), el('strong', { text: 'Willemilks Water Editor' }),
          el('span', { class: 'muted small', id: 'level-title' })),
        el('div', { class: 'row gap', id: 'topbar-actions' },
          el('button', { class: 'btn', id: 'btn-undo', text: '↶ ' + t('btn.undo'), title: 'Ctrl+Z', onclick: () => state.editor.doUndo() }),
          el('button', { class: 'btn', id: 'btn-redo', text: '↷ ' + t('btn.redo'), title: 'Ctrl+Y', onclick: () => state.editor.doRedo() }),
          el('span', { class: 'vsep' }),
          el('button', { class: 'btn primary', id: 'btn-save', text: t('btn.save'), title: 'Ctrl+S', onclick: saveCurrent }),
          el('button', { class: 'btn', id: 'btn-export', text: t('btn.export') + ' ▾', onclick: toggleExportMenu }),
          window.native?.isApp
            ? el('button', { class: 'btn', id: 'btn-playtest', text: '▶ ' + t('btn.playtest'), title: 'F5', onclick: runPlaytest })
            : null,
          el('span', { class: 'vsep' }),
          el('button', { class: 'btn ghost', title: t('settings.title'), text: '⚙', onclick: showSettings }),
          el('button', { class: 'btn ghost', title: 'Tutorial', text: '?', onclick: startTutorial })
        )
      ),
      // workspace
      el('div', { class: 'workspace' },
        // left panel with tabs
        el('aside', { class: 'left' },
          el('div', { class: 'tabs' },
            el('button', { class: 'tab active', id: 'tab-levels', text: t('tabs.levels'), onclick: () => switchTab('levels') }),
            el('button', { class: 'tab', id: 'tab-objects', text: t('tabs.objects'), onclick: () => switchTab('objects') })
          ),
          el('div', { class: 'tab-body', id: 'level-panel' }),
          el('div', { class: 'tab-body hidden', id: 'object-panel' })
        ),
        // center
        el('main', { class: 'center' },
          el('div', { class: 'toolbar' },
            el('div', { class: 'tool-group', id: 'toolbar-tools' }),
            el('div', { class: 'tool-group', id: 'brush-group' },
              el('span', { class: 'muted small', text: t('tool.brush') }),
              el('input', { type: 'range', min: '1', max: '15', step: '2', value: '1', id: 'brush-size',
                oninput: (e) => { state.editor.brushSize = parseInt(e.target.value); document.getElementById('brush-val').textContent = e.target.value; } }),
              el('span', { class: 'muted small', id: 'brush-val', text: '1' })
            ),
            el('div', { class: 'tool-group' },
              toggleBtn(t('toggle.grid'), 'btn-grid', (on) => { state.editor.showGrid = on; state.editor.requestRender(); }, false, 'menu-grid'),
              toggleBtn(t('toggle.collision'), 'btn-coll', (on) => { state.editor.showCollision = on; state.editor.requestRender(); }, false, 'menu-collision'),
              toggleBtn(t('toggle.paths'), 'btn-paths', (on) => { state.editor.showPaths = on; state.editor.requestRender(); }, true, 'menu-paths'),
              toggleBtn(t('conn.show'), 'btn-conns', (on) => { state.editor.showConnections = on; state.editor.requestRender(); }, true, 'menu-conns'),
              el('button', { class: 'btn small', text: t('btn.fit'), title: t('btn.fit') + ' (0)', onclick: () => state.editor.fitView() })
            )
          ),
          el('div', { class: 'mat-bar', id: 'material-bar' }),
          el('div', { class: 'canvas-wrap', id: 'canvas-wrap' },
            el('canvas', { id: 'editor-canvas' }),
            el('div', { class: 'connection-banner hidden', id: 'connection-banner' },
              el('span', { text: t('conn.banner') }),
              el('button', { class: 'btn small', text: t('btn.cancel'), onclick: () => cancelConnectionPick() })),
            el('div', { class: 'canvas-empty', id: 'canvas-empty' },
              el('div', { class: 'canvas-watermark' }, logoSvg(110)),
              el('p', { text: t('canvas.openHint') }),
              el('p', { class: 'small', text: t('canvas.newHint') }),
              el('button', { class: 'btn', text: '+ ' + t('btn.newLevel'), onclick: newLevel }))
          ),
          el('div', { class: 'statusbar', id: 'statusbar' }, el('span', { id: 'status-pos' }), el('span', { id: 'status-mat' }),
            el('span', { class: 'grow' }),
            el('span', { class: 'muted small', id: 'status-zoom', title: t('btn.fit') + ' (0)', onclick: () => state.editor?.fitView() }),
            el('span', { class: 'muted small', text: t('status.pan') }))
        ),
        // right inspector
        el('aside', { class: 'right scroll', id: 'inspector' })
      )
    ),
    el('datalist', { id: 'prop-suggestions' }, ...propertySuggestions().map((p) => el('option', { value: p })))
  );

  // components
  const canvas = document.getElementById('editor-canvas');
  state.editor?.dispose?.(); // drop the old instance's window listeners on reload
  state.editor = new Editor(canvas, state.resolver, {
    onSelect: (obj) => { inspector.setObject(obj); },
    onViewChanged: (zoom) => {
      const z = document.getElementById('status-zoom');
      if (z) z.textContent = Math.round(zoom * 100) + '% ' + t('status.zoom');
    },
    onChange: (kind) => {
      if (kind === 'move') inspector.refreshPosition();
      else inspector.render();
      updateUndoButtons();
      markDirty();
    },
    onHover: (info) => {
      const pos = document.getElementById('status-pos');
      const mat = document.getElementById('status-mat');
      if (!info.pixel) { pos.textContent = ''; mat.textContent = ''; return; }
      pos.textContent = `px ${info.ix},${info.iy} · world ${info.wx.toFixed(2)}, ${info.wy.toFixed(2)}`;
      mat.textContent = pixelLabel(info.pixel);
    },
    onPick: (rgb) => {
      const { nearestMaterial } = matApi;
      const m = nearestMaterial(rgb[0], rgb[1], rgb[2]);
      state.editor.material = m.id;
      renderMaterials();
      setTool(TOOLS.PENCIL);
      toast(`Picked ${m.name}`, 'info', 1500);
    },
  });

  state.editor.smartTerrain = getPref('smartTerrain', true);

  const levelBrowser = new LevelBrowser(document.getElementById('level-panel'), openLevel);
  levelBrowser.setLevels(state.levels);
  state.levelBrowser = levelBrowser;

  const objectBrowser = new ObjectBrowser(document.getElementById('object-panel'), state.resolver, (item) => {
    state.placing = item;
    setTool(TOOLS.SELECT);
    toast(`Click in the level to place "${item.name}" (Esc to cancel)`, 'info', 4000);
  });
  objectBrowser.load();

  const inspector = new Inspector(document.getElementById('inspector'), {
    getLevel: () => state.level,
    push: () => state.level?.pushUndo(),
    // the game falls back to the object's .hs DefaultProperties for anything the
    // level XML leaves out — expose those so the quick editors show the truth
    getDefaults: (obj) => { try { return state.resolver.getHS(obj.filename).defaults || {}; } catch { return {}; } },
    onEdit: () => { state.editor.requestRender(); updateUndoButtons(); markDirty(); },
    onPickConnection: (obj, propName) => {
      // next click on an object in the canvas wires it into this property
      state.editor.pickObjectMode = (hit) => {
        if (hit === obj) return;
        state.level.pushUndo();
        obj.properties[propName] = hit.name;
        cancelConnectionPick();
        inspector.render();
        state.editor.requestRender();
        markDirty();
        toast(t('conn.done', { name: hit.name }), 'ok', 2200);
      };
      document.getElementById('connection-banner')?.classList.remove('hidden');
    },
    // reverse of onPickConnection: pick a switch/generator in the canvas and add
    // THIS object to that controller's group (writes ConnectedObjectN on it)
    onPickController: (target) => {
      state.editor.pickObjectMode = (hit) => {
        if (hit === target) return;
        const ht = (hit.properties.Type || '').toLowerCase();
        const hfn = (hit.properties.Filename || '').toLowerCase();
        const isController = ht === 'switch' || ht === 'generator'
          || /switch|lever|generator/.test(hfn)
          || Object.keys(hit.properties).some((k) => /^ConnectedObject\d+$/.test(k));
        if (!isController) { toast(t('group.pickSwitch'), 'warn', 2400); return; }
        const already = Object.entries(hit.properties)
          .some(([k, v]) => /^ConnectedObject\d+$/.test(k) && v === target.name);
        state.level.pushUndo();
        if (!already) {
          let i = 0;
          while (hit.properties['ConnectedObject' + i] !== undefined) i++;
          hit.properties['ConnectedObject' + i] = target.name;
        }
        cancelConnectionPick();
        inspector.render();
        state.editor.requestRender();
        markDirty();
        toast(t('conn.done', { name: hit.name }), 'ok', 2200);
      };
      document.getElementById('connection-banner')?.classList.remove('hidden');
    },
    onSelect: (obj) => {
      state.editor.selected = obj;
      inspector.setObject(obj);
      state.editor.requestRender();
    },
    onChallengeWrite: (requirements, desc, btn) => writeChallengeToGame(requirements, desc, btn),
    onChallengeLoad: () => loadChallengeFromGame(),
    onDelete: (obj) => {
      state.level.pushUndo();
      state.level.removeObject(obj);
      state.editor.selected = null;
      inspector.setObject(null);
      state.editor.requestRender();
      markDirty();
    },
    onDuplicate: (obj) => {
      state.level.pushUndo();
      const copy = state.level.duplicateObject(obj);
      state.editor.selected = copy;
      inspector.setObject(copy);
      state.editor.requestRender();
      markDirty();
    },
  });
  state.inspector = inspector;
  inspector.render();

  buildTools();
  renderMaterials();

  // placement click + Esc cancel
  canvas.addEventListener('pointerdown', (e) => {
    if (!state.placing || !state.level || e.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const [wx, wy] = state.editor.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    state.level.pushUndo();
    const hs = state.resolver.getHS(state.placing.gamePath);
    const obj = state.level.addObject(state.placing.gamePath, Math.round(wx * 4) / 4, Math.round(wy * 4) / 4, hs.defaults?.Type || '');
    state.editor.selected = obj;
    inspector.setObject(obj);
    state.placing = null;
    state.editor.preloadVisuals();
    markDirty();
  }, { capture: true });

  // named handlers so reloading game files never stacks duplicate listeners
  window.removeEventListener('keydown', onGlobalKeys);
  window.addEventListener('keydown', onGlobalKeys);
  window.removeEventListener('keyup', onGlobalKeyUp);
  window.addEventListener('keyup', onGlobalKeyUp);
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('beforeunload', onBeforeUnload);
}

function onGlobalKeyUp(e) {
  if (e.code === 'Space') state.editor?.setSpace(false);
}

function onBeforeUnload(e) {
  if (state.level?.dirty) { e.preventDefault(); e.returnValue = ''; }
}

function cancelConnectionPick() {
  if (state.editor) state.editor.pickObjectMode = null;
  document.getElementById('connection-banner')?.classList.add('hidden');
}

// ---------------- custom challenges (water.db) ----------------

/** The game's level key for the open level, e.g. "/Levels/drain_it_first". */
function levelGamePath(level) {
  const m = (level?.xmlPath || '').match(/(Levels\/.+?)\.xml$/i);
  return m ? '/' + m[1] : null;
}

/** Locate water.db inside the loaded APK (skips the Lite/demo variants). */
function waterDbPath(vfs) {
  if (!vfs) return null;
  if (vfs.has('assets/Data/water.db')) return 'assets/Data/water.db';
  for (const key of vfs.files.keys()) {
    if (/(^|\/)data\/water\.db$/.test(key)) return vfs.originalNames.get(key);
  }
  return null;
}

async function writeChallengeToGame(requirements, desc, btn) {
  if (!state.vfs) return toast(t('toast.loadFirst'), 'err');
  const path = waterDbPath(state.vfs);
  if (!path) return toast(t('ch.noDb'), 'err', 6000);
  const levelPath = levelGamePath(state.level);
  if (!levelPath) return toast(t('ch.noLevelPath'), 'err', 5000);
  if (!requirements.trim()) return toast(t('ch.empty'), 'warn', 4000);
  if (btn) btn.disabled = true;
  try {
    const { writeChallenge } = await import('./core/waterdb.js');
    const newBytes = await writeChallenge(state.vfs.read(path), levelPath, requirements, desc || 'CHALLENGE_CRANKY_DUCKS');
    state.vfs._put(path, newBytes);
    markDirty();
    toast(t('ch.wrote'), 'ok', 4000);
  } catch (err) {
    console.error('challenge write failed', err);
    toast(t('ch.dbFail'), 'err', 8000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadChallengeFromGame() {
  if (!state.vfs || !state.level) return;
  const path = waterDbPath(state.vfs);
  if (!path) return toast(t('ch.noDb'), 'err', 6000);
  const levelPath = levelGamePath(state.level);
  if (!levelPath) return toast(t('ch.noLevelPath'), 'err', 5000);
  try {
    const { readChallenge } = await import('./core/waterdb.js');
    const existing = await readChallenge(state.vfs.read(path), levelPath);
    if (!existing) return toast(t('ch.noChallenge'), 'warn', 4000);
    state.level.challenge = { conditions: parseRequirements(existing.requirements), desc: existing.desc };
    state.inspector.render();
    toast(t('ch.loaded'), 'ok', 3000);
  } catch (err) {
    console.error('challenge read failed', err);
    toast(t('ch.dbFail'), 'err', 8000);
  }
}

import { nearestMaterial as _nm, materialForColor as _mfc } from './data/materials.js';
const matApi = { nearestMaterial: _nm };

function pixelLabel(px) {
  const exact = _mfc(px[0], px[1], px[2]); // includes the known color aliases
  return exact ? t('mat.' + exact.id) : `rgb(${px.join(',')})`;
}

function onGlobalKeys(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { state.editor?.setSpace(true); e.preventDefault(); }
  if (e.key === 'Escape') {
    if (state.editor?.pickObjectMode) { cancelConnectionPick(); return; }
    if (state.placing) { state.placing = null; toast(t('btn.cancel'), 'info', 1000); }
    else if (state.editor?.selected) { state.editor.selected = null; state.inspector?.setObject(null); state.editor.requestRender(); }
    document.querySelector('.export-menu')?.remove();
  }
  if (e.key === 'F5' && window.native?.isApp) { e.preventDefault(); runPlaytest(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
  if (!state.editor || e.ctrlKey || e.metaKey) return;
  if (e.key.toLowerCase() === 'r' && state.editor.tool === TOOLS.SELECT && state.editor.selected) {
    e.preventDefault();
    state.editor.rotateSelected(45);
    return;
  }
  const map = { v: TOOLS.SELECT, b: TOOLS.PENCIL, e: TOOLS.ERASER, l: TOOLS.LINE, r: TOOLS.RECT, f: TOOLS.FILL, i: TOOLS.PICKER };
  const t = map[e.key.toLowerCase()];
  if (t) setTool(t);
  if (e.key === '0') state.editor.fitView();
  if (e.key.toLowerCase() === 'g') document.getElementById('btn-grid')?.click();
}

function toolIcon(paths) {
  const span = el('span', { class: 'tool-icon' });
  span.innerHTML = `<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  return span;
}

function buildTools() {
  const defs = [
    [TOOLS.SELECT, t('tool.select'), '<path d="M3.5 2.2v10l2.6-2.3 1.6 4 1.8-.7-1.6-3.9h3.7z"/>'],
    [TOOLS.PENCIL, t('tool.pencil'), '<path d="M11.2 2.3l2.5 2.5L5.2 13.3l-3.2.7.7-3.2z"/><path d="M9.4 4.1l2.5 2.5"/>'],
    [TOOLS.ERASER, t('tool.eraser'), '<path d="M9.3 2.9l3.8 3.8-6 6H4.3L2.2 10.6z"/><path d="M6.6 5.6l3.8 3.8"/><path d="M9 13h4.8"/>'],
    [TOOLS.LINE, t('tool.line'), '<path d="M2.5 13.5l11-11"/><circle cx="2.5" cy="13.5" r="1"/><circle cx="13.5" cy="2.5" r="1"/>'],
    [TOOLS.RECT, t('tool.rect'), '<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'],
    [TOOLS.FILL, t('tool.fill'), '<path d="M7.3 2.2l5.2 5.2-4.4 4.4a1.4 1.4 0 0 1-2 0L3 8.7a1.4 1.4 0 0 1 0-2z"/><path d="M12.9 10.8s1.4 1.6 1.4 2.5a1.4 1.4 0 0 1-2.8 0c0-.9 1.4-2.5 1.4-2.5z"/>'],
    [TOOLS.PICKER, t('tool.picker'), '<path d="M9.8 4.2l2-2a1.4 1.4 0 0 1 2 2l-2 2"/><path d="M10.8 5.2l-6.3 6.3-.6 2.6 2.6-.6 6.3-6.3z"/>'],
  ];
  const wrap = document.getElementById('toolbar-tools');
  wrap.replaceChildren(
    ...defs.map(([tool, title, icon]) =>
      el('button', {
        class: 'tool-btn' + (state.editor.tool === tool ? ' active' : ''),
        'data-tool': tool,
        title,
        onclick: () => setTool(tool),
      }, toolIcon(icon))
    )
  );
}

function setTool(tool) {
  state.editor.tool = tool;
  document.querySelectorAll('.tool-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  const paint = tool !== TOOLS.SELECT;
  document.getElementById('material-bar').classList.toggle('lit', paint);
  state.editor.requestRender();
}

function renderMaterials() {
  materialPalette(document.getElementById('material-bar'), state.editor.material, (id) => {
    state.editor.material = id;
    if (state.editor.tool === TOOLS.SELECT) setTool(TOOLS.PENCIL);
    renderMaterials();
  });
}

function toggleBtn(label, id, onToggle, initial = false, menuId = null) {
  const b = el('button', { class: 'btn small toggle' + (initial ? ' on' : ''), id, text: label });
  b.addEventListener('click', () => {
    b.classList.toggle('on');
    const on = b.classList.contains('on');
    onToggle(on);
    // keep the native View menu checkbox in step with the toolbar
    if (menuId) window.native?.syncMenu?.(menuId, on);
  });
  return b;
}

async function openLevel(entry) {
  if (state.level?.dirty && !confirm(t('toast.unsaved', { name: state.level.name }))) return;
  try {
    setBusy(`Opening ${entry.name}…`);
    const xmlText = state.vfs.readText(entry.xmlPath);
    const level = Level.parseXML(entry.name, xmlText);
    level.xmlPath = entry.xmlPath;
    level.pngPath = entry.pngPath;
    if (entry.pngPath) {
      level.terrain = await Terrain.fromPNGBytes(state.vfs.read(entry.pngPath));
    } else {
      level.terrain = Terrain.blank();
    }
    state.level = level;
    document.getElementById('canvas-empty').style.display = 'none';
    document.getElementById('level-title').textContent = '· ' + entry.name;
    document.querySelector('.topbar')?.classList.remove('dirty');
    state.levelBrowser.setActive(entry.name);
    state.editor.setLevel(level);
    state.inspector.setObject(null);
    updateUndoButtons();
    setPref('lastLevel', entry.name);
    setBusy(null);
  } catch (err) {
    setBusy(null);
    console.error(err);
    toast('Could not open level: ' + err.message, 'err', 6000);
  }
}

function newLevel() {
  modalPrompt(t('new.title'), t('new.name'), 'my_custom_level', (name) => {
    if (!name) return;
    const clean = name.trim().replace(/\s+/g, '_');
    if (state.levels.some((l) => l.name.toLowerCase() === clean.toLowerCase())) {
      toast(t('new.exists'), 'err');
      return;
    }
    createLevel(clean);
  });
}

function createLevel(clean) {
  const level = new Level(clean);
  level.terrain = Terrain.blank(DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT);
  level.room = { x: 0, y: -30 };
  state.level = level;
  document.getElementById('canvas-empty').style.display = 'none';
  document.getElementById('level-title').textContent = '· ' + clean + ' (new)';
  state.editor.setLevel(level);
  state.inspector.setObject(null);
  toast(t('toast.saved', { name: clean }).replace('…', ''), 'ok', 2500);
}

function markDirty() {
  if (!state.level) return;
  state.level.dirty = true;
  document.getElementById('level-title').textContent = '· ' + state.level.name + ' •';
  document.querySelector('.topbar')?.classList.add('dirty');
}

function updateUndoButtons() {
  document.getElementById('btn-undo').disabled = !state.level?.canUndo;
  document.getElementById('btn-redo').disabled = !state.level?.canRedo;
}

function saveCurrent() {
  if (!state.level) return;
  saveIntoVFS(state.vfs, state.level);
  if (!state.levels.some((l) => l.name === state.level.name)) {
    state.levels = listLevels(state.vfs);
    state.levelBrowser.setLevels(state.levels);
    state.levelBrowser.setActive(state.level.name);
  }
  document.getElementById('level-title').textContent = '· ' + state.level.name;
  document.querySelector('.topbar')?.classList.remove('dirty');
  toast(t('toast.saved', { name: state.level.name }), 'ok');
}

function exportLevelZip() {
  if (!state.level) return toast(t('toast.openFirst'), 'err');
  downloadLevelZip(state.level);
}
function exportXml() {
  if (!state.level) return toast(t('toast.openFirst'), 'err');
  downloadBytes(levelToFiles(state.level).xml, state.level.name + '.xml', 'text/xml');
}
function exportPng() {
  if (!state.level) return toast(t('toast.openFirst'), 'err');
  downloadBytes(levelToFiles(state.level).png, state.level.name + '.png', 'image/png');
}
function exportAssets() {
  if (!state.vfs) return toast(t('toast.loadFirst'), 'err');
  setBusy('Packing assets…');
  setTimeout(() => { try { downloadAssetsZip(state.vfs, setBusy); } finally { setBusy(null); } }, 50);
}

function toggleExportMenu(e) {
  document.querySelector('.export-menu')?.remove();
  const menu = el('div', { class: 'export-menu' },
    menuItem(t('export.levelZip'), t('export.levelZipSub'), exportLevelZip),
    menuItem(t('export.xml'), '', exportXml),
    menuItem(t('export.png'), t('export.pngSub'), exportPng),
    menuItem(t('export.assets'), t('export.assetsSub'), exportAssets)
  );
  document.body.append(menu);
  const r = e.target.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + 'px';
  menu.style.right = window.innerWidth - r.right + 'px';
  setTimeout(() => {
    const close = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); window.removeEventListener('pointerdown', close); } };
    window.addEventListener('pointerdown', close);
  });
}

function menuItem(title, sub, onclick) {
  return el('button', { class: 'export-item', onclick: () => { document.querySelector('.export-menu')?.remove(); onclick(); } },
    el('strong', { text: title }), sub ? el('span', { class: 'muted small', text: sub }) : null);
}

function switchTab(which) {
  document.getElementById('tab-levels').classList.toggle('active', which === 'levels');
  document.getElementById('tab-objects').classList.toggle('active', which === 'objects');
  document.getElementById('level-panel').classList.toggle('hidden', which !== 'levels');
  document.getElementById('object-panel').classList.toggle('hidden', which !== 'objects');
}

// ============================================================ native shell (Electron)

const SHORTCUTS = [
  ['V', 'Select / move'], ['B', 'Pencil'], ['E', 'Eraser'], ['L', 'Line'], ['R', 'Rectangle'],
  ['F', 'Fill bucket'], ['I', 'Material picker'], ['1 to 9', 'Brush size'], ['G', 'Toggle grid'],
  ['0', 'Fit level in view'], ['Scroll', 'Zoom'], ['Right mouse / Space', 'Pan'],
  ['Shift while dragging', 'Snap object to half grid'], ['Alt while dragging', 'Disable neighbor snapping'],
  ['Arrow keys', 'Nudge selected object'], ['R (object selected)', 'Rotate object 45 degrees'],
  ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+D', 'Duplicate object'], ['Del', 'Delete object'],
  ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste object'],
  ['Ctrl+S', 'Save level'], ['Esc', 'Cancel placement'],
];

function showShortcuts() {
  document.querySelector('.shortcuts-overlay')?.remove();
  const overlay = el('div', { class: 'shortcuts-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    el('div', { class: 'welcome-card shortcuts-card' },
      el('h3', { text: 'Keyboard shortcuts' }),
      el('div', { class: 'shortcut-grid' },
        ...SHORTCUTS.flatMap(([k, label]) => [
          el('span', { class: 'shortcut-key', text: k }),
          el('span', { class: 'muted', text: label }),
        ])
      ),
      el('div', { class: 'row gap center', style: 'justify-content: center; margin-top: 14px' },
        el('button', { class: 'btn primary', text: 'Close', onclick: () => overlay.remove() }))
    ));
  document.body.append(overlay);
}

function wireNative() {
  if (!window.native?.isApp) return;
  window.native.onMenu(({ action, payload }) => {
    const ed = state.editor;
    switch (action) {
      case 'open-game-data': {
        const file = new File([payload.buffer], payload.name);
        ingest(() => loadFromZipFile(file));
        break;
      }
      case 'new-level': if (state.vfs) newLevel(); else toast(t('toast.loadFirst'), 'err'); break;
      case 'open-recent': continueLastSession(); break;
      case 'save': saveCurrent(); break;
      case 'settings': showSettings(); break;
      case 'playtest': runPlaytest(); break;
      case 'export-level-zip': exportLevelZip(); break;
      case 'export-xml': exportXml(); break;
      case 'export-png': exportPng(); break;
      case 'export-assets': exportAssets(); break;
      case 'undo': ed?.doUndo(); break;
      case 'redo': ed?.doRedo(); break;
      case 'duplicate': document.activeElement?.blur(); dispatchKey('d', { ctrlKey: true }); break;
      case 'delete': dispatchKey('Delete'); break;
      case 'zoom-in': ed?.zoomBy(1.25); break;
      case 'zoom-out': ed?.zoomBy(1 / 1.25); break;
      case 'fit': ed?.fitView(); break;
      case 'toggle-grid': document.getElementById('btn-grid')?.click(); break;
      case 'toggle-collision': document.getElementById('btn-coll')?.click(); break;
      case 'toggle-paths': document.getElementById('btn-paths')?.click(); break;
      case 'toggle-connections': document.getElementById('btn-conns')?.click(); break;
      case 'toggle-smartrock': { const on = !getPref('smartTerrain', true); setPref('smartTerrain', on); if (state.editor) state.editor.smartTerrain = on; window.native?.syncMenu?.('menu-smart', on); toast(t('settings.smart') + ': ' + (on ? 'ON' : 'OFF'), 'info', 1800); break; }
      case 'tutorial': if (state.editor) startTutorial(); else toast('Load game files first', 'err'); break;
      case 'shortcuts': showShortcuts(); break;
    }
  });
}

function dispatchKey(key, mods = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, ...mods }));
}

// ============================================================ boot

wireNative();
renderWelcome();

// ============================================================ modal prompt (Electron has no window.prompt)

function modalPrompt(title, label, initial, onSubmit) {
  document.querySelector('.modal-overlay')?.remove();
  const input = el('input', { type: 'text', value: initial });
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    el('div', { class: 'welcome-card modal-card' },
      el('h3', { text: title }),
      el('div', { class: 'field' }, el('label', { text: label }), input),
      el('div', { class: 'row gap', style: 'justify-content: flex-end; margin-top: 10px' },
        el('button', { class: 'btn', text: t('btn.cancel'), onclick: () => overlay.remove() }),
        el('button', { class: 'btn primary', text: t('btn.create'), onclick: submit }))
    ));
  function submit() { const v = input.value; overlay.remove(); onSubmit(v); }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') overlay.remove(); });
  document.body.append(overlay);
  input.focus(); input.select();
}

// ============================================================ settings

const PT_DEFAULTS = {
  javaPath: 'java',
  signerJar: '',
  adbPath: 'adb',
  deviceAddr: '127.0.0.1:16384',
  packageName: 'com.disney.WMW',
  resetData: false,
  unlockAll: false,
};

function playtestSettings() {
  return { ...PT_DEFAULTS, ...getPref('playtest', {}) };
}

function showSettings() {
  document.querySelector('.modal-overlay')?.remove();
  const pt = playtestSettings();
  const isApp = !!window.native?.isApp;

  const langSel = el('select', {}, ...LANGS.map(([code, name]) =>
    el('option', { value: code, text: name, selected: code === currentLang() ? '' : null })));

  const smart = el('input', { type: 'checkbox' });
  smart.checked = getPref('smartTerrain', true);

  const resetData = el('input', { type: 'checkbox' });
  resetData.checked = pt.resetData;

  const unlockAll = el('input', { type: 'checkbox' });
  unlockAll.checked = pt.unlockAll;

  const fields = {};
  const pathField = (key, labelKey, browseFilters, helpKey = null) => {
    fields[key] = el('input', { type: 'text', value: pt[key] });
    const help = helpKey ? el('div', { class: 'field-help', text: t(helpKey) }) : null;
    return el('div', { class: 'field' },
      el('div', { class: 'field-label-row' },
        el('label', { text: t(labelKey) }),
        helpKey
          ? el('button', {
              class: 'help-btn', type: 'button', text: '?', title: t('help.show'),
              onclick: (e) => { e.preventDefault(); help.classList.toggle('visible'); },
            })
          : null),
      el('div', { class: 'row gap' }, fields[key],
        isApp && browseFilters
          ? el('button', { class: 'btn small', text: t('btn.browse'), onclick: async () => {
              const p = await window.native.pickPath(t(labelKey), browseFilters);
              if (p) fields[key].value = p;
            } })
          : null),
      help);
  };

  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    el('div', { class: 'welcome-card modal-card settings-card' },
      el('h3', { text: t('settings.title') }),
      el('div', { class: 'field' }, el('label', { text: t('settings.language') }), langSel,
        el('span', { class: 'muted small', text: t('settings.langNote') })),
      el('div', { class: 'sep' }),
      el('label', { class: 'check-row' }, smart, el('span', {},
        el('strong', { text: t('settings.smart') }),
        el('span', { class: 'muted small', text: ' ' + t('settings.smartSub') }))),
      el('div', { class: 'sep' }),
      el('h4', { text: t('settings.playtest') }),
      isApp ? null : el('p', { class: 'muted small', text: t('settings.webNote') }),
      pathField('signerJar', 'settings.signer', [{ name: 'Java archive', extensions: ['jar'] }], 'help.signer'),
      pathField('adbPath', 'settings.adb', [{ name: 'adb', extensions: ['exe', '*'] }], 'help.adb'),
      pathField('deviceAddr', 'settings.device', null, 'help.device'),
      pathField('javaPath', 'settings.java', [{ name: 'java', extensions: ['exe', '*'] }], 'help.java'),
      pathField('packageName', 'settings.pkg', null),
      el('label', { class: 'check-row' }, resetData, el('span', {},
        el('strong', { text: t('settings.resetData') }),
        el('span', { class: 'muted small', text: ' ' + t('settings.resetDataSub') }))),
      el('label', { class: 'check-row' }, unlockAll, el('span', {},
        el('strong', { text: t('settings.unlockAll') }),
        el('span', { class: 'muted small', text: ' ' + t('settings.unlockAllSub') }))),
      el('div', { class: 'row gap', style: 'justify-content: flex-end; margin-top: 12px' },
        el('button', { class: 'btn', text: t('btn.cancel'), onclick: () => overlay.remove() }),
        el('button', { class: 'btn primary', text: t('btn.save'), onclick: save }))
    ));

  function save() {
    setPref('smartTerrain', smart.checked);
    if (state.editor) state.editor.smartTerrain = smart.checked;
    window.native?.syncMenu?.('menu-smart', smart.checked);
    setPref('playtest', {
      ...Object.fromEntries(Object.entries(fields).map(([k, inp]) => [k, inp.value.trim()])),
      resetData: resetData.checked,
      unlockAll: unlockAll.checked,
    });
    const newLang = langSel.value;
    overlay.remove();
    if (newLang !== currentLang()) {
      if (!state.level?.dirty || confirm(t('toast.unsaved', { name: state.level?.name || '' }))) {
        setLang(newLang);
        location.reload();
      } else {
        setLang(newLang);
      }
    }
  }
  document.body.append(overlay);
}

// ============================================================ playtest

let ptRunning = false;

async function runPlaytest() {
  if (!window.native?.isApp) return toast(t('settings.webNote'), 'err', 5000);
  if (ptRunning) return;
  if (!state.vfs) return toast(t('toast.loadFirst'), 'err');
  if (!state.vfs.sourceApk) return toast(t('pt.noApk'), 'err', 7000);
  if (state.level?.dirty && confirm(t('pt.unsavedAsk', { name: state.level.name }))) saveCurrent();

  const logBox = el('div', { class: 'pt-log' });
  const status = el('p', { class: 'muted small', text: t('pt.building') });
  const closeBtn = el('button', { class: 'btn primary', text: t('btn.close'), disabled: '', onclick: () => overlay.remove() });
  const overlay = el('div', { class: 'modal-overlay' },
    el('div', { class: 'welcome-card modal-card pt-card' },
      el('h3', { text: t('pt.title') }), status, logBox,
      el('div', { class: 'row gap', style: 'justify-content: flex-end; margin-top: 10px' }, closeBtn)));
  document.body.append(overlay);

  const addLine = (line, kind = 'out') => {
    logBox.append(el('div', { class: 'pt-line ' + kind, text: line }));
    logBox.scrollTop = logBox.scrollHeight;
  };

  if (!runPlaytest._wired) {
    window.native.onPlaytestLog(({ kind, line }) => {
      const box = document.querySelector('.pt-log');
      if (!box) return;
      box.append(el('div', { class: 'pt-line ' + kind, text: line }));
      box.scrollTop = box.scrollHeight;
    });
    runPlaytest._wired = true;
  }

  ptRunning = true;
  const ptBtn = document.getElementById('btn-playtest');
  if (ptBtn) { ptBtn.disabled = true; ptBtn.textContent = t('pt.btnBusy'); }
  try {
    // rebuild off the UI thread tick so the modal paints first
    await new Promise((r) => setTimeout(r, 30));
    const pt = playtestSettings();
    if (pt.unlockAll) {
      const dbPath = waterDbPath(state.vfs);
      if (dbPath) {
        try {
          const { unlockEverything } = await import('./core/waterdb.js');
          state.vfs._put(dbPath, await unlockEverything(state.vfs.read(dbPath)));
          addLine('Unlocked all levels and worlds in water.db', 'step');
        } catch (e) { addLine('Could not unlock all: ' + (e.message || e), 'error'); }
      }
    }
    const apk = rebuildApk(state.vfs.sourceApk.data, state.vfs, (m) => addLine(m, 'step'));
    addLine(`APK ready (${(apk.length / 1048576).toFixed(1)} MB)`, 'step');
    status.textContent = '';
    // unlocking and db edits only load on fresh data, so force the reset then
    const res = await window.native.playtest(apk, { ...pt, resetData: pt.resetData || pt.unlockAll });
    status.textContent = res.ok ? t('pt.done') : t('pt.failed');
    status.className = res.ok ? 'small' : 'error small';
  } catch (err) {
    addLine(String(err.message || err), 'error');
    status.textContent = t('pt.failed');
    status.className = 'error small';
  } finally {
    ptRunning = false;
    closeBtn.disabled = false;
    if (ptBtn) { ptBtn.disabled = false; ptBtn.textContent = '▶ ' + t('btn.playtest'); }
  }
}
