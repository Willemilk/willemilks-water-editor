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

const app = document.getElementById('app');

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
        el('div', { class: 'logo' }, el('span', { class: 'logo-drop' }, '💧'), el('h1', { text: 'Willemilks Water Editor' })),
        el('p', { class: 'tagline', text: 'The Where\'s My Water level editor that can do it all — objects, properties, motor paths and full terrain painting.' }),
        el('div', { class: 'drop-area' },
          el('p', { html: '<strong>Drop your game files here</strong>' }),
          el('p', { class: 'muted', text: 'Accepts: a .zip with the assets folder, a zip containing base.apk, or the .apk itself. Nothing leaves your browser.' }),
          el('div', { class: 'row gap center' },
            el('button', { class: 'btn primary', text: 'Choose zip / apk…', onclick: () => fileInput.click() }),
            el('button', { class: 'btn', text: 'Choose folder…', onclick: () => folderInput.click() })
          )
        ),
        error ? el('p', { class: 'error', text: error }) : null,
        el('p', { class: 'muted small', text: 'Tip: pull base.apk from your device (it is a zip), or drop the same zip you use for your mod workflow.' })
      )
    )
  );

  const fileInput = el('input', { type: 'file', accept: '.zip,.apk', style: 'display:none' });
  const folderInput = el('input', { type: 'file', webkitdirectory: '', style: 'display:none' });
  app.append(fileInput, folderInput);
  fileInput.addEventListener('change', () => fileInput.files[0] && ingest(() => loadFromZipFile(fileInput.files[0], setBusy)));
  folderInput.addEventListener('change', () => folderInput.files.length && ingest(() => loadFromFolder(folderInput.files, setBusy)));

  const dz = document.getElementById('dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const f = e.dataTransfer.files[0];
    if (f) ingest(() => loadFromZipFile(f, setBusy));
  });
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
        el('div', { class: 'brand' }, el('span', {}, '💧'), el('strong', { text: 'Willemilks Water Editor' }),
          el('span', { class: 'muted small', id: 'level-title' })),
        el('div', { class: 'row gap', id: 'topbar-actions' },
          el('button', { class: 'btn', id: 'btn-undo', text: '↶ Undo', title: 'Ctrl+Z', onclick: () => state.editor.doUndo() }),
          el('button', { class: 'btn', id: 'btn-redo', text: '↷ Redo', title: 'Ctrl+Y', onclick: () => state.editor.doRedo() }),
          el('span', { class: 'vsep' }),
          el('button', { class: 'btn primary', id: 'btn-save', text: 'Save', title: 'Ctrl+S — saves into the loaded game tree', onclick: saveCurrent }),
          el('button', { class: 'btn', id: 'btn-export', text: 'Export ▾', onclick: toggleExportMenu }),
          el('span', { class: 'vsep' }),
          el('button', { class: 'btn ghost', title: 'Show tutorial again', text: '?', onclick: startTutorial })
        )
      ),
      // workspace
      el('div', { class: 'workspace' },
        // left panel with tabs
        el('aside', { class: 'left' },
          el('div', { class: 'tabs' },
            el('button', { class: 'tab active', id: 'tab-levels', text: 'Levels', onclick: () => switchTab('levels') }),
            el('button', { class: 'tab', id: 'tab-objects', text: 'Objects', onclick: () => switchTab('objects') })
          ),
          el('div', { class: 'tab-body', id: 'level-panel' }),
          el('div', { class: 'tab-body hidden', id: 'object-panel' })
        ),
        // center
        el('main', { class: 'center' },
          el('div', { class: 'toolbar' },
            el('div', { class: 'tool-group', id: 'toolbar-tools' }),
            el('div', { class: 'tool-group', id: 'brush-group' },
              el('span', { class: 'muted small', text: 'Brush' }),
              el('input', { type: 'range', min: '1', max: '9', step: '2', value: '1', id: 'brush-size',
                oninput: (e) => { state.editor.brushSize = parseInt(e.target.value); document.getElementById('brush-val').textContent = e.target.value; } }),
              el('span', { class: 'muted small', id: 'brush-val', text: '1' })
            ),
            el('div', { class: 'tool-group' },
              toggleBtn('Grid', 'btn-grid', (on) => { state.editor.showGrid = on; state.editor.requestRender(); }),
              toggleBtn('Collision', 'btn-coll', (on) => { state.editor.showCollision = on; state.editor.requestRender(); }),
              toggleBtn('Paths', 'btn-paths', (on) => { state.editor.showPaths = on; state.editor.requestRender(); }, true),
              el('button', { class: 'btn small', text: 'Fit', title: 'Fit level in view (0)', onclick: () => state.editor.fitView() })
            )
          ),
          el('div', { class: 'mat-bar', id: 'material-bar' }),
          el('div', { class: 'canvas-wrap', id: 'canvas-wrap' },
            el('canvas', { id: 'editor-canvas' }),
            el('div', { class: 'canvas-empty', id: 'canvas-empty' },
              el('p', { text: '← Pick a level to start editing' }),
              el('button', { class: 'btn', text: '+ New empty level', onclick: newLevel }))
          ),
          el('div', { class: 'statusbar', id: 'statusbar' }, el('span', { id: 'status-pos' }), el('span', { id: 'status-mat' }),
            el('span', { class: 'grow' }), el('span', { class: 'muted small', text: 'Right-drag / middle-drag / space-drag to pan · scroll to zoom' }))
        ),
        // right inspector
        el('aside', { class: 'right scroll', id: 'inspector' })
      )
    ),
    el('datalist', { id: 'prop-suggestions' }, ...propertySuggestions().map((p) => el('option', { value: p })))
  );

  // components
  const canvas = document.getElementById('editor-canvas');
  state.editor = new Editor(canvas, state.resolver, {
    onSelect: (obj) => { inspector.setObject(obj); },
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
    onEdit: () => { state.editor.requestRender(); updateUndoButtons(); markDirty(); },
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

  window.addEventListener('keydown', onGlobalKeys);
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') state.editor.setSpace(false); });
  window.addEventListener('beforeunload', (e) => {
    if (state.level?.dirty) { e.preventDefault(); e.returnValue = ''; }
  });
}

import { nearestMaterial as _nm } from './data/materials.js';
const matApi = { nearestMaterial: _nm };

function pixelLabel(px) {
  const m = _nm(px[0], px[1], px[2]);
  const exact = m.rgb[0] === px[0] && m.rgb[1] === px[1] && m.rgb[2] === px[2];
  return exact ? m.name : `rgb(${px.join(',')})`;
}

function onGlobalKeys(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (e.code === 'Space') { state.editor?.setSpace(true); e.preventDefault(); }
  if (e.key === 'Escape' && state.placing) { state.placing = null; toast('Placement cancelled', 'info', 1200); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveCurrent(); }
  if (!state.editor || e.ctrlKey || e.metaKey) return;
  const map = { v: TOOLS.SELECT, b: TOOLS.PENCIL, e: TOOLS.ERASER, l: TOOLS.LINE, r: TOOLS.RECT, f: TOOLS.FILL, i: TOOLS.PICKER };
  const t = map[e.key.toLowerCase()];
  if (t) setTool(t);
  if (e.key === '0') state.editor.fitView();
  if (e.key.toLowerCase() === 'g') document.getElementById('btn-grid')?.click();
}

function buildTools() {
  const defs = [
    [TOOLS.SELECT, 'Select / move', 'V', '🖱️'],
    [TOOLS.PENCIL, 'Pencil — paint terrain', 'B', '✏️'],
    [TOOLS.ERASER, 'Eraser — paint empty', 'E', '🧽'],
    [TOOLS.LINE, 'Line', 'L', '📏'],
    [TOOLS.RECT, 'Rectangle (filled)', 'R', '▭'],
    [TOOLS.FILL, 'Fill bucket', 'F', '🪣'],
    [TOOLS.PICKER, 'Material picker', 'I', '💉'],
  ];
  const wrap = document.getElementById('toolbar-tools');
  wrap.replaceChildren(
    ...defs.map(([tool, title, key, icon]) =>
      el('button', {
        class: 'tool-btn' + (state.editor.tool === tool ? ' active' : ''),
        'data-tool': tool,
        title: `${title} (${key})`,
        onclick: () => setTool(tool),
      }, el('span', { text: icon }))
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

function toggleBtn(label, id, onToggle, initial = false) {
  const b = el('button', { class: 'btn small toggle' + (initial ? ' on' : ''), id, text: label });
  b.addEventListener('click', () => {
    b.classList.toggle('on');
    onToggle(b.classList.contains('on'));
  });
  return b;
}

async function openLevel(entry) {
  if (state.level?.dirty && !confirm('You have unsaved changes. Open another level anyway?')) return;
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
    document.getElementById('level-title').textContent = '— ' + entry.name;
    state.levelBrowser.setActive(entry.name);
    state.editor.setLevel(level);
    state.inspector.setObject(null);
    updateUndoButtons();
    setBusy(null);
  } catch (err) {
    setBusy(null);
    console.error(err);
    toast('Could not open level: ' + err.message, 'err', 6000);
  }
}

function newLevel() {
  const name = prompt('Level name (no spaces, e.g. my_custom_level):', 'my_custom_level');
  if (!name) return;
  const clean = name.trim().replace(/\s+/g, '_');
  const level = new Level(clean);
  level.terrain = Terrain.blank(DEFAULT_LEVEL_WIDTH, DEFAULT_LEVEL_HEIGHT);
  level.room = { x: 0, y: -30 };
  state.level = level;
  document.getElementById('canvas-empty').style.display = 'none';
  document.getElementById('level-title').textContent = '— ' + clean + ' (new)';
  state.editor.setLevel(level);
  state.inspector.setObject(null);
  toast('New level created. Paint terrain and add a spout + drain to make it playable.', 'ok', 5000);
}

function markDirty() {
  if (!state.level) return;
  state.level.dirty = true;
  document.getElementById('level-title').textContent = '— ' + state.level.name + ' •';
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
  document.getElementById('level-title').textContent = '— ' + state.level.name;
  toast('Saved into the loaded game tree. Use Export to get the files out.', 'ok');
}

function toggleExportMenu(e) {
  document.querySelector('.export-menu')?.remove();
  const menu = el('div', { class: 'export-menu' },
    menuItem('Level files (.xml + .png zip)', 'For dropping into assets/Levels in your APK.', () => {
      if (!state.level) return toast('Open a level first', 'err');
      downloadLevelZip(state.level);
    }),
    menuItem('Level .xml only', '', () => {
      if (!state.level) return toast('Open a level first', 'err');
      downloadBytes(levelToFiles(state.level).xml, state.level.name + '.xml', 'text/xml');
    }),
    menuItem('Level .png only', 'Indexed 8-bit, game-compatible.', () => {
      if (!state.level) return toast('Open a level first', 'err');
      downloadBytes(levelToFiles(state.level).png, state.level.name + '.png', 'image/png');
    }),
    menuItem('Whole assets tree (.zip)', 'Everything loaded, including your saved edits.', () => {
      setBusy('Packing assets…');
      setTimeout(() => { try { downloadAssetsZip(state.vfs, setBusy); } finally { setBusy(null); } }, 50);
    })
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

// ============================================================ boot

renderWelcome();
