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
    ipcRenderer.removeAllListeners('always-on-top-changed');
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

  // Tags
  getTags: () => ipcRenderer.invoke('get-tags'),
  createTag: (tag) => ipcRenderer.invoke('create-tag', tag),
  deleteTag: (id) => ipcRenderer.invoke('delete-tag', id),
  setEntryTags: (data) => ipcRenderer.invoke('set-entry-tags', data),
  getEntryTags: (entryId) => ipcRenderer.invoke('get-entry-tags', entryId),

  // Window control
  resizeWindow: (size) => ipcRenderer.invoke('resize-window', size),

  // Timer state and controls
  updateTimerState: (state) => ipcRenderer.invoke('update-timer-state', state),
  onThumbbarPlayPause: (callback) => {
    ipcRenderer.removeAllListeners('thumbbar-play-pause');
    ipcRenderer.on('thumbbar-play-pause', () => callback());
  },
  onThumbbarStop: (callback) => {
    ipcRenderer.removeAllListeners('thumbbar-stop');
    ipcRenderer.on('thumbbar-stop', () => callback());
  },
  onThumbbarSettings: (callback) => {
    ipcRenderer.removeAllListeners('thumbbar-settings');
    ipcRenderer.on('thumbbar-settings', () => callback());
  },

  // ─── Auth ───────────────────────────────────────────────────────
  signIn:       () => ipcRenderer.invoke('auth:sign-in'),
  signOut:      () => ipcRenderer.invoke('auth:sign-out'),
  getAuthState: () => ipcRenderer.invoke('auth:get-state'),
  onAuthStateChanged: (callback) => {
    ipcRenderer.removeAllListeners('auth:state-changed');
    ipcRenderer.on('auth:state-changed', (_event, user) => callback(user));
  },

  // ─── Sync ───────────────────────────────────────────────────────
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  onActiveTimerSync: (callback) => {
    ipcRenderer.removeAllListeners('sync:active-timer-changed');
    ipcRenderer.on('sync:active-timer-changed', (_event, data) => callback(data));
  },
  onEntriesSync: (callback) => {
    ipcRenderer.removeAllListeners('sync:entries-updated');
    ipcRenderer.on('sync:entries-updated', () => callback());
  },
  onTagsSync: (callback) => {
    ipcRenderer.removeAllListeners('sync:tags-updated');
    ipcRenderer.on('sync:tags-updated', () => callback());
  },
  onSyncConflict: (callback) => {
    ipcRenderer.removeAllListeners('sync:conflict-resolved');
    ipcRenderer.on('sync:conflict-resolved', (_event, message) => callback(message));
  },
  onSyncStatusChanged: (callback) => {
    ipcRenderer.removeAllListeners('sync:status-changed');
    ipcRenderer.on('sync:status-changed', (_event, status) => callback(status));
  },
});
