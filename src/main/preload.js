const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Time entries
  saveEntry: (entry) => ipcRenderer.invoke('save-entry', entry),
  updateEntry: (entry) => ipcRenderer.invoke('update-entry', entry),
  deleteEntry: (id) => ipcRenderer.invoke('delete-entry', id),
  searchDescriptions: (query) => ipcRenderer.invoke('search-descriptions', query),
  getRecentEntries: (limit) => ipcRenderer.invoke('get-recent-entries', limit),

  // Active timer persistence (crash recovery)
  saveActiveTimer: (timer) => ipcRenderer.invoke('save-active-timer', timer),
  getActiveTimer: () => ipcRenderer.invoke('get-active-timer'),
  clearActiveTimer: () => ipcRenderer.invoke('clear-active-timer'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  toggleAlwaysOnTop: () => ipcRenderer.send('window-toggle-always-on-top'),

  // Listen for events from main
  onAlwaysOnTopChanged: (callback) => {
    ipcRenderer.on('always-on-top-changed', (_event, value) => callback(value));
  },

  // App info
  getVersion: () => ipcRenderer.invoke('get-version'),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Notifications
  showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),

  // CSV export
  exportCsv: () => ipcRenderer.invoke('export-csv'),

  // Update check
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
