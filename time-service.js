const dgram = require('node:dgram');

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_SERVER = 'pool.ntp.org';

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

function queryNtpServer({ host, port }, timeoutMs = DEFAULT_TIMEOUT_MS) {
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

class TimeService {
  constructor(options = {}) {
    this.defaultServer = options.defaultServer || DEFAULT_SERVER;
    this.timeoutMs = Number.isInteger(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    this.mode = 'local';
    this.offsetMs = 0;
    this.ntpServer = this.defaultServer;
    this.lastSyncAt = null;
    this.lastSyncServer = null;
    this.lastRoundTripMs = null;
    this.lastError = null;
    this.syncInFlight = false;
    this.autoSyncOnStartup = false;
    this.logLocalMode('initial');
  }

  configure(options = {}) {
    if (typeof options.ntpServer === 'string') {
      const normalized = options.ntpServer.trim();
      this.ntpServer = normalized || this.defaultServer;
    }

    if (typeof options.autoSyncOnStartup === 'boolean') {
      this.autoSyncOnStartup = options.autoSyncOnStartup;
    }
  }

  now() {
    const baseNow = Date.now();
    if (this.mode === 'ntp') {
      return new Date(baseNow + this.offsetMs);
    }
    return new Date(baseNow);
  }

  async syncWithNtp(serverOverride) {
    const candidateServer = String(serverOverride || this.ntpServer || this.defaultServer).trim();
    const server = candidateServer || this.defaultServer;
    this.syncInFlight = true;
    this.lastError = null;

    console.info(`[TimeService] NTP sync started | server=${server}`);

    try {
      const target = parseNtpTarget(server);
      const result = await queryNtpServer(target, this.timeoutMs);
      this.offsetMs = Number.isFinite(result.offsetMs) ? result.offsetMs : 0;
      this.mode = 'ntp';
      this.lastSyncAt = new Date().toISOString();
      this.lastSyncServer = server;
      this.lastRoundTripMs = Number.isFinite(result.roundTripMs) ? Math.round(result.roundTripMs) : null;
      this.lastError = null;

      console.info(`[TimeService] NTP sync succeeded | server=${server}`);
      console.info(`[TimeService] current offset ms=${Math.round(this.offsetMs)}`);

      return {
        ok: true,
        mode: this.mode,
        offsetMs: this.offsetMs,
        server,
        roundTripMs: this.lastRoundTripMs,
        syncedAt: this.lastSyncAt
      };
    } catch (error) {
      const reason = error && error.message ? error.message : 'Unknown NTP error';
      this.mode = 'local';
      this.offsetMs = 0;
      this.lastError = reason;
      this.lastRoundTripMs = null;
      console.error(`[TimeService] NTP sync failed | server=${server} | error=${reason}`);
      this.logLocalMode('fallback-after-failure');

      return {
        ok: false,
        mode: this.mode,
        offsetMs: this.offsetMs,
        server,
        error: reason
      };
    } finally {
      this.syncInFlight = false;
    }
  }

  useLocalTime() {
    this.mode = 'local';
    this.offsetMs = 0;
    this.lastError = null;
    this.logLocalMode('manual');
    return this.getStatus();
  }

  getMode() {
    return this.mode;
  }

  getOffsetMs() {
    return this.mode === 'ntp' ? this.offsetMs : 0;
  }

  getCurrentAppTime() {
    const now = this.now();
    return {
      timestamp: now.getTime(),
      iso: now.toISOString(),
      mode: this.mode,
      offsetMs: this.getOffsetMs()
    };
  }

  getStatus() {
    return {
      mode: this.mode,
      offsetMs: this.getOffsetMs(),
      ntpServer: this.ntpServer,
      lastSyncAt: this.lastSyncAt,
      lastSyncServer: this.lastSyncServer,
      lastRoundTripMs: this.lastRoundTripMs,
      lastError: this.lastError,
      syncInFlight: this.syncInFlight,
      autoSyncOnStartup: this.autoSyncOnStartup
    };
  }

  logLocalMode(reason) {
    console.info(`[TimeService] local mode active | reason=${reason}`);
    console.info('[TimeService] current offset ms=0');
  }
}

module.exports = {
  TimeService
};
