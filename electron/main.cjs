// Willemilks Water Editor: Electron main process.
// Native window, application menu (File / Edit / View / Help) and file dialogs.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

let win = null;

function send(action, payload) {
  win?.webContents.send('menu', { action, payload });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Game Files…', accelerator: 'CmdOrCtrl+O', click: () => openGameDialog() },
        { label: 'New Level…', accelerator: 'CmdOrCtrl+N', click: () => send('new-level') },
        { label: 'Reopen Last Game Files', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('open-recent') },
        { type: 'separator' },
        { label: 'Save Level', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => send('save') },
        { label: 'Playtest on Device…', accelerator: 'F5', click: () => send('playtest') },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => send('settings') },
        {
          label: 'Export',
          submenu: [
            { label: 'Level as Zip (.xml + .png)', click: () => send('export-level-zip') },
            { label: 'Level XML only', click: () => send('export-xml') },
            { label: 'Terrain PNG only', click: () => send('export-png') },
            { type: 'separator' },
            { label: 'Whole Assets Folder as Zip', click: () => send('export-assets') },
          ],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', registerAccelerator: false, click: () => send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', registerAccelerator: false, click: () => send('redo') },
        { type: 'separator' },
        { label: 'Duplicate Object', accelerator: 'CmdOrCtrl+D', registerAccelerator: false, click: () => send('duplicate') },
        { label: 'Delete Object', accelerator: 'Delete', registerAccelerator: false, click: () => send('delete') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => send('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => send('zoom-out') },
        { label: 'Fit Level', accelerator: 'CmdOrCtrl+0', click: () => send('fit') },
        { type: 'separator' },
        { label: 'Grid', type: 'checkbox', checked: false, click: () => send('toggle-grid') },
        { label: 'Collision Shapes', type: 'checkbox', checked: false, click: () => send('toggle-collision') },
        { label: 'Motor Paths', type: 'checkbox', checked: true, click: () => send('toggle-paths') },
        { label: 'Smart Terrain Painting', type: 'checkbox', checked: true, click: () => send('toggle-smartrock') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Interactive Tutorial', click: () => send('tutorial') },
        { label: 'Keyboard Shortcuts', click: () => send('shortcuts') },
        { type: 'separator' },
        { label: 'Project on GitHub', click: () => shell.openExternal('https://github.com/Willemilk/willemilks-water-editor') },
        {
          label: 'About',
          click: () =>
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About',
              message: 'Willemilks Water Editor',
              detail: `Version ${app.getVersion()}\nA level editor for Where's My Water with full terrain painting.\nBuilt by Willemilk.`,
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openGameDialog() {
  if (!win) return;
  const result = await dialog.showOpenDialog(win, {
    title: 'Open Where\'s My Water game files',
    filters: [
      { name: 'Game package (apk or zip)', extensions: ['apk', 'zip', 'xapk'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return;
  const filePath = result.filePaths[0];
  try {
    const data = fs.readFileSync(filePath);
    send('open-game-data', {
      name: path.basename(filePath),
      buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    });
  } catch (err) {
    dialog.showErrorBox('Could not read file', String(err));
  }
}

ipcMain.handle('open-game', () => openGameDialog());

// ---------------- playtest pipeline ----------------
// Receives the rebuilt APK bytes from the renderer, then: sign with
// uber-apk-signer, adb connect (MuMu), install, and launch the game.

function logTo(kind, line) {
  win?.webContents.send('playtest-log', { kind, line });
}

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    logTo('step', `${label}`);
    logTo('cmd', [cmd, ...args].join(' '));
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      reject(new Error(`${label} failed to start: ${err.message}`));
      return;
    }
    let out = '';
    const onData = (d) => {
      const text = d.toString();
      out += text;
      for (const ln of text.split(/\r?\n/)) if (ln.trim()) logTo('out', ln.trim());
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => reject(new Error(`${label}: ${err.message} (is the path in Settings correct?)`)));
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

ipcMain.handle('playtest', async (_e, { apk, settings }) => {
  const s = settings || {};
  const java = s.javaPath || 'java';
  const adb = s.adbPath || 'adb';
  const device = s.deviceAddr || '';
  const pkg = s.packageName || 'com.disney.WMW';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wwe-playtest-'));
  const unsigned = path.join(tmp, 'wwe-unsigned.apk');
  try {
    logTo('step', 'Writing APK to disk…');
    fs.writeFileSync(unsigned, Buffer.from(apk));

    if (!s.signerJar) throw new Error('Set the path to uber-apk-signer.jar in Settings first.');
    await run(java, ['-jar', s.signerJar, '--apks', unsigned, '--out', tmp, '--allowResign'], 'Signing APK');
    const signed = fs.readdirSync(tmp).map((f) => path.join(tmp, f))
      .find((f) => f.endsWith('.apk') && f !== unsigned && /signed/i.test(f));
    if (!signed) throw new Error('Signer finished but no signed APK was found in ' + tmp);

    if (device.includes(':')) {
      try { await run(adb, ['connect', device], 'Connecting to emulator'); }
      catch { logTo('out', 'adb connect failed, trying install anyway…'); }
    }
    const target = device ? ['-s', device] : [];
    try {
      await run(adb, [...target, 'install', '-r', signed], 'Installing on device');
    } catch (err) {
      // signature mismatch with a previously installed copy: uninstall once and retry
      logTo('out', 'Install failed, trying uninstall + clean install (one time)…');
      await run(adb, [...target, 'uninstall', pkg], 'Uninstalling old version').catch(() => {});
      await run(adb, [...target, 'install', signed], 'Installing on device (clean)');
    }
    await run(adb, [...target, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'], 'Launching game');
    logTo('done', 'Playtest build is running. Have fun!');
    return { ok: true };
  } catch (err) {
    logTo('error', String(err.message || err));
    return { ok: false, error: String(err.message || err) };
  } finally {
    setTimeout(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }, 60_000);
  }
});

ipcMain.handle('read-file', async (_e, filePath) => {
  const data = fs.readFileSync(filePath);
  return { name: path.basename(filePath), buffer: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
});

ipcMain.handle('pick-path', async (_e, { title, filters }) => {
  const result = await dialog.showOpenDialog(win, { title, filters, properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('save-file', async (_e, { defaultName, data }) => {
  const result = await dialog.showSaveDialog(win, { defaultPath: defaultName });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, Buffer.from(data));
  return true;
});

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0d1117',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
