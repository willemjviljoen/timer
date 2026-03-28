const crypto = require('crypto');

/**
 * Run all pending database migrations.
 * Each migration is additive and idempotent — safe to re-run.
 */
function runMigrations(db) {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);

  const currentVersion = db.prepare('SELECT MAX(version) as v FROM schema_version').get()?.v || 0;

  const migrations = [
    // v1: Add uuid, updated_at, synced_at, deleted columns for sync support
    {
      version: 1,
      up(db) {
        // Add sync columns to time_entries
        db.exec(`
          ALTER TABLE time_entries ADD COLUMN uuid TEXT;
          ALTER TABLE time_entries ADD COLUMN updated_at TEXT;
          ALTER TABLE time_entries ADD COLUMN synced_at TEXT;
          ALTER TABLE time_entries ADD COLUMN deleted INTEGER DEFAULT 0;
        `);

        // Add sync columns to tags
        db.exec(`
          ALTER TABLE tags ADD COLUMN uuid TEXT;
          ALTER TABLE tags ADD COLUMN updated_at TEXT;
          ALTER TABLE tags ADD COLUMN synced_at TEXT;
          ALTER TABLE tags ADD COLUMN deleted INTEGER DEFAULT 0;
        `);

        // Backfill UUIDs for existing rows
        const entries = db.prepare('SELECT id FROM time_entries WHERE uuid IS NULL').all();
        const updateEntry = db.prepare('UPDATE time_entries SET uuid = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?');
        for (const entry of entries) {
          updateEntry.run(crypto.randomUUID(), entry.id);
        }

        const tags = db.prepare('SELECT id FROM tags WHERE uuid IS NULL').all();
        const updateTag = db.prepare('UPDATE tags SET uuid = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?');
        for (const tag of tags) {
          updateTag.run(crypto.randomUUID(), tag.id);
        }

        // Create unique index on uuid columns (after backfill so no NULLs conflict)
        db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_uuid ON time_entries(uuid);
          CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_uuid ON tags(uuid);
          CREATE INDEX IF NOT EXISTS idx_entries_deleted ON time_entries(deleted);
          CREATE INDEX IF NOT EXISTS idx_tags_deleted ON tags(deleted);
        `);

        // Sync queue for offline changes
        db.exec(`
          CREATE TABLE IF NOT EXISTS sync_queue (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_type TEXT    NOT NULL,
            entity_uuid TEXT,
            action      TEXT    NOT NULL,
            payload     TEXT,
            created_at  TEXT    DEFAULT (datetime('now','localtime'))
          );
        `);

        // Sync metadata (last sync timestamps, etc.)
        db.exec(`
          CREATE TABLE IF NOT EXISTS sync_meta (
            key   TEXT PRIMARY KEY,
            value TEXT
          );
        `);
      },
    },
    // v2: Add projects table and link entries to projects
    {
      version: 2,
      up(db) {

        // Create projects table
        db.exec(`
          CREATE TABLE IF NOT EXISTS projects (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            client_name TEXT    NOT NULL DEFAULT '',
            color       TEXT    NOT NULL DEFAULT '#6366f1',
            uuid        TEXT    UNIQUE,
            updated_at  TEXT,
            synced_at   TEXT,
            deleted     INTEGER DEFAULT 0
          );
          CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(deleted);
        `);

        // Add project_id columns (try/catch for existing DBs that may
        // already have these columns from a prior initDatabase() bug)
        try { db.exec('ALTER TABLE time_entries ADD COLUMN project_id INTEGER REFERENCES projects(id)'); } catch {}
        try { db.exec('ALTER TABLE active_timer ADD COLUMN project_id INTEGER'); } catch {}
      },
    },
    // v3: Add tag_ids column to active_timer for crash recovery
    {
      version: 3,
      up(db) {
        try { db.exec('ALTER TABLE active_timer ADD COLUMN tag_ids TEXT DEFAULT \'[]\''); } catch {}
      },
    },
  ];

  const pending = migrations.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  const insertVersion = db.prepare('INSERT INTO schema_version (version) VALUES (?)');

  for (const migration of pending) {
    console.log(`Running migration v${migration.version}...`);
    const runMigration = db.transaction(() => {
      migration.up(db);
      insertVersion.run(migration.version);
    });
    runMigration();
    console.log(`Migration v${migration.version} complete.`);
  }
}

module.exports = { runMigrations };
