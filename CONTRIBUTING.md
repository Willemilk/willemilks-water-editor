# Contributing

Thanks for your interest! This project is a level editor for Where's My Water? with full
terrain painting and a one click playtest pipeline.

## Dev setup

```bash
npm install
npm run dev      # browser mode at http://localhost:5173
npm run app      # desktop app (vite build + electron)
npm run build    # production build — must stay green
```

Drop a `base.apk` (or a zip containing one, or the extracted game folder) onto the welcome
screen to load game files. Nothing is bundled with the editor and nothing leaves your machine.

## Architecture in 60 seconds

- **Coordinates**: levels use a center origin, Y up world space. 1 grid unit = 1.25 terrain
  pixels (`GRID_TO_PX` in `src/core/coords.js`). Never change this — it is verified against
  the real game.
- **Terrain**: an RGBA pixel buffer (`src/core/terrain.js`) saved as 8 bit indexed PNG by a
  hand rolled encoder (`src/core/png.js`), pixel perfect vs the originals.
- **APK rebuild** (`src/core/apk.js`): strips the old signature, keeps `resources.arsc`
  uncompressed (STORED) — compressing it crashes the game. Untouched files stay byte identical.
- **UI**: vanilla JS. `el()` in `src/ui/panels.js` builds DOM, `t()` in `src/i18n.js`
  translates. No framework, please keep it that way.

## Adding a language

Add a new block to `D` in `src/i18n.js` and a `[code, name]` entry to `LANGS`. Every key
from the `en` block must exist in your language (about 200 keys). Check parity before a PR.

## Adding a material

Add it to `MATERIALS` in `src/data/materials.js` (exact RGB from the game's
`LevelEditor.psd`) and add known color variants to `MATERIAL_ALIASES`.

## Pull request checklist

- `npm run build` passes with no errors
- New UI strings go through `t()` and exist in all four languages
- The playtest pipeline still works (load apk → edit → Playtest)
- No new heavy dependencies
- User facing text avoids dashes (style preference of the project)

## Credits

Format knowledge builds on [WME](https://github.com/wmw-modding/wheres-my-editor) and
[wmwpy](https://github.com/wmw-modding/wmwpy) by the wmw-modding team (GPL-3.0).
Game assets are © Disney; never commit or distribute them.
