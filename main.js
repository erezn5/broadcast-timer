const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');
const { TimeService } = require('./time-service');

const CLOCK_SETTINGS_FILE = 'clock-settings.json';
const DEFAULT_CLOCK_SETTINGS = Object.freeze({
  ntpServer: 'pool.ntp.org',
  autoSyncOnStartup: false
});

function sanitizeClockSettings(rawSettings) {
  const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const ntpServer = typeof settings.ntpServer === 'string' ? settings.ntpServer.trim() : '';
  const autoSyncOnStartup = settings.autoSyncOnStartup === true;
  return { ntpServer, autoSyncOnStartup };
}

async function getClockSettingsPath() {
  return path.join(app.getPath('userData'), CLOCK_SETTINGS_FILE);
}

async function loadClockSettings() {
  const settingsPath = await getClockSettingsPath();

  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    return sanitizeClockSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { ...DEFAULT_CLOCK_SETTINGS };
    }
    throw error;
  }
}

async function saveClockSettings(rawSettings) {
  let currentSettings = { ...DEFAULT_CLOCK_SETTINGS };
  try {
    currentSettings = await loadClockSettings();
  } catch (_error) {
    currentSettings = { ...DEFAULT_CLOCK_SETTINGS };
  }

  const mergedSettings = {
    ...currentSettings,
    ...(rawSettings && typeof rawSettings === 'object' ? rawSettings : {})
  };
  const nextSettings = sanitizeClockSettings(mergedSettings);
  const settingsPath = await getClockSettingsPath();
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  return nextSettings;
}

const timeService = new TimeService({
  defaultServer: DEFAULT_CLOCK_SETTINGS.ntpServer,
  timeoutMs: 3000
});

function registerTimeIpcHandlers() {
  ipcMain.handle('time:sync-ntp', async (_event, payload) => {
    const server = payload && typeof payload === 'object' ? payload.server : payload;
    return timeService.syncWithNtp(server);
  });

  ipcMain.handle('time:get-current-app-time', async () => {
    return timeService.getCurrentAppTime();
  });

  ipcMain.handle('time:use-local-time', async () => {
    return timeService.useLocalTime();
  });

  ipcMain.handle('time:get-mode', async () => {
    return timeService.getMode();
  });

  ipcMain.handle('time:get-status', async () => {
    return timeService.getStatus();
  });

  ipcMain.handle('time:get-settings', async () => {
    return loadClockSettings();
  });

  ipcMain.handle('time:save-settings', async (_event, payload) => {
    const saved = await saveClockSettings(payload);
    timeService.configure(saved);
    return saved;
  });

  // Backward compatibility with existing renderer code paths.
  ipcMain.handle('clock:load-settings', async () => loadClockSettings());
  ipcMain.handle('clock:save-settings', async (_event, payload) => {
    const saved = await saveClockSettings(payload);
    timeService.configure(saved);
    return saved;
  });
  ipcMain.handle('clock:query-ntp', async (_event, payload) => {
    const server = payload && typeof payload === 'object' ? payload.server : payload;
    return timeService.syncWithNtp(server);
  });
}

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

app.whenReady().then(async () => {
  try {
    const settings = await loadClockSettings();
    timeService.configure(settings);

    if (settings.autoSyncOnStartup === true) {
      await timeService.syncWithNtp(settings.ntpServer);
    } else {
      timeService.useLocalTime();
    }
  } catch (error) {
    const reason = error && error.message ? error.message : 'Unknown settings error';
    console.error(`[TimeService] failed to initialize from settings: ${reason}`);
    timeService.useLocalTime();
  }

  registerTimeIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
