// Saving & exporting: write XML + PNG back into the virtual game tree and
// download them individually or as a zip ready for an APK rebuild workflow.
import { zipSync } from 'fflate';
import { encodePNG } from './png.js';

const TEXT_ENCODER = new TextEncoder();

export function levelToFiles(level) {
  const xml = TEXT_ENCODER.encode(level.serializeXML());
  const png = encodePNG(level.terrain.data, level.terrain.width, level.terrain.height);
  return { xml, png };
}

/** Persist into the in-memory game tree so a later "Export game zip" includes it. */
export function saveIntoVFS(vfs, level) {
  const { xml, png } = levelToFiles(level);
  const xmlPath = level.xmlPath || `assets/Levels/${level.name}.xml`;
  const pngPath = level.pngPath || `assets/Levels/${level.name}.png`;
  vfs._put(xmlPath, xml);
  vfs._put(pngPath, png);
  level.xmlPath = xmlPath;
  level.pngPath = pngPath;
  level.dirty = false;
}

export function downloadBytes(bytes, filename, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Download just this level as <name>.zip containing the xml + png pair. */
export function downloadLevelZip(level) {
  const { xml, png } = levelToFiles(level);
  const zip = zipSync({
    [`${level.name}.xml`]: xml,
    [`${level.name}.png`]: png,
  }, { level: 6 });
  downloadBytes(zip, `${level.name}.zip`, 'application/zip');
}

/** Download the entire (possibly modified) assets tree as a zip. */
export function downloadAssetsZip(vfs, onProgress) {
  const tree = {};
  let n = 0;
  for (const norm of vfs.files.keys()) {
    const original = vfs.originalNames.get(norm);
    tree[original] = vfs.files.get(norm);
    if (++n % 500 === 0) onProgress?.(`Packing… ${n} files`);
  }
  const zip = zipSync(tree, { level: 1 });
  downloadBytes(zip, 'wmw-assets-modified.zip', 'application/zip');
}
