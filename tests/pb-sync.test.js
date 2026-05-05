/**
 * Tests for the PocketBase sync engine (pb-sync.js), auth helpers (pb-auth.js),
 * and the PocketBase client factory (pocketbase.js).
 *
 * Strategy:
 *  - electron is aliased to __mocks__/electron.js in vitest.config.js so that
 *    main-process modules can be imported in the Node.js test runner.
 *  - better-sqlite3 (a native Electron-ABI binary) is replaced by a pure-JS
 *    in-memory mock so tests run without any native compilation dependency.
 *  - The PocketBase SDK is replaced by a lightweight fake (buildFakePb).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TEST_USERDATA } from './setup.js';
import path from 'path';
import fs from 'fs';
import { PocketBaseSyncEngine } from '../src/main/pb-sync.js';

// ─── In-memory DB mock ───────────────────────────────────────────────────────
// Tracks time_entries, tags, entry_tags and sync_queue in plain Maps/arrays.
// Routes prepare(sql).get/run/all calls based on SQL content patterns.

class MemoryDb {
  constructor() {
    this.entries   = new Map();   // uuid -> row
    this.tags      = new Map();   // uuid -> row
    this.entryTags = [];          // { entry_id, tag_id }
    this.queue     = [];          // sync_queue rows
    this._id       = 1;
  }

  prepare(sql) {
    const db   = this;
    const _sql = sql.trim();

    return {
      get(...args) {
        if (/SELECT id FROM time_entries WHERE uuid/i.test(_sql)) {
          const e = db.entries.get(args[0]);
          return e ? { id: e.id } : null;
        }
        if (/SELECT.*time_entries.*uuid\s*=\s*\?/si.test(_sql)) {
          return db.entries.get(args[0]) ?? null;
        }
        if (/SELECT \* FROM time_entries.*uuid\s*=\s*\?/si.test(_sql)) {
          return db.entries.get(args[0]) ?? null;
        }
        if (/SELECT.*tags.*uuid\s*=\s*\?/si.test(_sql)) {
          return db.tags.get(args[0]) ?? null;
        }
        if (/SELECT.*active_timer/si.test(_sql)) return null;
        return null;
      },

      run(...args) {
        if (/INSERT INTO time_entries/i.test(_sql)) {
          const id = db._id++;
          const [desc, start, end, dur, uuid, upd, synced, created] = args;
          db.entries.set(uuid, {
            id, description: desc, start_time: start, end_time: end,
            duration_ms: dur, uuid, updated_at: upd, synced_at: synced,
            created_at: created, deleted: 0,
          });
          return { lastInsertRowid: id };
        }
        if (/UPDATE time_entries SET deleted = 1/i.test(_sql)) {
          const uuid = args[args.length - 1];
          const row  = db.entries.get(uuid);
          if (row) { row.deleted = 1; row.updated_at = args[0]; row.synced_at = args[1]; }
          return { changes: row ? 1 : 0 };
        }
        if (/UPDATE time_entries[\s\S]*SET[\s\S]*description/i.test(_sql)) {
          const uuid = args[args.length - 1];
          const row  = db.entries.get(uuid);
          if (row) {
            const [desc, start, end, dur, upd, synced] = args;
            Object.assign(row, {
              description: desc, start_time: start, end_time: end,
              duration_ms: dur, updated_at: upd, synced_at: synced,
            });
          }
          return { changes: row ? 1 : 0 };
        }
        if (/UPDATE time_entries SET synced_at/i.test(_sql)) {
          const uuid = args[1];
          const row  = db.entries.get(uuid);
          if (row) row.synced_at = args[0];
          return { changes: 1 };
        }
        if (/INSERT INTO tags/i.test(_sql)) {
          const id = db._id++;
          const [name, color, uuid, upd, synced] = args;
          db.tags.set(uuid, { id, name, color, uuid, updated_at: upd, synced_at: synced, deleted: 0 });
          return { lastInsertRowid: id };
        }
        if (/UPDATE tags SET deleted = 1/i.test(_sql)) {
          const uuid = args[args.length - 1];
          const row  = db.tags.get(uuid);
          if (row) { row.deleted = 1; row.updated_at = args[0]; row.synced_at = args[1]; }
          return { changes: row ? 1 : 0 };
        }
        if (/UPDATE tags[\s\S]*SET[\s\S]*name/i.test(_sql)) {
          const uuid = args[args.length - 1];
          const row  = db.tags.get(uuid);
          if (row) {
            const [name, color, upd, synced] = args;
            Object.assign(row, { name, color, updated_at: upd, synced_at: synced });
          }
          return { changes: row ? 1 : 0 };
        }
        if (/UPDATE tags SET synced_at/i.test(_sql)) {
          const uuid = args[1];
          const row  = db.tags.get(uuid);
          if (row) row.synced_at = args[0];
          return { changes: 1 };
        }
        if (/DELETE FROM entry_tags WHERE entry_id/i.test(_sql)) {
          db.entryTags = db.entryTags.filter(et => et.entry_id !== args[0]);
          return { changes: 1 };
        }
        if (/INSERT.*entry_tags.*SELECT.*tags.*uuid/si.test(_sql)) {
          const [entryId, tagUuid] = args;
          const tag = [...db.tags.values()].find(t => t.uuid === tagUuid);
          if (tag) db.entryTags.push({ entry_id: entryId, tag_id: tag.id });
          return { changes: 1 };
        }
        if (/INSERT INTO sync_queue/i.test(_sql)) {
          const id = db._id++;
          const [entity_type, entity_uuid, action, payload] = args;
          db.queue.push({ id, entity_type, entity_uuid, action, payload });
          return { lastInsertRowid: id };
        }
        if (/DELETE FROM sync_queue/i.test(_sql)) {
          db.queue = db.queue.filter(q => q.id !== args[0]);
          return { changes: 1 };
        }
        return { lastInsertRowid: db._id++, changes: 0 };
      },

      all(...args) {
        if (/SELECT tag_id FROM entry_tags WHERE entry_id/i.test(_sql)) {
          return db.entryTags.filter(et => et.entry_id === args[0]);
        }
        if (/SELECT \* FROM sync_queue/i.test(_sql)) {
          return db.queue;
        }
        if (/SELECT uuid FROM time_entries WHERE synced_at IS NULL/i.test(_sql)) {
          return [...db.entries.values()].filter(e => !e.synced_at && !e.deleted);
        }
        if (/SELECT uuid FROM tags WHERE synced_at IS NULL/i.test(_sql)) {
          return [...db.tags.values()].filter(t => !t.synced_at && !t.deleted);
        }
        if (/SELECT t\.uuid FROM entry_tags/i.test(_sql)) {
          const entryId = args[0];
          return db.entryTags
            .filter(et => et.entry_id === entryId)
            .map(et => {
              const tag = [...db.tags.values()].find(t => t.id === et.tag_id);
              return tag ? { uuid: tag.uuid } : null;
            })
            .filter(Boolean);
        }
        return [];
      },
    };
  }
}

// ─── Fake PocketBase client ──────────────────────────────────────────────────

function buildFakePb({ records = {}, subscribeUnsub = () => {} } = {}) {
  return {
    fakeRecords: records,
    collection(name) {
      const self = this;
      return {
        async getFirstListItem() {
          const list = self.fakeRecords[name] || [];
          if (!list[0]) throw Object.assign(new Error('Not found'), { status: 404 });
          return list[0];
        },
        async getFullList() { return self.fakeRecords[name] || []; },
        async create(data) {
          if (!self.fakeRecords[name]) self.fakeRecords[name] = [];
          const record = { id: `rec_${Math.random().toString(36).slice(2)}`, ...data };
          self.fakeRecords[name].push(record);
          return record;
        },
        async update(id, data) {
          const list = self.fakeRecords[name] || [];
          const idx  = list.findIndex(r => r.id === id);
          if (idx !== -1) Object.assign(list[idx], data);
          return list[idx] ?? data;
        },
        async delete(id) {
          if (self.fakeRecords[name]) {
            self.fakeRecords[name] = self.fakeRecords[name].filter(r => r.id !== id);
          }
        },
        async subscribe(_target, _cb) { return subscribeUnsub; },
        async authWithPassword(email, _password) {
          if (email === 'bad@bad.com') throw new Error('Wrong credentials');
          return {
            token:  'tok_test',
            record: { id: 'uid123', email, name: 'Test User' },
          };
        },
        async authRefresh() {
          return {
            token:  'tok_refreshed',
            record: { id: 'uid123', email: 'user@example.com', name: 'Test User' },
          };
        },
      };
    },
    authStore: {
      _token: '',
      _record: null,
      get token()   { return this._token; },
      get isValid() { return !!this._token; },
      save(token, record) { this._token = token; this._record = record; },
      clear()       { this._token = ''; this._record = null; },
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

function makeEngine(dbOverrides = {}, pbOpts = {}) {
  const db = Object.assign(new MemoryDb(), dbOverrides);
  const pb = buildFakePb(pbOpts);
  const callbacks = {
    onActiveTimerChanged: vi.fn(),
    onEntriesUpdated:     vi.fn(),
    onTagsUpdated:        vi.fn(),
    onConflictResolved:   vi.fn(),
    onStatusChanged:      vi.fn(),
  };
  const engine = new PocketBaseSyncEngine({
    db, pb, uid: 'uid123', deviceId: 'dev1', ...callbacks,
  });
  return { engine, db, pb, callbacks };
}

// ─── PocketBaseSyncEngine._applyRemoteEntry ──────────────────────────────────

describe('PocketBaseSyncEngine._applyRemoteEntry', () => {
  let engine, db;
  beforeEach(() => ({ engine, db } = makeEngine()));

  it('inserts a new remote entry into the local DB', () => {
    const changed = engine._applyRemoteEntry({
      local_uuid:  'uuid-001',
      description: 'Deep work',
      start_time:  '2026-05-01T09:00:00.000Z',
      end_time:    '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000,
      updated_at:  '2026-05-01T10:00:00.000Z',
      created:     '2026-05-01T09:00:00.000Z',
      tag_uuids:   '[]',
      deleted:     false,
    });

    expect(changed).toBe(true);
    const row = db.entries.get('uuid-001');
    expect(row).toBeTruthy();
    expect(row.description).toBe('Deep work');
    expect(row.duration_ms).toBe(3600000);
    expect(row.deleted).toBe(0);
  });

  it('skips entry that is already synced with the same timestamp', () => {
    db.entries.set('uuid-002', {
      id: 1, uuid: 'uuid-002', description: 'Existing',
      start_time: '2026-05-01T09:00:00.000Z', end_time: '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000,
      updated_at: '2026-05-01T10:00:00.000Z',
      synced_at:  '2026-05-01T10:01:00.000Z',
      deleted: 0,
    });

    const changed = engine._applyRemoteEntry({
      local_uuid:  'uuid-002',
      description: 'Existing',
      start_time:  '2026-05-01T09:00:00.000Z',
      end_time:    '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000,
      updated_at:  '2026-05-01T10:00:00.000Z',
      tag_uuids:   '[]',
      deleted:     false,
    });

    expect(changed).toBe(false);
  });

  it('updates local entry when remote is newer', () => {
    db.entries.set('uuid-003', {
      id: 2, uuid: 'uuid-003', description: 'Old desc',
      start_time: '2026-05-01T09:00:00.000Z', end_time: '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000, updated_at: '2026-05-01T10:00:00.000Z',
      synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteEntry({
      local_uuid:  'uuid-003',
      description: 'New desc',
      start_time:  '2026-05-01T09:00:00.000Z',
      end_time:    '2026-05-01T11:00:00.000Z',
      duration_ms: 7200000,
      updated_at:  '2026-05-01T11:00:00.000Z',
      tag_uuids:   '[]',
      deleted:     false,
    });

    expect(changed).toBe(true);
    const row = db.entries.get('uuid-003');
    expect(row.description).toBe('New desc');
    expect(row.duration_ms).toBe(7200000);
  });

  it('does not update local entry when remote is older', () => {
    db.entries.set('uuid-004', {
      id: 3, uuid: 'uuid-004', description: 'Current',
      start_time: '2026-05-01T09:00:00.000Z', end_time: '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000, updated_at: '2026-05-01T10:00:00.000Z',
      synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteEntry({
      local_uuid:  'uuid-004',
      description: 'Stale',
      start_time:  '2026-05-01T09:00:00.000Z',
      end_time:    '2026-05-01T09:30:00.000Z',
      duration_ms: 1800000,
      updated_at:  '2026-05-01T09:30:00.000Z',
      tag_uuids:   '[]',
      deleted:     false,
    });

    expect(changed).toBe(false);
    expect(db.entries.get('uuid-004').description).toBe('Current');
  });

  it('soft-deletes a local entry when remote says deleted=true', () => {
    db.entries.set('uuid-005', {
      id: 4, uuid: 'uuid-005', description: 'To delete',
      start_time: '2026-05-01T09:00:00.000Z', end_time: '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000, updated_at: '2026-05-01T10:00:00.000Z',
      synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteEntry({
      local_uuid: 'uuid-005',
      updated_at: '2026-05-02T08:00:00.000Z',
      deleted:    true,
    });

    expect(changed).toBe(true);
    expect(db.entries.get('uuid-005').deleted).toBe(1);
  });

  it('skips record with missing local_uuid', () => {
    expect(engine._applyRemoteEntry({ local_uuid: null })).toBe(false);
    expect(engine._applyRemoteEntry({})).toBe(false);
  });

  it('restores tag associations when inserting a new remote entry', () => {
    db.tags.set('tag-uuid-1', {
      id: 10, name: 'Focus', color: '#ff0000', uuid: 'tag-uuid-1',
      updated_at: '2026-05-01T00:00:00.000Z', synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteEntry({
      local_uuid:  'uuid-006',
      description: 'Tagged work',
      start_time:  '2026-05-01T09:00:00.000Z',
      end_time:    '2026-05-01T10:00:00.000Z',
      duration_ms: 3600000,
      updated_at:  '2026-05-01T10:00:00.000Z',
      created:     '2026-05-01T09:00:00.000Z',
      tag_uuids:   JSON.stringify(['tag-uuid-1']),
      deleted:     false,
    });

    expect(changed).toBe(true);
    const entry   = db.entries.get('uuid-006');
    const tagLinks = db.entryTags.filter(et => et.entry_id === entry.id);
    expect(tagLinks.length).toBe(1);
    expect(tagLinks[0].tag_id).toBe(10);
  });
});

// ─── PocketBaseSyncEngine._applyRemoteTag ────────────────────────────────────

describe('PocketBaseSyncEngine._applyRemoteTag', () => {
  let engine, db;
  beforeEach(() => ({ engine, db } = makeEngine()));

  it('inserts a new remote tag', () => {
    const changed = engine._applyRemoteTag({
      local_uuid: 'tag-uuid-a',
      name:       'Design',
      color:      '#3b82f6',
      updated_at: '2026-05-01T10:00:00.000Z',
      deleted:    false,
    });

    expect(changed).toBe(true);
    const row = db.tags.get('tag-uuid-a');
    expect(row.name).toBe('Design');
    expect(row.color).toBe('#3b82f6');
  });

  it('updates a local tag when remote is newer', () => {
    db.tags.set('tag-uuid-b', {
      id: 20, name: 'Old', color: '#aaa', uuid: 'tag-uuid-b',
      updated_at: '2026-05-01T08:00:00.000Z', synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteTag({
      local_uuid: 'tag-uuid-b',
      name:       'New',
      color:      '#bbb',
      updated_at: '2026-05-01T09:00:00.000Z',
      deleted:    false,
    });

    expect(changed).toBe(true);
    expect(db.tags.get('tag-uuid-b').name).toBe('New');
  });

  it('soft-deletes a local tag when remote says deleted=true', () => {
    db.tags.set('tag-uuid-c', {
      id: 21, name: 'Remove', color: '#ccc', uuid: 'tag-uuid-c',
      updated_at: '2026-05-01T08:00:00.000Z', synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteTag({
      local_uuid: 'tag-uuid-c',
      updated_at: '2026-05-02T08:00:00.000Z',
      deleted:    true,
    });

    expect(changed).toBe(true);
    expect(db.tags.get('tag-uuid-c').deleted).toBe(1);
  });

  it('skips tag with matching synced timestamp (already up to date)', () => {
    db.tags.set('tag-uuid-d', {
      id: 22, name: 'Stable', color: '#ddd', uuid: 'tag-uuid-d',
      updated_at: '2026-05-01T08:00:00.000Z', synced_at: '2026-05-01T08:01:00.000Z', deleted: 0,
    });

    const changed = engine._applyRemoteTag({
      local_uuid: 'tag-uuid-d',
      name:       'Stable',
      color:      '#ddd',
      updated_at: '2026-05-01T08:00:00.000Z',
      deleted:    false,
    });

    expect(changed).toBe(false);
  });

  it('does not update when remote is older than local', () => {
    db.tags.set('tag-uuid-e', {
      id: 23, name: 'Current', color: '#eee', uuid: 'tag-uuid-e',
      updated_at: '2026-05-01T12:00:00.000Z', synced_at: null, deleted: 0,
    });

    const changed = engine._applyRemoteTag({
      local_uuid: 'tag-uuid-e',
      name:       'Stale',
      color:      '#000',
      updated_at: '2026-05-01T08:00:00.000Z',
      deleted:    false,
    });

    expect(changed).toBe(false);
    expect(db.tags.get('tag-uuid-e').name).toBe('Current');
  });
});

// ─── Offline queue ────────────────────────────────────────────────────────────

describe('PocketBaseSyncEngine offline queue', () => {
  let engine, db;
  beforeEach(() => ({ engine, db } = makeEngine()));

  it('enqueues an entry action when engine is not started', async () => {
    await engine.pushEntry('uuid-x');
    expect(db.queue.length).toBe(1);
    expect(db.queue[0]).toMatchObject({ entity_type: 'entry', entity_uuid: 'uuid-x', action: 'upsert' });
  });

  it('enqueues a tag action when engine is not started', async () => {
    await engine.pushTag('tag-uuid-z');
    expect(db.queue.length).toBe(1);
    expect(db.queue[0]).toMatchObject({ entity_type: 'tag', entity_uuid: 'tag-uuid-z', action: 'upsert' });
  });

  it('enqueues active timer upsert when engine is not started', async () => {
    await engine.pushActiveTimer({ description: 'Working', startTime: '2026-05-01T09:00:00.000Z', tagIds: [] });
    expect(db.queue.length).toBe(1);
    expect(db.queue[0]).toMatchObject({ entity_type: 'active_timer', action: 'upsert' });
  });

  it('enqueues active timer delete when engine is not started', async () => {
    await engine.pushActiveTimer(null);
    expect(db.queue.length).toBe(1);
    expect(db.queue[0]).toMatchObject({ entity_type: 'active_timer', action: 'delete' });
  });
});

// ─── Status and lifecycle ─────────────────────────────────────────────────────

describe('PocketBaseSyncEngine status and lifecycle', () => {
  it('initial status is "connecting"', () => {
    const { engine } = makeEngine();
    expect(engine.getStatus().state).toBe('connecting');
  });

  it('calls onStatusChanged("disconnected") on stop()', () => {
    const { engine, callbacks } = makeEngine();
    engine.stop();
    expect(callbacks.onStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'disconnected' })
    );
  });

  it('reaches "synced" after successful start()', async () => {
    const { engine, callbacks } = makeEngine();
    await engine.start();
    expect(callbacks.onStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'synced' })
    );
    engine.stop();
  });

  it('does not double-start when start() is called twice', async () => {
    const { engine } = makeEngine();
    let startCount = 0;
    engine._initialSync       = async () => { startCount++; };
    engine._listenActiveTimer = async () => {};
    engine._listenEntries     = async () => {};
    engine._listenTags        = async () => {};
    engine._drainQueue        = async () => {};

    await engine.start();
    await engine.start();
    expect(startCount).toBe(1);
    engine.stop();
  });

  it('getStatus reflects current state', async () => {
    const { engine } = makeEngine();
    await engine.start();
    expect(engine.getStatus()).toMatchObject({ state: 'synced' });
    engine.stop();
    expect(engine.getStatus()).toMatchObject({ state: 'disconnected' });
  });
});

// ─── _getSyncWindowStart ─────────────────────────────────────────────────────

describe('PocketBaseSyncEngine._getSyncWindowStart', () => {
  it('returns an ISO string approximately one year in the past', () => {
    const { engine } = makeEngine();
    const result   = engine._getSyncWindowStart();
    const expected = new Date();
    expected.setFullYear(expected.getFullYear() - 1);
    const diffMs   = Math.abs(new Date(result).getTime() - expected.getTime());
    expect(diffMs).toBeLessThan(5000);
  });
});

// ─── pb-auth.js ───────────────────────────────────────────────────────────────
// electron is mocked via Module._cache patch in tests/setup.js.
// fs is NOT mocked — we use the real filesystem in a temp directory.
// The TEST_USERDATA dir is set in setup.js to match what the electron mock
// returns for app.getPath('userData').

import * as pbAuth from '../src/main/pb-auth.js';

const PB_AUTH_FILE = path.join(TEST_USERDATA, 'pb-auth.enc');

function cleanAuthFile() {
  try { fs.unlinkSync(PB_AUTH_FILE); } catch {}
}

function ensureTestDir() {
  try { fs.mkdirSync(TEST_USERDATA, { recursive: true }); } catch {}
}

describe('pb-auth: signIn', () => {
  beforeEach(() => { ensureTestDir(); cleanAuthFile(); });
  afterEach(() => cleanAuthFile());

  it('returns a serialized user on success', async () => {
    const pb   = buildFakePb();
    const user = await pbAuth.signIn(pb, 'user@example.com', 'password123');
    expect(user).toMatchObject({ uid: 'uid123', email: 'user@example.com', displayName: 'Test User' });
  });

  it('throws on bad credentials', async () => {
    const pb = buildFakePb();
    await expect(pbAuth.signIn(pb, 'bad@bad.com', 'wrong')).rejects.toThrow('Wrong credentials');
  });

  it('notifies auth-state listeners on sign-in', async () => {
    const pb     = buildFakePb();
    const events = [];
    const unsub  = pbAuth.onAuthStateChanged(u => events.push(u));
    await pbAuth.signIn(pb, 'user@example.com', 'pw');
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ email: 'user@example.com' });
    unsub();
  });

  it('persists an auth token to the stored file', async () => {
    const pb = buildFakePb();
    pb.authStore._token = 'tok-abc';
    await pbAuth.signIn(pb, 'user@example.com', 'pw');
    expect(fs.existsSync(PB_AUTH_FILE)).toBe(true);
  });
});

describe('pb-auth: signOut', () => {
  beforeEach(() => { ensureTestDir(); cleanAuthFile(); });
  afterEach(() => cleanAuthFile());

  it('clears the current user and notifies listeners', async () => {
    const pb = buildFakePb();
    await pbAuth.signIn(pb, 'user@example.com', 'pw');
    const events = [];
    const unsub  = pbAuth.onAuthStateChanged(u => events.push(u));
    await pbAuth.signOut(pb);
    expect(pbAuth.getAuthState()).toBeNull();
    expect(events.at(-1)).toBeNull();
    unsub();
  });

  it('removes the stored token file', async () => {
    const pb = buildFakePb();
    await pbAuth.signIn(pb, 'user@example.com', 'pw');
    expect(fs.existsSync(PB_AUTH_FILE)).toBe(true);
    await pbAuth.signOut(pb);
    expect(fs.existsSync(PB_AUTH_FILE)).toBe(false);
  });
});

describe('pb-auth: trySilentSignIn', () => {
  beforeEach(() => { ensureTestDir(); cleanAuthFile(); });
  afterEach(() => cleanAuthFile());

  it('returns null when no token is stored', async () => {
    const pb = buildFakePb();
    expect(await pbAuth.trySilentSignIn(pb)).toBeNull();
  });

  it('restores the session when a valid token is stored', async () => {
    const pb = buildFakePb();
    // Write a valid token file directly (simulate a previous sign-in)
    fs.writeFileSync(PB_AUTH_FILE, JSON.stringify({
      token: 'tok_valid',
      record: { id: 'uid123', email: 'user@example.com', name: 'Test User' },
    }));
    // authRefresh will succeed and return a new token
    const user = await pbAuth.trySilentSignIn(pb);
    expect(user).toMatchObject({ email: 'user@example.com' });
  });

  it('returns null and clears file when authStore.isValid is false', async () => {
    // Build a pb where isValid always returns false
    const pb = buildFakePb();
    // Override isValid to always be false
    Object.defineProperty(pb.authStore, 'isValid', { get: () => false, configurable: true });
    // Write a token file
    fs.writeFileSync(PB_AUTH_FILE, JSON.stringify({ token: 'bad', record: { id: 'u1', email: 'x@x.com' } }));
    const user = await pbAuth.trySilentSignIn(pb);
    expect(user).toBeNull();
    expect(fs.existsSync(PB_AUTH_FILE)).toBe(false);
  });
});

describe('pb-auth: listener unsubscribe', () => {
  it('stops receiving events after the unsubscribe function is called', async () => {
    const pb     = buildFakePb();
    const events = [];
    const unsub  = pbAuth.onAuthStateChanged(u => events.push(u));
    unsub();
    await pbAuth.signIn(pb, 'user@example.com', 'pw');
    expect(events.length).toBe(0);
  });
});

// ─── pocketbase.js client factory ────────────────────────────────────────────

import {
  initPocketBase,
  getPocketBase,
  isPocketBaseInitialized,
  resetPocketBase,
} from '../src/main/pocketbase.js';

describe('pocketbase.js client factory', () => {
  afterEach(() => resetPocketBase());

  it('isPocketBaseInitialized() returns false before init', () => {
    expect(isPocketBaseInitialized()).toBe(false);
  });

  it('initPocketBase() returns a client instance', () => {
    const pb = initPocketBase('http://localhost:8090');
    expect(isPocketBaseInitialized()).toBe(true);
    expect(getPocketBase()).toBe(pb);
  });

  it('resetPocketBase() clears the cached instance', () => {
    initPocketBase('http://localhost:8090');
    resetPocketBase();
    expect(isPocketBaseInitialized()).toBe(false);
  });

  it('calling initPocketBase() twice creates a fresh instance', () => {
    const pb1 = initPocketBase('http://localhost:8090');
    const pb2 = initPocketBase('http://remotehost:8090');
    expect(pb2).not.toBe(pb1);
    expect(getPocketBase()).toBe(pb2);
  });
});
