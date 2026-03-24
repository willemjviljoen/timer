const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

let mainWindow = null;
let tray = null;
let db = null;
let isQuitting = false;

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
}

// ─── Tray ────────────────────────────────────────────────────────
function createTray() {
  // Create a simple 16x16 tray icon programmatically
  const iconSize = 16;
  const canvas = nativeImage.createEmpty();

  // Use a simple built-in icon approach
  // On Windows, we create a basic icon from raw pixel data
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'gklEQVQ4T2NkoBAwUqifgWoG/P//n+Hf338MTEyMDIxMTAzEGsDIyMjw7+8/BjZOVob/' +
    'f/8xEGUAyIB///4zsHGwMfz/+5+BiZGJIbewkDgX/P/3n4GVnZXh/7//DEyMTAxFJcXE' +
    'GQAKQzYONgZGJkaG4pJi4gIRFOjEhwHJYUCuFwBJAi0Ry3odJQAAAABJRU5ErkJggg=='
  );

  tray = new Tray(icon);
  tray.setToolTip('TimeTracker');

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
