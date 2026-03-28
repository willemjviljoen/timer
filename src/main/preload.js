const { contextBridge, ipcRenderer } = require('electron');

// ─── Subscriber registry ────────────────────────────────────────
// Allows multiple components to listen to the same IPC channel.
// Each channel gets one ipcRenderer listener that fans out to all
// registered callbacks.  The on* helpers return an unsubscribe
// function so components can clean up in useEffect teardown.
const _subs = {};          // channel → Set<callback>
const _bound = new Set();  // channels that already have an ipcRenderer.on

function _subscribe(channel, cb, extract) {
  if (!_subs[channel]) _subs[channel] = new Set();
  _subs[channel].add(cb);

  if (!_bound.has(channel)) {
    _bound.add(channel);
    ipcRenderer.on(channel, (_event, ...args) => {
      for (const fn of _subs[channel]) fn(...(extract ? extract(args) : args));
    });
  }

  // Return unsubscribe function
  return () => { _subs[channel]?.delete(cb); };
}

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
  onAlwaysOnTopChanged: (callback) => _subscribe('always-on-top-changed', callback),

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

  // Projects
  getProjects: () => ipcRenderer.invoke('get-projects'),
  createProject: (project) => ipcRenderer.invoke('create-project', project),
  updateProject: (project) => ipcRenderer.invoke('update-project', project),
  deleteProject: (id) => ipcRenderer.invoke('delete-project', id),

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
  onThumbbarPlayPause: (callback) => _subscribe('thumbbar-play-pause', callback),
  onThumbbarStop: (callback) => _subscribe('thumbbar-stop', callback),
  onThumbbarSettings: (callback) => _subscribe('thumbbar-settings', callback),

  // ─── Auth ───────────────────────────────────────────────────────
  signIn:       () => ipcRenderer.invoke('auth:sign-in'),
  signOut:      () => ipcRenderer.invoke('auth:sign-out'),
  getAuthState: () => ipcRenderer.invoke('auth:get-state'),
  onAuthStateChanged: (callback) => _subscribe('auth:state-changed', callback),

  // ─── Sync ───────────────────────────────────────────────────────
  getSyncStatus: () => ipcRenderer.invoke('sync:get-status'),
  fetchDateRange: (startDate, endDate) => ipcRenderer.invoke('sync:fetch-date-range', startDate, endDate),
  onActiveTimerSync: (callback) => _subscribe('sync:active-timer-changed', callback),
  onEntriesSync: (callback) => _subscribe('sync:entries-updated', callback),
  onTagsSync: (callback) => _subscribe('sync:tags-updated', callback),
  onSyncConflict: (callback) => _subscribe('sync:conflict-resolved', callback),
  onSyncStatusChanged: (callback) => _subscribe('sync:status-changed', callback),
});
