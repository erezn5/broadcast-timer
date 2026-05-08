const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clockBridge', {
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
