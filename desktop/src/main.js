const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');

const ONLINE_URL = process.env.CITYRAIL_DESKTOP_URL || 'https://cityrailgame.com/?client=desktop';
const RELEASE_MANIFEST = process.env.CITYRAIL_RELEASE_MANIFEST || 'https://cityrailgame.com/releases/latest.json';

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#020B18',
    title: 'CityRail 轨道交通模拟器',
    webPreferences: {
      preload: require('path').join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(ONLINE_URL).catch(() => {
    mainWindow.loadFile(require('path').join(__dirname, 'offline.html'));
  });
}

function configureUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.on('update-available', info => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现客户端更新',
      message: '发现新的 CityRail 桌面客户端。',
      detail: `版本：${info.version || 'latest'}。在线内容会自动保持最新，客户端更新用于改进桌面壳。`,
      buttons: ['稍后', '下载更新'],
      defaultId: 1
    }).then(result => {
      if (result.response === 1) autoUpdater.downloadUpdate().catch(() => {});
    });
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新已下载',
      message: '重启后完成客户端更新。',
      buttons: ['稍后', '立即重启'],
      defaultId: 1
    }).then(result => {
      if (result.response === 1) autoUpdater.quitAndInstall();
    });
  });
  autoUpdater.checkForUpdates().catch(() => {});
}

ipcMain.handle('cityrail:get-release-manifest', async () => {
  const response = await fetch(RELEASE_MANIFEST, { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest ${response.status}`);
  return response.json();
});

ipcMain.handle('cityrail:reload-online', async () => {
  if (mainWindow) await mainWindow.loadURL(ONLINE_URL);
  return true;
});

app.whenReady().then(() => {
  createWindow();
  configureUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
