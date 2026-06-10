// Exposes a minimal, safe bridge between the native shell and the editor UI.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isApp: true,
  onMenu(callback) {
    ipcRenderer.on('menu', (_e, msg) => callback(msg));
  },
  openGame() {
    return ipcRenderer.invoke('open-game');
  },
  saveFile(defaultName, data) {
    // data: ArrayBuffer or Uint8Array
    const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
    return ipcRenderer.invoke('save-file', { defaultName, data: buf });
  },
});
