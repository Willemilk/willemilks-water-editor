// Exposes a minimal, safe bridge between the native shell and the editor UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isApp: true,
  onMenu(callback) {
    ipcRenderer.on('menu', (_e, msg) => callback(msg));
  },
  onPlaytestLog(callback) {
    ipcRenderer.on('playtest-log', (_e, msg) => callback(msg));
  },
  openGame() {
    return ipcRenderer.invoke('open-game');
  },
  readFile(filePath) {
    return ipcRenderer.invoke('read-file', filePath);
  },
  pickPath(title, filters) {
    return ipcRenderer.invoke('pick-path', { title, filters });
  },
  playtest(apkBytes, settings) {
    const buf = apkBytes instanceof Uint8Array ? apkBytes : new Uint8Array(apkBytes);
    return ipcRenderer.invoke('playtest', { apk: buf, settings });
  },
  saveFile(defaultName, data) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    return ipcRenderer.invoke('save-file', { defaultName, data: buf });
  },
  /** Keep a native menu checkbox in sync with the in app toolbar state. */
  syncMenu(id, checked) {
    ipcRenderer.send('menu-state', { id, checked });
  },
  /** Store the loaded APK in userData so the next session resumes in one click. */
  cacheApk(name, data) {
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    return ipcRenderer.invoke('cache-apk', { name, data: buf });
  },
  cachedApkMeta() {
    return ipcRenderer.invoke('cached-apk-meta');
  },
  readCachedApk() {
    return ipcRenderer.invoke('read-cached-apk');
  },
});
