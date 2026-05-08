const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const win = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(980, height),
    minWidth: 760,
    minHeight: 640,
    icon: path.join(__dirname, 'assets', 'icons', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#05070d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.maximize();
  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
