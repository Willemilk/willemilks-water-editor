# 💧 Willemilks Water Editor

A modern, browser-based level editor for **Where's My Water?** — built to do the one thing
[Where's My Editor (WME)](https://github.com/wmw-modding/wheres-my-editor) can't: **edit the terrain.**

Everything runs 100% client-side. No install, no Python, no server — drop your game files in and edit.

![editor](docs/screenshot.png)

## Features

**Terrain editing (the headline)**
- Paint terrain directly with Pencil, Line, Rectangle, Fill bucket, Eraser and Material picker
- The official material palette, extracted from the game's own `LevelEditor.psd`:
  Empty, Dirt, Algae, Rock (+ shadow/highlight), Water, Poison, Ooze, Swampy's Room
- Adjustable brush size (1–9 px), pixel-perfect nearest-neighbor zoom up to 40×
- Saves as **8-bit indexed PNG** exactly like the originals (auto-falls back to truecolor if you
  somehow use >256 colors) — verified pixel-perfect against real game levels

**Object editing (everything WME does, and more)**
- Live sprite rendering straight from the game's `.hs → .sprite → .imagelist → .webp` chain,
  with correct rotation, flipping and grid scaling (1 grid unit = 1.25 terrain px, center origin)
- Object browser with thumbnails for all ~345 game objects, grouped by category, searchable
- Click-to-place, drag-to-move (Shift = snap), arrow-key nudging, duplicate (Ctrl+D), delete
- Full property inspector with suggestions from the game's own `_level_properties_doc.txt`
  (Spouts, Motors, Pins, Switches, Bombs, GravityScale, FluidType, timers…)
- **Motor path editing**: drag the numbered waypoints, add/remove points, `PathIsGlobal` aware
- Room marker (Swampy's bathtub position) shown and draggable
- Level-wide properties + a material histogram of the open level

**Quality of life**
- Snapshot **undo/redo for everything** — terrain strokes and object edits alike (Ctrl+Z / Ctrl+Y)
- Grid overlay, collision-shape overlay, fit-to-view, keyboard shortcuts for every tool
- Skippable interactive tutorial on first launch (re-open it anytime with the **?** button)
- Create brand-new empty levels from scratch
- Export: single level as zip, `.xml` only, `.png` only, or the **entire modified `assets/` tree** as
  one zip ready for repacking

## Getting started

```bash
npm install
npm run dev      # → http://localhost:5173
```

Then drop one of these onto the welcome screen:
- your `base.apk` (`com.disney.WMW`)
- a zip that *contains* the apk (nested archives are unpacked automatically)
- or pick the extracted game folder (the one containing `assets/`)

Pick a level (try `first_dig`), paint, place objects, save.

> Everything stays in your browser's memory. **Save** writes into the loaded virtual game tree;
> **Export** downloads files to disk. Nothing is uploaded anywhere.

## Getting your edits into the game

The editor produces a game-compatible `levelname.xml` + `levelname.png` pair (or a full
`assets/` zip). Repack with the usual workflow:

1. Export your level (or the whole assets zip)
2. Copy the files over the originals in your unpacked APK folder (`assets/Levels/`)
3. Rebuild + sign + install — e.g. the `mod.bat` flow:
   7-Zip repack (deflate, `resources.arsc` stored uncompressed) → `uber-apk-signer` → `adb install`
4. Hard rules the editor already enforces for you: keep the PNG dimensions identical to the
   original and stick to the official material colors — that's what prevents the native segfault

## Tech

Vite + vanilla ES modules, zero framework. [`fflate`](https://github.com/101arrowz/fflate) for
zip/apk reading and writing, browser-native WebP decoding for sprite atlases, HTML canvas for
rendering, and a tiny hand-rolled indexed-PNG encoder (CRC32 + zlib via fflate).

```
src/
  core/   vfs (zip/apk → virtual fs) · level (XML + undo) · terrain (paint ops)
          objects (.hs/.sprite/.imagelist resolver) · png (indexed encoder) · coords · export
  ui/     editor (canvas, tools, input) · panels (browsers + inspector) · tutorial
  data/   materials (official palette)
```

Format knowledge is based on the community work of
[wmw-modding](https://github.com/wmw-modding) (WME & wmwpy) plus direct analysis of the game
files — the developer-left `LevelEditor.psd` and `_level_properties_doc.txt` were gold.

## Build

```bash
npm run build    # → dist/ (static, host anywhere: Vercel, GitHub Pages…)
```

## License

MIT — see [LICENSE](LICENSE). Game assets are © Disney; bring your own legally obtained copy.
