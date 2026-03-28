const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const https = require('https');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { runMigrations } = require('./db-migrations');
const auth = require('./auth');
const { compareSemver, esc, pad } = require('./utils');

// ─── Load .env ──────────────────────────────────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const val = trimmed.slice(eqIndex + 1).trim();
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch {}
})();

// Resolve assets folder whether running in dev or packaged
function assetsPath(...segments) {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '..', '..', 'assets');
  return path.join(base, ...segments);
}

let mainWindow = null;
let tray = null;
let db = null;
let isQuitting = false;
let timerState = { isRunning: false, description: '', elapsed: 0 };
let syncEngine = null;

// ─── Settings ────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { notificationThresholdMinutes: 120, syncEnabled: false };
let settingsCache = null;

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf-8');
    settingsCache = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    settingsCache = { ...DEFAULT_SETTINGS };
  }
  // Ensure a unique device ID exists for sync
  if (!settingsCache.deviceId) {
    settingsCache.deviceId = crypto.randomUUID();
    writeSettings(settingsCache);
  }
  return settingsCache;
}

function writeSettings(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...settings };
  merged.notificationThresholdMinutes = Math.max(1, Math.min(999,
    Number(merged.notificationThresholdMinutes) || 120));
  fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8');
  settingsCache = merged;
  return merged;
}

// ─── Database Setup ──────────────────────────────────────────────
function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'timetracker.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS time_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT    NOT NULL,
      start_time  TEXT    NOT NULL,
      end_time    TEXT    NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_description ON time_entries(description);
    CREATE INDEX IF NOT EXISTS idx_created_at  ON time_entries(created_at);

    CREATE TABLE IF NOT EXISTS active_timer (
      id          INTEGER PRIMARY KEY CHECK (id = 1),
      description TEXT    NOT NULL,
      start_time  TEXT    NOT NULL
    );
  `);

  // ─── Tags migration (additive — never drops existing data) ────
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT    NOT NULL UNIQUE,
      color TEXT    NOT NULL DEFAULT '#e85d04'
    );

    CREATE TABLE IF NOT EXISTS entry_tags (
      entry_id INTEGER NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
      tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (entry_id, tag_id)
    );
  `);

  // Run sync-related schema migrations
  runMigrations(db);

  console.log(`Database opened at: ${dbPath}`);
}

// ─── IPC Handlers ────────────────────────────────────────────────
function registerIPC() {
  // Save a completed time entry
  ipcMain.handle('save-entry', (_event, entry) => {
    const uuid = entry.uuid || crypto.randomUUID();
    const now  = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at)
      VALUES (@description, @startTime, @endTime, @durationMs, @uuid, @updatedAt)
    `);
    const result = stmt.run({
      description: entry.description,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
      uuid,
      updatedAt:   now,
    });
    const entryId = result.lastInsertRowid;

    if (Array.isArray(entry.tagIds) && entry.tagIds.length > 0) {
      const ins = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
      const tx  = db.transaction((eid, ids) => { for (const tid of ids) ins.run(eid, tid); });
      tx(entryId, entry.tagIds);
    }

    syncEngine?.pushEntry(uuid);
    return { id: entryId, uuid };
  });

  // Update an existing time entry
  ipcMain.handle('update-entry', (_event, entry) => {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE time_entries
      SET start_time  = @startTime,
          end_time    = @endTime,
          duration_ms = @durationMs,
          description = @description,
          updated_at  = @updatedAt
      WHERE id = @id
    `).run({
      id:          entry.id,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
      description: entry.description,
      updatedAt:   now,
    });

    if (Array.isArray(entry.tagIds)) {
      const del = db.prepare('DELETE FROM entry_tags WHERE entry_id = ?');
      const ins = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
      const tx  = db.transaction((eid, ids) => { del.run(eid); for (const tid of ids) ins.run(eid, tid); });
      tx(entry.id, entry.tagIds);
    }

    // Look up the uuid for sync
    const row = db.prepare('SELECT uuid FROM time_entries WHERE id = ?').get(entry.id);
    if (row?.uuid) syncEngine?.pushEntry(row.uuid);

    return { success: true };
  });

  // Delete a time entry (soft delete for sync)
  ipcMain.handle('delete-entry', (_event, id) => {
    const now = new Date().toISOString();
    const row = db.prepare('SELECT uuid FROM time_entries WHERE id = ?').get(id);
    db.prepare('UPDATE time_entries SET deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    if (row?.uuid) syncEngine?.pushEntry(row.uuid);
    return { success: true };
  });

  // Save active timer state (for crash recovery)
  ipcMain.handle('save-active-timer', (_event, timer) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO active_timer (id, description, start_time)
      VALUES (1, @description, @startTime)
    `);
    stmt.run({ description: timer.description, startTime: timer.startTime });
    syncEngine?.pushActiveTimer({
      description: timer.description,
      startTime:   timer.startTime,
      tagIds:      timer.tagIds || [],
    });
    return { success: true };
  });

  // Get active timer state
  ipcMain.handle('get-active-timer', () => {
    const stmt = db.prepare('SELECT description, start_time FROM active_timer WHERE id = 1');
    return stmt.get() || null;
  });

  // Clear active timer state (when stopped normally)
  ipcMain.handle('clear-active-timer', () => {
    db.prepare('DELETE FROM active_timer WHERE id = 1').run();
    syncEngine?.pushActiveTimer(null);
    return { success: true };
  });

  // Autocomplete: return distinct descriptions matching a prefix
  ipcMain.handle('search-descriptions', (_event, query) => {
    const stmt = db.prepare(`
      SELECT description, MAX(created_at) as last_used, COUNT(*) as use_count
      FROM time_entries
      WHERE description LIKE @query ESCAPE '\\' AND deleted = 0
      GROUP BY description
      ORDER BY last_used DESC
      LIMIT 10
    `);
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    return stmt.all({ query: `%${escaped}%` });
  });

  // Get recent entries for history view (with tag IDs)
  ipcMain.handle('get-recent-entries', (_event, limit = 50) => {
    const entries = db.prepare(`
      SELECT id, description, start_time, end_time, duration_ms, created_at, uuid
      FROM time_entries
      WHERE deleted = 0
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit);

    const tagStmt = db.prepare('SELECT tag_id FROM entry_tags WHERE entry_id = ?');
    return entries.map(e => ({
      ...e,
      tags: tagStmt.all(e.id).map(r => r.tag_id),
    }));
  });

  // App version
  ipcMain.handle('get-version', () => app.getVersion());

  // Settings
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_event, settings) => writeSettings(settings));

  // Desktop notification
  ipcMain.handle('show-notification', (_event, title, body) => {
    if (Notification.isSupported()) {
      new Notification({ title, body, icon: assetsPath('icon.png') }).show();
    }
    return { ok: true };
  });

  // CSV export
  ipcMain.handle('export-csv', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Time Entries',
      defaultPath: path.join(
        app.getPath('documents'),
        `timetracker-export-${new Date().toISOString().slice(0, 10)}.csv`
      ),
      filters: [{ name: 'CSV Files', extensions: ['csv'] }],
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true };
    }

    const entries = db.prepare(`
      SELECT id, description, start_time, end_time, duration_ms, created_at
      FROM time_entries
      WHERE deleted = 0
      ORDER BY created_at DESC
    `).all();

    const tagMap = {};
    for (const tag of db.prepare('SELECT id, name FROM tags').all()) {
      tagMap[tag.id] = tag.name;
    }
    const entryTagStmt = db.prepare('SELECT tag_id FROM entry_tags WHERE entry_id = ?');

    const lines = ['Description,Tags,Start Time,End Time,Duration (ms),Duration (hh:mm:ss),Created At'];
    for (const e of entries) {
      const tagNames = entryTagStmt.all(e.id).map(r => tagMap[r.tag_id] || '').filter(Boolean).join('; ');
      const h = Math.floor(e.duration_ms / 3600000);
      const m = Math.floor((e.duration_ms % 3600000) / 60000);
      const s = Math.floor((e.duration_ms % 60000) / 1000);
      const dur = `${pad(h)}:${pad(m)}:${pad(s)}`;
      lines.push([esc(e.description), esc(tagNames), esc(e.start_time), esc(e.end_time), e.duration_ms, esc(dur), esc(e.created_at)].join(','));
    }

    fs.writeFileSync(result.filePath, lines.join('\r\n'), 'utf-8');
    return { ok: true, path: result.filePath };
  });

  // Check for updates via GitHub Releases API
  ipcMain.handle('check-for-update', () => {
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/willemjviljoen/timer/releases/latest',
        headers: { 'User-Agent': 'TimeTracker-app' },
        timeout: 8000,
      };
      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latestTag  = (release.tag_name || '').replace(/^v/, '');
            const currentVer = app.getVersion();
            const hasUpdate  = latestTag && compareSemver(latestTag, currentVer) > 0;
            resolve({
              ok: true,
              hasUpdate,
              latestVersion: latestTag,
              currentVersion: currentVer,
              releaseUrl: release.html_url || 'https://github.com/willemjviljoen/timer/releases',
            });
          } catch {
            resolve({ ok: false, error: 'Could not parse response' });
          }
        });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    });
  });

  // Open a URL in the default browser (only allow http/https)
  ipcMain.handle('open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false, error: 'Only http/https URLs are allowed' };
  });

  // ─── Tags ─────────────────────────────────────────────────────
  ipcMain.handle('get-tags', () => {
    return db.prepare('SELECT id, name, color, uuid FROM tags WHERE deleted = 0 ORDER BY name').all();
  });

  ipcMain.handle('create-tag', (_event, { name, color }) => {
    const uuid = crypto.randomUUID();
    const now  = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO tags (name, color, uuid, updated_at) VALUES (@name, @color, @uuid, @updatedAt)');
    const result = stmt.run({ name, color, uuid, updatedAt: now });
    syncEngine?.pushTag(uuid);
    return { id: result.lastInsertRowid, name, color, uuid };
  });

  ipcMain.handle('delete-tag', (_event, id) => {
    const now = new Date().toISOString();
    const row = db.prepare('SELECT uuid FROM tags WHERE id = ?').get(id);
    db.prepare('UPDATE tags SET deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    // Also clean up entry_tags references
    db.prepare('DELETE FROM entry_tags WHERE tag_id = ?').run(id);
    if (row?.uuid) syncEngine?.pushTag(row.uuid);
    return { success: true };
  });

  ipcMain.handle('set-entry-tags', (_event, { entryId, tagIds }) => {
    const del = db.prepare('DELETE FROM entry_tags WHERE entry_id = ?');
    const ins = db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)');
    const tx  = db.transaction((eid, ids) => {
      del.run(eid);
      for (const tid of ids) ins.run(eid, tid);
    });
    tx(entryId, tagIds);
    return { success: true };
  });

  ipcMain.handle('get-entry-tags', (_event, entryId) => {
    return db.prepare('SELECT tag_id FROM entry_tags WHERE entry_id = ?').all(entryId).map(r => r.tag_id);
  });

  // ─── Window Control ────────────────────────────────────────────
  ipcMain.handle('resize-window', (_event, size) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSize(size.width, size.height, true);
      // Force layout update
      mainWindow.webContents.invalidate();
    }
    return { ok: true };
  });

  ipcMain.handle('update-timer-state', (_event, state) => {
    timerState = state;
    return { ok: true };
  });

  // ─── Auth ───────────────────────────────────────────────────────
  ipcMain.handle('auth:sign-in', async () => {
    try {
      const user = await auth.signIn();
      // Ensure syncEnabled is saved when user signs in
      const currentSettings = loadSettings();
      if (!currentSettings.syncEnabled) {
        writeSettings({ ...currentSettings, syncEnabled: true });
      }
      return { ok: true, user };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:sign-out', async () => {
    if (syncEngine) {
      syncEngine.stop();
      syncEngine = null;
    }
    await auth.signOut();
    return { ok: true };
  });

  ipcMain.handle('auth:get-state', () => {
    return auth.getAuthState();
  });

  ipcMain.handle('sync:get-status', () => {
    if (!syncEngine) return { state: 'disconnected' };
    return syncEngine.getStatus();
  });

  ipcMain.handle('sync:fetch-date-range', async (_event, startDate, endDate) => {
    if (!syncEngine) return false;
    return syncEngine.fetchEntriesForRange(startDate, endDate);
  });
}

// ─── Tray ────────────────────────────────────────────────────────
function createTray() {
  const icon = nativeImage.createFromPath(assetsPath('tray.png'));

  tray = new Tray(icon);
  tray.setToolTip(`TimeTracker v${app.getVersion()}`);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show TimeTracker',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ─── Window ──────────────────────────────────────────────────────
function createWindow() {
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 720,
    height: 680,
    minWidth: 280,
    minHeight: 100,
    maxHeight: 1000,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    backgroundColor: '#0a0a0a',
    icon: assetsPath('icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:9000');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  // Minimise to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Setup thumbnail toolbar buttons (Windows)
  if (process.platform === 'win32') {
    try {
      mainWindow.setThumbarButtons([
        {
          tooltip: 'Start / Stop (Ctrl+Space)',
          icon: nativeImage.createFromPath(assetsPath('thumb-play.png')),
          click: () => mainWindow.webContents.send('thumbbar-play-pause'),
        },
        {
          tooltip: 'Stop',
          icon: nativeImage.createFromPath(assetsPath('thumb-stop.png')),
          click: () => mainWindow.webContents.send('thumbbar-stop'),
        },
      ]);
    } catch (e) {
      console.warn('Could not set thumbnail buttons:', e.message);
    }
  }

  // IPC: window controls (frameless)
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.hide());
  ipcMain.on('window-toggle-always-on-top', () => {
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current);
    mainWindow.webContents.send('always-on-top-changed', !current);
  });
}

// ─── Sync Lifecycle ─────────────────────────────────────────────
async function initSync() {
  const { initFirebase, getFirebaseFirestore, getFirebaseRtdb } = require('./firebase');
  const { SyncEngine } = require('./sync');

  // Listen for auth state changes to start/stop sync
  auth.onAuthStateChanged((user) => {
    // Forward auth state to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:state-changed', user);
    }

    if (user) {
      // User signed in — start sync
      const { firestore, rtdb } = initFirebase();
      const settings = loadSettings();
      syncEngine = new SyncEngine({
        db,
        firestore,
        rtdb,
        uid:      user.uid,
        deviceId: settings.deviceId,
        onActiveTimerChanged: (data) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:active-timer-changed', data);
          }
        },
        onEntriesUpdated: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:entries-updated');
          }
        },
        onTagsUpdated: () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:tags-updated');
          }
        },
        onConflictResolved: (message) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:conflict-resolved', message);
          }
        },
        onStatusChanged: (status) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('sync:status-changed', status);
          }
        },
      });
      syncEngine.start();
    } else {
      // User signed out — stop sync
      if (syncEngine) {
        syncEngine.stop();
        syncEngine = null;
      }
    }
  });

  // Only attempt silent sign-in if sync is enabled in settings
  const settings = loadSettings();
  if (settings.syncEnabled) {
    await auth.trySilentSignIn();
  }
}

// ─── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings();
  initDatabase();
  registerIPC();
  createTray();
  createWindow();
  // Start sync in background (non-blocking)
  initSync().catch(err => console.warn('Sync init error:', err.message));
});

app.on('before-quit', () => {
  isQuitting = true;
  if (syncEngine) {
    syncEngine.stop();
    syncEngine = null;
  }
  if (db) db.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
