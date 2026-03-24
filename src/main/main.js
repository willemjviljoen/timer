const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, Notification } = require('electron');
const path = require('path');
const fs   = require('fs');
const Database = require('better-sqlite3');

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

// ─── Settings ────────────────────────────────────────────────────
const DEFAULT_SETTINGS = { notificationThresholdMinutes: 120 };
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

  console.log(`Database opened at: ${dbPath}`);
}

// ─── IPC Handlers ────────────────────────────────────────────────
function registerIPC() {
  // Save a completed time entry
  ipcMain.handle('save-entry', (_event, entry) => {
    const stmt = db.prepare(`
      INSERT INTO time_entries (description, start_time, end_time, duration_ms)
      VALUES (@description, @startTime, @endTime, @durationMs)
    `);
    const result = stmt.run({
      description: entry.description,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
    });
    return { id: result.lastInsertRowid };
  });

  // Update an existing time entry
  ipcMain.handle('update-entry', (_event, entry) => {
    const stmt = db.prepare(`
      UPDATE time_entries
      SET start_time = @startTime,
          end_time   = @endTime,
          duration_ms = @durationMs,
          description = @description
      WHERE id = @id
    `);
    stmt.run({
      id:          entry.id,
      startTime:   entry.startTime,
      endTime:     entry.endTime,
      durationMs:  entry.durationMs,
      description: entry.description,
    });
    return { success: true };
  });

  // Delete a time entry
  ipcMain.handle('delete-entry', (_event, id) => {
    const stmt = db.prepare('DELETE FROM time_entries WHERE id = ?');
    stmt.run(id);
    return { success: true };
  });

  // Save active timer state (for crash recovery)
  ipcMain.handle('save-active-timer', (_event, timer) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO active_timer (id, description, start_time)
      VALUES (1, @description, @startTime)
    `);
    stmt.run({ description: timer.description, startTime: timer.startTime });
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
    return { success: true };
  });

  // Autocomplete: return distinct descriptions matching a prefix
  ipcMain.handle('search-descriptions', (_event, query) => {
    const stmt = db.prepare(`
      SELECT description, MAX(created_at) as last_used, COUNT(*) as use_count
      FROM time_entries
      WHERE description LIKE @query
      GROUP BY description
      ORDER BY last_used DESC
      LIMIT 10
    `);
    return stmt.all({ query: `%${query}%` });
  });

  // Get recent entries for history view
  ipcMain.handle('get-recent-entries', (_event, limit = 50) => {
    const stmt = db.prepare(`
      SELECT id, description, start_time, end_time, duration_ms, created_at
      FROM time_entries
      ORDER BY created_at DESC
      LIMIT ?
    `);
    return stmt.all(limit);
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
      SELECT description, start_time, end_time, duration_ms, created_at
      FROM time_entries
      ORDER BY created_at DESC
    `).all();

    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const pad = (n) => String(n).padStart(2, '0');

    const lines = ['Description,Start Time,End Time,Duration (ms),Duration (hh:mm:ss),Created At'];
    for (const e of entries) {
      const h = Math.floor(e.duration_ms / 3600000);
      const m = Math.floor((e.duration_ms % 3600000) / 60000);
      const s = Math.floor((e.duration_ms % 60000) / 1000);
      const dur = `${pad(h)}:${pad(m)}:${pad(s)}`;
      lines.push([esc(e.description), esc(e.start_time), esc(e.end_time), e.duration_ms, esc(dur), esc(e.created_at)].join(','));
    }

    fs.writeFileSync(result.filePath, lines.join('\r\n'), 'utf-8');
    return { ok: true, path: result.filePath };
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
    width: 680,
    height: 480,
    minWidth: 520,
    minHeight: 200,
    maxHeight: 800,
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

  // IPC: window controls (frameless)
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-close', () => mainWindow.hide());
  ipcMain.on('window-toggle-always-on-top', () => {
    const current = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(!current);
    mainWindow.webContents.send('always-on-top-changed', !current);
  });
}

// ─── App Lifecycle ───────────────────────────────────────────────
app.whenReady().then(() => {
  loadSettings();
  initDatabase();
  registerIPC();
  createTray();
  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (db) db.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});
