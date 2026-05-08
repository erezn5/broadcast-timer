const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const fs = require('node:fs/promises');
const dgram = require('node:dgram');

const CLOCK_SETTINGS_FILE = 'clock-settings.json';
const DEFAULT_CLOCK_SETTINGS = Object.freeze({
  ntpServer: ''
});

function sanitizeClockSettings(rawSettings) {
  const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  const ntpServer = typeof settings.ntpServer === 'string'
    ? settings.ntpServer.trim()
    : '';

  return { ntpServer };
}

function parsePort(rawPort) {
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('NTP port must be between 1 and 65535.');
  }
  return parsed;
}

function parseNtpTarget(rawTarget) {
  const target = String(rawTarget || '').trim();
  if (!target) {
    throw new Error('NTP server address is required.');
  }

  if (/\s/.test(target)) {
    throw new Error('NTP server address must not contain spaces.');
  }

  let host = target;
  let port = 123;

  if (target.includes('://')) {
    let parsedUrl;
    try {
      parsedUrl = new URL(target);
    } catch (_error) {
      throw new Error('Invalid NTP server URL.');
    }

    if (!parsedUrl.hostname) {
      throw new Error('NTP server host is missing.');
    }

    host = parsedUrl.hostname;
    if (parsedUrl.port) {
      port = parsePort(parsedUrl.port);
    }
  } else if (target.startsWith('[')) {
    const bracketEnd = target.indexOf(']');
    if (bracketEnd === -1) {
      throw new Error('Invalid IPv6 NTP server format.');
    }

    host = target.slice(1, bracketEnd).trim();
    const remainder = target.slice(bracketEnd + 1);
    if (remainder.length > 0) {
      if (!remainder.startsWith(':')) {
        throw new Error('Invalid NTP server format.');
      }
      port = parsePort(remainder.slice(1));
    }
  } else {
    const pieces = target.split(':');
    if (pieces.length === 2 && /^\d{1,5}$/.test(pieces[1])) {
      host = pieces[0];
      port = parsePort(pieces[1]);
    }
  }

  if (!host) {
    throw new Error('NTP server host is missing.');
  }

  return { host, port };
}

function readNtpTimestampMs(buffer, startOffset) {
  const seconds = buffer.readUInt32BE(startOffset);
  const fractions = buffer.readUInt32BE(startOffset + 4);
  const ntpEpochSeconds = seconds - 2208988800;
  return (ntpEpochSeconds * 1000) + Math.round((fractions * 1000) / 0x100000000);
}

function queryNtpServer({ host, port }, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const packet = Buffer.alloc(48);
    packet[0] = 0x1B;

    const socketType = host.includes(':') ? 'udp6' : 'udp4';
    const socket = dgram.createSocket(socketType);
    const sentAtMs = Date.now();

    let finished = false;

    const finish = (callback, payload) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeoutId);
      socket.removeAllListeners();
      socket.close();
      callback(payload);
    };

    const timeoutId = setTimeout(() => {
      finish((error) => reject(error), new Error('NTP request timed out.'));
    }, timeoutMs);

    socket.on('error', (error) => {
      finish((err) => reject(err), error);
    });

    socket.on('message', (message) => {
      if (!Buffer.isBuffer(message) || message.length < 48) {
        finish((error) => reject(error), new Error('Invalid NTP response payload.'));
        return;
      }

      const receivedAtMs = Date.now();
      const serverTimeMs = readNtpTimestampMs(message, 40);
      const roundTripMs = Math.max(0, receivedAtMs - sentAtMs);
      const offsetMs = (serverTimeMs + (roundTripMs / 2)) - receivedAtMs;

      finish((result) => resolve(result), {
        host,
        port,
        offsetMs,
        roundTripMs,
        serverTimeMs
      });
    });

    socket.send(packet, 0, packet.length, port, host, (error) => {
      if (error) {
        finish((err) => reject(err), error);
      }
    });
  });
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
  const nextSettings = sanitizeClockSettings(rawSettings);
  const settingsPath = await getClockSettingsPath();

  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  return nextSettings;
}

function registerClockIpcHandlers() {
  ipcMain.handle('clock:load-settings', async () => {
    return loadClockSettings();
  });

  ipcMain.handle('clock:save-settings', async (_event, payload) => {
    return saveClockSettings(payload);
  });

  ipcMain.handle('clock:query-ntp', async (_event, payload) => {
    const server = payload && typeof payload === 'object'
      ? payload.server
      : payload;
    const target = parseNtpTarget(server);
    return queryNtpServer(target);
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

app.whenReady().then(() => {
  registerClockIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
