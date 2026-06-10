// Willemilks Water Editor: Electron main process.
// Native window, application menu (File / Edit / View / Help) and file dialogs.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

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
        { type: 'separator' },
        { label: 'Save Level', accelerator: 'CmdOrCtrl+S', registerAccelerator: false, click: () => send('save') },
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
        { label: 'Smart Rock Painting', type: 'checkbox', checked: true, click: () => send('toggle-smartrock') },
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
