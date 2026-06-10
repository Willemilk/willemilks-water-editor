// Virtual file system over the game's assets.
// Accepts: a .zip containing assets/, a .zip containing a base.apk (nested unzip),
// a raw .apk, or a folder picked with webkitdirectory.
import { unzipSync } from 'fflate';

const TEXT_DECODER = new TextDecoder('utf-8');

export class VFS {
  constructor() {
    /** @type {Map<string, Uint8Array>} normalized lowercase path -> bytes */
    this.files = new Map();
    /** @type {Map<string, string>} normalized path -> original path */
    this.originalNames = new Map();
    this.sourceName = '';
  }

  static normalize(path) {
    return path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  _put(path, bytes) {
    const norm = VFS.normalize(path);
    this.files.set(norm, bytes);
    this.originalNames.set(norm, path.replace(/\\/g, '/').replace(/^\/+/, ''));
  }

  has(path) { return this.files.has(VFS.normalize(path)); }

  read(path) {
    const f = this.files.get(VFS.normalize(path));
    if (!f) throw new Error(`File not found in game assets: ${path}`);
    return f;
  }

  readText(path) { return TEXT_DECODER.decode(this.read(path)); }

  list(prefix, suffix = '') {
    const p = VFS.normalize(prefix);
    const s = suffix.toLowerCase();
    const out = [];
    for (const key of this.files.keys()) {
      if (key.startsWith(p) && key.endsWith(s)) out.push(this.originalNames.get(key));
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /** Resolve a game path like "/Objects/star.hs" relative to the assets root. */
  game(path) {
    return 'assets/' + path.replace(/^\/+/, '');
  }
}

function looksLikeZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/**
 * Ingest raw bytes of a zip/apk. Recursively unpacks nested .apk/.zip entries
 * (e.g. an Android backup zip that contains base.apk) and keeps only what the
 * editor needs (the assets/ tree) to save memory.
 */
function ingestZipBytes(vfs, bytes, depth = 0) {
  if (depth > 2) return;
  const entries = unzipSync(bytes, {
    filter(file) {
      const name = file.name.toLowerCase();
      if (name.endsWith('/')) return false;
      // Keep nested archives for recursion, and everything inside assets/.
      if (name.endsWith('.apk') || name.endsWith('.zip')) return true;
      if (name.includes('assets/')) return true;
      // Also allow a bare assets tree zipped without the assets/ prefix.
      return /(^|\/)(levels|objects|sprites|textures)\//.test(name);
    },
  });

  for (const [name, data] of Object.entries(entries)) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.apk') || (lower.endsWith('.zip') && looksLikeZip(data))) {
      ingestZipBytes(vfs, data, depth + 1);
      continue;
    }
    // Re-root anything at its assets/ segment so "foo/bar/assets/Levels/x.xml"
    // becomes "assets/Levels/x.xml".
    const idx = lower.indexOf('assets/');
    let stored = name;
    if (idx >= 0) {
      stored = name.slice(idx);
    } else {
      const m = lower.match(/(^|\/)(levels|objects|sprites|textures|data|fonts|curves|animations)\//);
      if (m) stored = 'assets/' + name.slice(m.index + (m[1] ? 1 : 0));
    }
    vfs._put(stored, data);
  }
}

/** @param {File} file */
export async function loadFromZipFile(file, onProgress) {
  const vfs = new VFS();
  vfs.sourceName = file.name;
  onProgress?.('Reading file…');
  const buf = new Uint8Array(await file.arrayBuffer());
  onProgress?.('Unpacking archive…');
  ingestZipBytes(vfs, buf);
  validate(vfs);
  return vfs;
}

/** @param {FileList|File[]} files from an <input webkitdirectory> */
export async function loadFromFolder(files, onProgress) {
  const vfs = new VFS();
  const arr = Array.from(files);
  vfs.sourceName = arr[0]?.webkitRelativePath?.split('/')[0] || 'folder';
  let done = 0;
  for (const f of arr) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const lower = rel.toLowerCase();
    if (lower.endsWith('.apk') || lower.endsWith('.zip')) {
      const buf = new Uint8Array(await f.arrayBuffer());
      if (looksLikeZip(buf)) ingestZipBytes(vfs, buf);
    } else {
      const idx = lower.indexOf('assets/');
      let stored = rel;
      if (idx >= 0) stored = rel.slice(idx);
      else {
        const m = lower.match(/(^|\/)(levels|objects|sprites|textures|data|fonts|curves|animations)\//);
        if (m) stored = 'assets/' + rel.slice(m.index + (m[1] ? 1 : 0));
        else { done++; continue; }
      }
      vfs._put(stored, new Uint8Array(await f.arrayBuffer()));
    }
    done++;
    if (done % 200 === 0) onProgress?.(`Reading files… ${done}/${arr.length}`);
  }
  validate(vfs);
  return vfs;
}

function validate(vfs) {
  const levels = vfs.list('assets/levels/', '.xml');
  if (levels.length === 0) {
    throw new Error(
      'No levels found. Make sure your zip/folder contains the game\'s "assets" directory ' +
      '(it can also be a zip that contains base.apk — that works too).'
    );
  }
}

/** All levels: pairs of .xml (+ optional .png) inside assets/Levels. */
export function listLevels(vfs) {
  const xmls = vfs.list('assets/levels/', '.xml');
  return xmls
    .filter((p) => !p.toLowerCase().endsWith('.xml.bak'))
    .map((p) => {
      const base = p.slice(p.lastIndexOf('/') + 1, -4);
      const png = p.slice(0, -4) + '.png';
      return { name: base, xmlPath: p, pngPath: vfs.has(png) ? png : null };
    });
}
