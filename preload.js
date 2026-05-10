const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockBridge', {
  syncNtpTime(server) {
    return ipcRenderer.invoke('time:sync-ntp', { server });
  },
  getCurrentAppTime() {
    return ipcRenderer.invoke('time:get-current-app-time');
  },
  useLocalTime() {
    return ipcRenderer.invoke('time:use-local-time');
  },
  getTimeMode() {
    return ipcRenderer.invoke('time:get-mode');
  },
  getNtpStatus() {
    return ipcRenderer.invoke('time:get-status');
  },
  getTimeSettings() {
    return ipcRenderer.invoke('time:get-settings');
  },
  saveTimeSettings(settings) {
    return ipcRenderer.invoke('time:save-settings', settings);
  },
  loadClockSettings() {
    return ipcRenderer.invoke('clock:load-settings');
  },
  saveClockSettings(settings) {
    return ipcRenderer.invoke('clock:save-settings', settings);
  },
  queryNtpTime(server) {
    return ipcRenderer.invoke('clock:query-ntp', { server });
  }
});
