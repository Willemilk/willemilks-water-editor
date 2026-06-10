// Rebuilds the game APK with the editor's modified assets baked in, ready for
// signing and installing on an emulator or device (the playtest pipeline).
//
// Two hard rules learned from real modding (a wrong choice segfaults the game):
//   1. META-INF/* (the old signature) must be stripped; the APK gets re-signed.
//   2. resources.arsc must be STORED uncompressed; everything else deflates fine.
import { unzipSync, zipSync } from 'fflate';

/**
 * @param {Uint8Array} apkBytes original APK
 * @param {VFS} vfs the loaded virtual file system with modifications
 * @param {(msg: string) => void} [onProgress]
 * @returns {Uint8Array} the new, unsigned APK
 */
export function rebuildApk(apkBytes, vfs, onProgress) {
  onProgress?.('Unpacking original APK…');
  const entries = unzipSync(apkBytes, {
    filter: (f) => !f.name.toUpperCase().startsWith('META-INF/'),
  });

  onProgress?.('Applying your edits…');
  let replaced = 0;
  for (const norm of vfs.modified) {
    const original = vfs.originalNames.get(norm);
    const bytes = vfs.files.get(norm);
    if (!original || !bytes) continue;
    // Match the existing entry path case-insensitively so we overwrite instead
    // of duplicating when the APK uses different casing.
    const existing = Object.keys(entries).find((k) => k.toLowerCase() === norm);
    entries[existing || original] = bytes;
    replaced++;
  }

  onProgress?.(`Repacking APK (${replaced} file${replaced === 1 ? '' : 's'} changed)…`);
  const zippable = {};
  for (const [name, data] of Object.entries(entries)) {
    const stored = name.toLowerCase() === 'resources.arsc';
    zippable[name] = [data, { level: stored ? 0 : 6 }];
  }
  return zipSync(zippable);
}

/** Count of pending modifications that a rebuild would include. */
export function modifiedCount(vfs) {
  return vfs?.modified?.size ?? 0;
}
