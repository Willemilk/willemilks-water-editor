# CLAUDE.md — Willemilks Water Editor

Development context for AI assisted sessions. Read this before touching code.

## What this is
A fully working desktop Electron app (plus browser mode) to edit Where's My Water? levels,
including terrain painting. Crown jewel: edit a level → Playtest button (F5) → the APK is
rebuilt in memory, signed with uber-apk-signer, installed over adb and the game launches on
the MuMu emulator with the edits in it. VERIFIED WORKING ON REAL HARDWARE. Do not break it.

## Tech stack
- Electron 33 + Vite 7 + vanilla JS ES modules. No framework. Do not add React/Vue.
- fflate for zip/apk read and write, all in memory.
- Custom dark CSS theme in src/styles.css, CSS variables for every color.
- `el()` (src/ui/panels.js) is the DOM builder. `t()` (src/i18n.js) is i18n.
- `getPref`/`setPref` (src/i18n.js) persist preferences via localStorage.

## Critical architecture (do not change)
- COORDINATE SYSTEM: center origin, Y up, `GRID_TO_PX = 1.25` (src/core/coords.js).
  worldToImg: x = w/2 + wx*1.25, y = h/2 − wy*1.25. Verified visually against real levels.
- PNG ENCODER (src/core/png.js): custom 8 bit indexed, verified pixel perfect vs originals.
  Falls back to truecolor above 256 colors.
- APK REBUILD (src/core/apk.js): strips META-INF/*, keeps resources.arsc STORED
  (uncompressed) — deflating it crashes the game natively. Untouched files stay byte identical.
- Terrain materials are identified by exact RGB (src/data/materials.js). MATERIAL_ALIASES
  maps shipped color variants (e.g. 112,91,49 → dirt, 41,41,41 → rock shadow).

## Commands
```
npm run dev      # browser mode at localhost:5173
npm run app      # vite build + launch Electron
npm run build    # vite build only (must stay green)
npm run dist     # Windows installer + portable exe in release/
```
Releases: push a tag `vX.Y.Z` → GitHub Actions (.github/workflows/release.yml) builds and
publishes the exes automatically.

## File map
```
src/main.js            app entry: welcome screen, editor shell, settings, playtest UI
src/i18n.js            translations (EN/NL/ES/ZH, ~200 keys) + prefs
src/styles.css         all CSS
src/core/vfs.js        zip/apk → virtual filesystem (Map), nested archives unpacked
src/core/level.js      level XML parse/serialize, LevelObject, snapshot undo/redo (cap 100)
src/core/terrain.js    pixel buffer, paint ops, smart rock rim pass
src/core/apk.js        APK rebuild (verified against real base.apk)
src/core/objects.js    .hs → .sprite → .imagelist → .webp resolver + categorize()
src/core/png.js        custom indexed PNG encoder
src/core/coords.js     coordinate math
src/core/export.js     level zip / xml / png / whole assets tree download
src/ui/editor.js       canvas: tools, zoom/pan, drag, paths, connection overlay
src/ui/panels.js       el(), LevelBrowser, ObjectBrowser, Inspector (smart sections)
src/ui/tutorial.js     spotlight tour (i18n keys tut.s0..s6) + toast()
src/data/materials.js  official palette + aliases
src/data/levelOrder.json  real in game world order (from water.db)
electron/main.cjs      menus (items have ids for sync), dialogs, playtest pipeline, APK cache
electron/preload.cjs   contextBridge: window.native.*
```

## Object inspector (smart sections)
`Inspector._objectKind(obj)` classifies by Filename/Type/properties into:
spout, bomb, fan, vacuum, balloon, switch, converter, ypipe, brokenpipe, teleport,
sprinkler, motor, ray (temperatureray: hot/cold/sludge/matter/turf), generator,
collectible (star/duck GnomeType), pipe, mirror, generic. Each kind gets a quick editor
section writing real game properties (BlastRadius, VacuumMaxForce, VacuumFriction,
TemperatureType, GnomeType, AllowedFluids, MotorTurnSpeed/MotorWaitTurn/MotorEase,
ExpulsionAngle, HasString, ConnectedObject0…, etc.). Checkboxes read the object's .hs
defaults so e.g. a balloon shows HasString on even when the level never authored it. A
vacuum drain keeps its niche drain/output props in Advanced (just a note in the panel).

GROUPS (v1.4.1): switch type (flip vs momentary) is intrinsic to the placed object
(switch.hs vs switch_momentary.hs, never authored in levels) so it is shown read only, not
a dropdown. A switch/generator drives a color coded "group" = its ConnectedObjectN targets
(`_groupMembersBlock`). Controllable objects (fan/vacuum/motor) show a "Controlled by" block
at the top (`_controlledByBlock`, reverse scan of who points at this object). The empty
inspector shows a `_groupsOverview` menu of every group. `groupColor(name)` in coords.js
gives a stable palette color per controller name, reused by the inspector chips and the
canvas arrows. The "on without a switch" toggles are VacuumOn/MotorOn.
Connections: `cb.onPickConnection(obj, propName)` writes the clicked target's name into the
property; `cb.onPickController(target)` is the reverse (clicked switch/generator gets target
appended to its next ConnectedObjectN). The canvas draws dashed arrows for all `Connected*`
properties, switch/generator → object arrows colored per group (toggle: Connections).

## Known gotchas
- window.prompt() does not work in Electron → use modalPrompt() in src/main.js.
- After Terrain.fromPNGBytes, capture bmp.width/height BEFORE bmp.close() (Chrome returns 0 after).
- File.path does not exist in Electron 32+ → session resume uses the APK cache in userData
  (IPC: cache-apk / cached-apk-meta / read-cached-apk).
- Native menu checkboxes sync via `window.native.syncMenu(menuId, checked)`
  (ids: menu-grid, menu-collision, menu-paths, menu-conns, menu-smart).
- renderEditor() can run multiple times per session: window listeners are named and
  re-registered, the old Editor instance is dispose()d.
- New i18n keys must be added to ALL FOUR languages (parity is checked, ~200 keys each).
- Keep dashes out of user facing UI strings (owner preference).

## Credits (required, GPL-3.0 upstream)
- WME by wmw-modding: github.com/wmw-modding/wheres-my-editor
- wmwpy by wmw-modding: github.com/wmw-modding/wmwpy
- Game assets © Disney — the editor only loads the user's own copy, never ships assets.
