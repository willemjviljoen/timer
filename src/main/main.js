const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const https = require('https');
const crypto = require('crypto');

// ─── Load .env (must run before any modules that read process.env) ──
(function loadEnv() {
  // In dev, .env lives at the project root (two levels up from src/main/).
  // In packaged builds, __dirname is inside app.asar so fall back to the
  // directory next to the executable (process.resourcesPath's parent).
  const candidates = [
    path.join(__dirname, '..', '..', '.env'),
    path.join(process.resourcesPath || '', '.env'),
  ];
  for (const envPath of candidates) {
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
      break; // loaded successfully, stop trying candidates
    } catch {}
  }
})();

const Database = require('better-sqlite3');
const { runMigrations } = require('./db-migrations');
const auth   = require('./auth');
const pbAuth = require('./pb-auth');
const { initPocketBase, resetPocketBase } = require('./pocketbase');
const { compareSemver, esc, pad } = require('./utils');

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
let pbInstance = null; // Active PocketBase client

// ─── Settings ────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  notificationThresholdMinutes: 120,
  syncEnabled: false,
  syncBackend:    'firebase', // 'firebase' | 'pocketbase'
  pocketbaseUrl:  '',
};
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
  // Notify renderer so TitleBar can update sync UI
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('settings-changed', merged);
  }
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

  // Run all schema migrations (sync columns, projects, etc.)
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
      INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at, project_id)
      VALUES (@description, @startTime, @endTime, @durationMs, @uuid, @updatedAt, @projectId)
    `);
    const result = stmt.run({
      description: entry.description,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
      uuid,
      updatedAt:   now,
      projectId:   entry.projectId || null,
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
    const updateFields = {
      id:          entry.id,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
      description: entry.description,
      updatedAt:   now,
    };
    // Only update project_id if explicitly provided (allows clearing with null)
    if ('projectId' in entry) {
      db.prepare(`
        UPDATE time_entries
        SET start_time  = @startTime,
            end_time    = @endTime,
            duration_ms = @durationMs,
            description = @description,
            updated_at  = @updatedAt,
            project_id  = @projectId
        WHERE id = @id
      `).run({ ...updateFields, projectId: entry.projectId || null });
    } else {
      db.prepare(`
        UPDATE time_entries
        SET start_time  = @startTime,
            end_time    = @endTime,
            duration_ms = @durationMs,
            description = @description,
            updated_at  = @updatedAt
        WHERE id = @id
      `).run(updateFields);
    }

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
    const tagIds = JSON.stringify(timer.tagIds || []);
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO active_timer (id, description, start_time, project_id, tag_ids)
      VALUES (1, @description, @startTime, @projectId, @tagIds)
    `);
    stmt.run({ description: timer.description, startTime: timer.startTime, projectId: timer.projectId || null, tagIds });
    syncEngine?.pushActiveTimer({
      description: timer.description,
      startTime:   timer.startTime,
      tagIds:      timer.tagIds || [],
    });
    return { success: true };
  });

  // Get active timer state
  ipcMain.handle('get-active-timer', () => {
    const row = db.prepare('SELECT description, start_time, project_id, tag_ids FROM active_timer WHERE id = 1').get();
    if (!row) return null;
    try { row.tag_ids = JSON.parse(row.tag_ids || '[]'); } catch { row.tag_ids = []; }
    return row;
  });

  // Clear active timer state (when stopped normally)
  ipcMain.handle('clear-active-timer', () => {
    db.prepare('DELETE FROM active_timer WHERE id = 1').run();
    syncEngine?.pushActiveTimer(null);
    return { success: true };
  });

  // Autocomplete: return distinct descriptions matching a prefix (with most-recent project)
  ipcMain.handle('search-descriptions', (_event, query) => {
    const escaped = query.replace(/[%_\\]/g, '\\$&');

    // Get descriptions with their most-recent project_id
    const stmt = db.prepare(`
      SELECT t.description, MAX(t.created_at) as last_used, COUNT(*) as use_count,
             (SELECT t2.project_id FROM time_entries t2
              WHERE t2.description = t.description AND t2.deleted = 0
              ORDER BY t2.created_at DESC LIMIT 1) as project_id
      FROM time_entries t
      WHERE t.description LIKE @query ESCAPE '\\' AND t.deleted = 0
      GROUP BY t.description
      ORDER BY last_used DESC
      LIMIT 10
    `);
    const descriptions = stmt.all({ query: `%${escaped}%` });

    // Also search projects matching the query
    const projStmt = db.prepare(`
      SELECT id, name, client_name, color
      FROM projects
      WHERE deleted = 0 AND (name LIKE @query ESCAPE '\\' OR client_name LIKE @query ESCAPE '\\')
      ORDER BY name
      LIMIT 5
    `);
    const projects = projStmt.all({ query: `%${escaped}%` });

    return { descriptions, projects };
  });

  // Get recent entries for history view (with tag IDs)
  ipcMain.handle('get-recent-entries', (_event, limit = 50) => {
    const entries = db.prepare(`
      SELECT id, description, start_time, end_time, duration_ms, created_at, uuid, project_id, synced_at
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
  ipcMain.handle('save-settings', (_event, settings) => {
    const prev = settingsCache ? { ...settingsCache } : {};
    const next = writeSettings(settings);
    // If PocketBase URL changed, drop the cached client so it's recreated on next sign-in
    if (prev.pocketbaseUrl !== next.pocketbaseUrl) {
      if (syncEngine) { syncEngine.stop(); syncEngine = null; }
      resetPocketBase();
      pbInstance = null;
    }
    return next;
  });

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
      SELECT id, description, start_time, end_time, duration_ms, created_at, project_id
      FROM time_entries
      WHERE deleted = 0
      ORDER BY created_at DESC
    `).all();

    const tagMap = {};
    for (const tag of db.prepare('SELECT id, name FROM tags').all()) {
      tagMap[tag.id] = tag.name;
    }
    const projMap = {};
    for (const p of db.prepare('SELECT id, name, client_name FROM projects WHERE deleted = 0').all()) {
      projMap[p.id] = p.client_name ? `${p.client_name} / ${p.name}` : p.name;
    }
    const entryTagStmt = db.prepare('SELECT tag_id FROM entry_tags WHERE entry_id = ?');

    const lines = ['Description,Project,Tags,Start Time,End Time,Duration (ms),Duration (hh:mm:ss),Created At'];
    for (const e of entries) {
      const tagNames = entryTagStmt.all(e.id).map(r => tagMap[r.tag_id] || '').filter(Boolean).join('; ');
      const projectName = e.project_id ? (projMap[e.project_id] || '') : '';
      const h = Math.floor(e.duration_ms / 3600000);
      const m = Math.floor((e.duration_ms % 3600000) / 60000);
      const s = Math.floor((e.duration_ms % 60000) / 1000);
      const dur = `${pad(h)}:${pad(m)}:${pad(s)}`;
      lines.push([esc(e.description), esc(projectName), esc(tagNames), esc(e.start_time), esc(e.end_time), e.duration_ms, esc(dur), esc(e.created_at)].join(','));
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

  // ─── Projects ──────────────────────────────────────────────────
  ipcMain.handle('get-projects', () => {
    return db.prepare('SELECT id, name, client_name, color, uuid FROM projects WHERE deleted = 0 OR deleted IS NULL ORDER BY name').all();
  });

  ipcMain.handle('create-project', (_event, { name, clientName, color }) => {
    const uuid = crypto.randomUUID();
    const now  = new Date().toISOString();
    const stmt = db.prepare('INSERT INTO projects (name, client_name, color, uuid, updated_at) VALUES (@name, @clientName, @color, @uuid, @updatedAt)');
    const result = stmt.run({ name, clientName: clientName || '', color: color || '#6366f1', uuid, updatedAt: now });
    return { id: result.lastInsertRowid, name, client_name: clientName || '', color: color || '#6366f1', uuid };
  });

  ipcMain.handle('update-project', (_event, { id, name, clientName, color }) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE projects SET name = @name, client_name = @clientName, color = @color, updated_at = @updatedAt WHERE id = @id')
      .run({ id, name, clientName: clientName || '', color: color || '#6366f1', updatedAt: now });
    return { success: true };
  });

  ipcMain.handle('delete-project', (_event, id) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE projects SET deleted = 1, updated_at = ? WHERE id = ?').run(now, id);
    // Clear project_id from entries that referenced this project
    db.prepare('UPDATE time_entries SET project_id = NULL, updated_at = ? WHERE project_id = ?').run(now, id);
    return { success: true };
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
  // Firebase / Google sign-in
  ipcMain.handle('auth:sign-in', async () => {
    const settings = loadSettings();
    if ((settings.syncBackend || 'firebase') === 'pocketbase') {
      return { ok: false, error: 'Use PocketBase sign-in for this backend.' };
    }
    try {
      console.log('[auth:sign-in] Starting Firebase sign-in flow...');
      const user = await auth.signIn();
      console.log('[auth:sign-in] Sign-in success:', user?.uid || user?.email);
      const currentSettings = loadSettings();
      if (!currentSettings.syncEnabled) {
        writeSettings({ ...currentSettings, syncEnabled: true });
      }
      return { ok: true, user };
    } catch (err) {
      console.error('[auth:sign-in] Sign-in failed:', err.message);
      return { ok: false, error: err.message };
    }
  });

  // PocketBase email/password sign-in
  ipcMain.handle('auth:pb-sign-in', async (_event, { email, password }) => {
    const settings = loadSettings();
    if (!settings.pocketbaseUrl) {
      return { ok: false, error: 'PocketBase URL is not configured in settings.' };
    }
    try {
      if (!pbInstance) {
        pbInstance = initPocketBase(settings.pocketbaseUrl);
      }
      const user = await pbAuth.signIn(pbInstance, email, password);
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
    const settings = loadSettings();
    if ((settings.syncBackend || 'firebase') === 'pocketbase') {
      if (pbInstance) await pbAuth.signOut(pbInstance);
    } else {
      await auth.signOut();
    }
    return { ok: true };
  });

  ipcMain.handle('auth:get-state', () => {
    const settings = loadSettings();
    if ((settings.syncBackend || 'firebase') === 'pocketbase') {
      return pbAuth.getAuthState();
    }
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

/** Shared sync engine callbacks — used by both Firebase and PocketBase engines. */
function makeSyncCallbacks() {
  return {
    onActiveTimerChanged: (data) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync:active-timer-changed', data);
    },
    onEntriesUpdated: () => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync:entries-updated');
    },
    onTagsUpdated: () => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync:tags-updated');
    },
    onConflictResolved: (message) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync:conflict-resolved', message);
    },
    onStatusChanged: (status) => {
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send('sync:status-changed', status);
    },
  };
}

async function initSync() {
  const { initFirebase } = require('./firebase');
  const { SyncEngine }   = require('./sync');
  const { PocketBaseSyncEngine } = require('./pb-sync');

  // ── Helper: forward auth state + start/stop the sync engine ────
  function handleAuthUser(user, backend) {
    console.log(`[initSync:${backend}] User:`, user ? user.uid : 'signed out');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:state-changed', user);
    }

    if (user) {
      if (syncEngine) { syncEngine.stop(); syncEngine = null; }

      const settings = loadSettings();
      const callbacks = makeSyncCallbacks();

      if (backend === 'firebase') {
        const { firestore, rtdb } = initFirebase();
        syncEngine = new SyncEngine({ db, firestore, rtdb, uid: user.uid, deviceId: settings.deviceId, ...callbacks });
      } else {
        syncEngine = new PocketBaseSyncEngine({ db, pb: pbInstance, uid: user.uid, deviceId: settings.deviceId, ...callbacks });
      }
      syncEngine.start();
    } else {
      if (syncEngine) { syncEngine.stop(); syncEngine = null; }
    }
  }

  // ── Firebase auth listener (only acts when backend = firebase) ──
  auth.onAuthStateChanged((user) => {
    const settings = loadSettings();
    if ((settings.syncBackend || 'firebase') !== 'firebase') return;
    handleAuthUser(user, 'firebase');
  });

  // ── PocketBase auth listener (only acts when backend = pocketbase)
  pbAuth.onAuthStateChanged((user) => {
    const settings = loadSettings();
    if ((settings.syncBackend || 'firebase') !== 'pocketbase') return;
    handleAuthUser(user, 'pocketbase');
  });

  // ── Silent sign-in for the active backend ───────────────────────
  const settings = loadSettings();
  console.log('[initSync] syncEnabled:', settings.syncEnabled, '| backend:', settings.syncBackend || 'firebase');
  if (!settings.syncEnabled) return;

  if ((settings.syncBackend || 'firebase') === 'pocketbase') {
    if (!settings.pocketbaseUrl) return;
    pbInstance = initPocketBase(settings.pocketbaseUrl);
    const user = await pbAuth.trySilentSignIn(pbInstance);
    console.log('[initSync] PocketBase silent sign-in:', user ? 'success' : 'no session');
  } else {
    const user = await auth.trySilentSignIn();
    console.log('[initSync] Firebase silent sign-in:', user ? 'success' : 'no session');
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
