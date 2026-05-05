const crypto = require('crypto');

const RETRY_INTERVALS = [5000, 15000, 30000, 60000];

/**
 * PocketBase sync engine — mirrors the SyncEngine (Firebase) interface so that
 * main.js can treat both backends uniformly.
 *
 * Required PocketBase collections
 * ────────────────────────────────
 * time_entries:
 *   user (relation → users), local_uuid (text), description (text),
 *   start_time (text), end_time (text), duration_ms (number),
 *   tag_uuids (json), deleted (bool), updated_at (text), created_at_local (text)
 *
 * tags:
 *   user (relation → users), local_uuid (text), name (text),
 *   color (text), deleted (bool), updated_at (text)
 *
 * active_timers:
 *   user (relation → users), description (text), start_time (text),
 *   tag_ids (json), device_id (text), updated_at (text)
 *
 * Recommended collection rules (all collections):
 *   List/View: user = @request.auth.id
 *   Create:    @request.auth.id != ""
 *   Update:    user = @request.auth.id
 *   Delete:    user = @request.auth.id
 */
class PocketBaseSyncEngine {
  constructor(opts) {
    this.db        = opts.db;
    this.pb        = opts.pb;
    this.uid       = opts.uid;
    this.deviceId  = opts.deviceId;

    this.onActiveTimerChanged = opts.onActiveTimerChanged || (() => {});
    this.onEntriesUpdated     = opts.onEntriesUpdated     || (() => {});
    this.onTagsUpdated        = opts.onTagsUpdated        || (() => {});
    this.onConflictResolved   = opts.onConflictResolved   || (() => {});
    this.onStatusChanged      = opts.onStatusChanged      || (() => {});

    this._unsubscribers       = [];
    this._status              = 'connecting';
    this._statusMessage       = '';
    this._isStarted           = false;
    this._processingRemoteTimer = false;
    this._fetchedRanges       = [];
    this._retryCount          = 0;
    this._retryTimer          = null;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async start() {
    if (this._isStarted) return;
    this._isStarted = true;
    this._retryCount = 0;
    this._setStatus('syncing');
    console.log(`[pb-sync] Starting for uid=${this.uid}, device=${this.deviceId}`);

    try {
      await this._initialSync();
      if (!this._isStarted) return;

      await this._listenActiveTimer();
      await this._listenEntries();
      await this._listenTags();

      await this._drainQueue();
      if (!this._isStarted) return;

      console.log('[pb-sync] Started successfully');
      this._setStatus('synced');
    } catch (err) {
      console.error('[pb-sync] start error:', err);
      this._setStatus('error', err.message);
      this._scheduleRetry();
    }
  }

  stop() {
    this._isStarted = false;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    for (const unsub of this._unsubscribers) {
      try { if (typeof unsub === 'function') unsub(); } catch {}
    }
    this._unsubscribers = [];
    this._setStatus('disconnected');
  }

  getStatus() {
    return { state: this._status, message: this._statusMessage };
  }

  _setStatus(status, message) {
    this._status        = status;
    this._statusMessage = message || '';
    this.onStatusChanged({ state: status, message: this._statusMessage });
  }

  _scheduleRetry() {
    if (!this._isStarted) return;
    const delay = RETRY_INTERVALS[Math.min(this._retryCount, RETRY_INTERVALS.length - 1)];
    this._retryCount++;
    console.log(`[pb-sync] Retry #${this._retryCount} in ${delay / 1000}s...`);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!this._isStarted) return;
      for (const unsub of this._unsubscribers) {
        try { if (typeof unsub === 'function') unsub(); } catch {}
      }
      this._unsubscribers = [];
      this._isStarted = false;
      this.start();
    }, delay);
  }

  // ─── Initial Sync ────────────────────────────────────────────────

  async _initialSync() {
    await Promise.all([
      this._pushAllUnsynced('time_entries', 'entry'),
      this._pushAllUnsynced('tags', 'tag'),
    ]);
  }

  async _pushAllUnsynced(table, type) {
    const rows = this.db.prepare(
      `SELECT uuid FROM ${table} WHERE synced_at IS NULL AND uuid IS NOT NULL AND deleted = 0`
    ).all();

    console.log(`[pb-sync] Pushing ${rows.length} unsynced ${type}(s)...`);
    for (const row of rows) {
      try {
        if (type === 'entry') await this._pushEntryToPB(row.uuid);
        else                  await this._pushTagToPB(row.uuid);
      } catch (err) {
        console.warn(`[pb-sync] Failed to push ${type} ${row.uuid}:`, err.message);
      }
    }
  }

  // ─── Active Timer ────────────────────────────────────────────────

  async pushActiveTimer(data) {
    if (!this._isStarted) {
      this._queueAction('active_timer', null, data ? 'upsert' : 'delete', data);
      return;
    }

    try {
      let existing = null;
      try {
        existing = await this.pb.collection('active_timers')
          .getFirstListItem(`user="${this.uid}"`);
      } catch { /* no record yet */ }

      if (data) {
        const payload = {
          user:        this.uid,
          description: data.description,
          start_time:  data.startTime,
          tag_ids:     JSON.stringify(data.tagIds || []),
          device_id:   this.deviceId,
          updated_at:  new Date().toISOString(),
        };
        if (existing) {
          await this.pb.collection('active_timers').update(existing.id, payload);
        } else {
          await this.pb.collection('active_timers').create(payload);
        }
      } else {
        if (existing) await this.pb.collection('active_timers').delete(existing.id);
      }
    } catch (err) {
      console.warn('[pb-sync] pushActiveTimer error:', err.message);
      this._queueAction('active_timer', null, data ? 'upsert' : 'delete', data);
    }
  }

  async _listenActiveTimer() {
    // Fetch current remote state first
    try {
      const existing = await this.pb.collection('active_timers')
        .getFirstListItem(`user="${this.uid}"`);
      this._handleRemoteActiveTimer(existing);
    } catch { /* no record */ }

    const unsub = await this.pb.collection('active_timers').subscribe('*', (e) => {
      if (e.record.user !== this.uid) return;
      this._handleRemoteActiveTimer(e.action === 'delete' ? null : e.record);
    });
    this._unsubscribers.push(unsub);
  }

  _handleRemoteActiveTimer(remote) {
    if (remote && remote.device_id === this.deviceId) return;

    const local = this.db.prepare(
      'SELECT description, start_time FROM active_timer WHERE id = 1'
    ).get();

    if (remote && local) {
      if (this._processingRemoteTimer) return;
      this._processingRemoteTimer = true;
      this._resolveActiveTimerConflict(local, remote);
    } else if (remote && !local) {
      let tagIds = [];
      try { tagIds = JSON.parse(remote.tag_ids || '[]'); } catch {}

      this.db.prepare(`
        INSERT OR REPLACE INTO active_timer (id, description, start_time)
        VALUES (1, ?, ?)
      `).run(remote.description, remote.start_time);

      this.onActiveTimerChanged({
        description: remote.description,
        startTime:   remote.start_time,
        tagIds,
        source:      'remote',
      });
    } else if (!remote && local) {
      this.db.prepare('DELETE FROM active_timer WHERE id = 1').run();
      this.onActiveTimerChanged(null);
    }
  }

  _resolveActiveTimerConflict(local, remote) {
    const now        = new Date().toISOString();
    const durationMs = Date.now() - new Date(remote.start_time).getTime();

    const uuid = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(remote.description, remote.start_time, now, Math.max(0, durationMs), uuid, now);

    this._pushEntryToPB(uuid).catch(() => {
      this._queueAction('entry', uuid, 'upsert', null);
    });

    this.pushActiveTimer({
      description: local.description,
      startTime:   local.start_time,
      tagIds:      [],
    }).finally(() => { this._processingRemoteTimer = false; });

    this.onConflictResolved(
      `A timer "${remote.description}" from another device was auto-saved as a completed entry.`
    );
    this.onEntriesUpdated();
  }

  // ─── Entries ─────────────────────────────────────────────────────

  async pushEntry(uuid) {
    if (!this._isStarted) {
      this._queueAction('entry', uuid, 'upsert', null);
      return;
    }
    try {
      await this._pushEntryToPB(uuid);
    } catch (err) {
      console.warn('[pb-sync] pushEntry error:', err.message);
      this._queueAction('entry', uuid, 'upsert', null);
    }
  }

  async _pushEntryToPB(uuid) {
    const entry = this.db.prepare('SELECT * FROM time_entries WHERE uuid = ?').get(uuid);
    if (!entry) return;

    const tagRows = this.db.prepare(`
      SELECT t.uuid FROM entry_tags et
      JOIN tags t ON t.id = et.tag_id
      WHERE et.entry_id = ?
    `).all(entry.id);
    const tagUuids = tagRows.map(r => r.uuid).filter(Boolean);

    const payload = {
      user:            this.uid,
      local_uuid:      uuid,
      description:     entry.description,
      start_time:      entry.start_time,
      end_time:        entry.end_time,
      duration_ms:     entry.duration_ms,
      tag_uuids:       JSON.stringify(tagUuids),
      deleted:         entry.deleted === 1,
      updated_at:      entry.updated_at || new Date().toISOString(),
      created_at_local: entry.created_at,
    };

    let existing = null;
    try {
      existing = await this.pb.collection('time_entries')
        .getFirstListItem(`local_uuid="${uuid}"&&user="${this.uid}"`);
    } catch { /* not found */ }

    if (existing) {
      await this.pb.collection('time_entries').update(existing.id, payload);
    } else {
      await this.pb.collection('time_entries').create(payload);
    }

    this.db.prepare('UPDATE time_entries SET synced_at = ? WHERE uuid = ?')
      .run(new Date().toISOString(), uuid);
  }

  async _listenEntries() {
    // Pull recent entries from PocketBase on connect
    const windowStart = this._getSyncWindowStart();
    try {
      const records = await this.pb.collection('time_entries').getFullList({
        filter: `user="${this.uid}"&&start_time>="${windowStart}"`,
      });
      let changed = false;
      for (const record of records) {
        if (this._applyRemoteEntry(record)) changed = true;
      }
      if (changed) this.onEntriesUpdated();
    } catch (err) {
      console.warn('[pb-sync] Initial entries fetch error:', err.message);
    }

    const unsub = await this.pb.collection('time_entries').subscribe('*', (e) => {
      if (e.record.user !== this.uid) return;
      if (this._applyRemoteEntry(e.record)) this.onEntriesUpdated();
    });
    this._unsubscribers.push(unsub);
  }

  _applyRemoteEntry(record) {
    const uuid = record.local_uuid;
    if (!uuid) return false;

    const local = this.db.prepare(
      'SELECT updated_at, synced_at FROM time_entries WHERE uuid = ?'
    ).get(uuid);

    // Skip if already synced with same timestamp
    if (local && local.synced_at && local.updated_at === record.updated_at) return false;

    if (record.deleted) {
      this.db.prepare(
        'UPDATE time_entries SET deleted = 1, updated_at = ?, synced_at = ? WHERE uuid = ?'
      ).run(record.updated_at, new Date().toISOString(), uuid);
      return true;
    }

    if (!local) {
      const result = this.db.prepare(`
        INSERT INTO time_entries
          (description, start_time, end_time, duration_ms, uuid, updated_at, synced_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.description, record.start_time, record.end_time, record.duration_ms,
        uuid, record.updated_at, new Date().toISOString(),
        record.created_at_local || record.created,
      );

      if (record.tag_uuids) {
        let tagUuids = [];
        try { tagUuids = JSON.parse(record.tag_uuids); } catch {}
        if (tagUuids.length > 0) {
          const entryId = result.lastInsertRowid;
          const ins = this.db.prepare(
            'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?'
          );
          for (const tagUuid of tagUuids) ins.run(entryId, tagUuid);
        }
      }
      return true;
    }

    if (record.updated_at > local.updated_at) {
      this.db.prepare(`
        UPDATE time_entries
        SET description = ?, start_time = ?, end_time = ?, duration_ms = ?,
            updated_at = ?, synced_at = ?
        WHERE uuid = ?
      `).run(
        record.description, record.start_time, record.end_time, record.duration_ms,
        record.updated_at, new Date().toISOString(), uuid,
      );

      if (record.tag_uuids) {
        let tagUuids = [];
        try { tagUuids = JSON.parse(record.tag_uuids); } catch {}
        const row = this.db.prepare('SELECT id FROM time_entries WHERE uuid = ?').get(uuid);
        if (row) {
          this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(row.id);
          const ins = this.db.prepare(
            'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?'
          );
          for (const tagUuid of tagUuids) ins.run(row.id, tagUuid);
        }
      }
      return true;
    }

    return false;
  }

  _getSyncWindowStart() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }

  async fetchEntriesForRange(startDate, endDate) {
    if (!this._isStarted) return false;
    const rangeKey = `${startDate}_${endDate}`;
    if (this._fetchedRanges.includes(rangeKey)) return false;

    try {
      const records = await this.pb.collection('time_entries').getFullList({
        filter: `user="${this.uid}"&&start_time>="${startDate}"&&start_time<="${endDate}"&&deleted=false`,
      });

      let changed = false;
      for (const record of records) {
        const uuid = record.local_uuid;
        if (!uuid) continue;
        const existing = this.db.prepare('SELECT uuid FROM time_entries WHERE uuid = ?').get(uuid);
        if (existing) continue;

        const result = this.db.prepare(`
          INSERT INTO time_entries
            (description, start_time, end_time, duration_ms, uuid, updated_at, synced_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.description, record.start_time, record.end_time, record.duration_ms,
          uuid, record.updated_at, new Date().toISOString(),
          record.created_at_local || record.created,
        );

        if (record.tag_uuids) {
          let tagUuids = [];
          try { tagUuids = JSON.parse(record.tag_uuids); } catch {}
          if (tagUuids.length > 0) {
            const entryId = result.lastInsertRowid;
            const ins = this.db.prepare(
              'INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?'
            );
            for (const tagUuid of tagUuids) ins.run(entryId, tagUuid);
          }
        }
        changed = true;
      }

      this._fetchedRanges.push(rangeKey);
      if (changed) this.onEntriesUpdated();
      return changed;
    } catch (err) {
      console.warn('[pb-sync] fetchEntriesForRange error:', err.message);
      return false;
    }
  }

  // ─── Tags ─────────────────────────────────────────────────────────

  async pushTag(uuid) {
    if (!this._isStarted) {
      this._queueAction('tag', uuid, 'upsert', null);
      return;
    }
    try {
      await this._pushTagToPB(uuid);
    } catch (err) {
      console.warn('[pb-sync] pushTag error:', err.message);
      this._queueAction('tag', uuid, 'upsert', null);
    }
  }

  async _pushTagToPB(uuid) {
    const tag = this.db.prepare('SELECT * FROM tags WHERE uuid = ?').get(uuid);
    if (!tag) return;

    const payload = {
      user:       this.uid,
      local_uuid: uuid,
      name:       tag.name,
      color:      tag.color,
      deleted:    tag.deleted === 1,
      updated_at: tag.updated_at || new Date().toISOString(),
    };

    let existing = null;
    try {
      existing = await this.pb.collection('tags')
        .getFirstListItem(`local_uuid="${uuid}"&&user="${this.uid}"`);
    } catch { /* not found */ }

    if (existing) {
      await this.pb.collection('tags').update(existing.id, payload);
    } else {
      await this.pb.collection('tags').create(payload);
    }

    this.db.prepare('UPDATE tags SET synced_at = ? WHERE uuid = ?')
      .run(new Date().toISOString(), uuid);
  }

  async _listenTags() {
    // Pull all existing tags from PocketBase on connect
    try {
      const records = await this.pb.collection('tags').getFullList({
        filter: `user="${this.uid}"`,
      });
      let changed = false;
      for (const record of records) {
        if (this._applyRemoteTag(record)) changed = true;
      }
      if (changed) this.onTagsUpdated();
    } catch (err) {
      console.warn('[pb-sync] Initial tags fetch error:', err.message);
    }

    const unsub = await this.pb.collection('tags').subscribe('*', (e) => {
      if (e.record.user !== this.uid) return;
      if (this._applyRemoteTag(e.record)) this.onTagsUpdated();
    });
    this._unsubscribers.push(unsub);
  }

  _applyRemoteTag(record) {
    const uuid = record.local_uuid;
    if (!uuid) return false;

    const local = this.db.prepare(
      'SELECT updated_at, synced_at FROM tags WHERE uuid = ?'
    ).get(uuid);

    if (local && local.synced_at && local.updated_at === record.updated_at) return false;

    if (record.deleted) {
      this.db.prepare(
        'UPDATE tags SET deleted = 1, updated_at = ?, synced_at = ? WHERE uuid = ?'
      ).run(record.updated_at, new Date().toISOString(), uuid);
      return true;
    }

    if (!local) {
      this.db.prepare(
        'INSERT INTO tags (name, color, uuid, updated_at, synced_at) VALUES (?, ?, ?, ?, ?)'
      ).run(record.name, record.color, uuid, record.updated_at, new Date().toISOString());
      return true;
    }

    if (record.updated_at > local.updated_at) {
      this.db.prepare(
        'UPDATE tags SET name = ?, color = ?, updated_at = ?, synced_at = ? WHERE uuid = ?'
      ).run(record.name, record.color, record.updated_at, new Date().toISOString(), uuid);
      return true;
    }

    return false;
  }

  // ─── Offline Queue ────────────────────────────────────────────────

  _queueAction(entityType, entityUuid, action, payload) {
    this.db.prepare(`
      INSERT INTO sync_queue (entity_type, entity_uuid, action, payload)
      VALUES (?, ?, ?, ?)
    `).run(entityType, entityUuid, action, payload ? JSON.stringify(payload) : null);
  }

  async _drainQueue() {
    const items = this.db.prepare('SELECT * FROM sync_queue ORDER BY created_at ASC').all();
    if (items.length === 0) return;

    const deleteStmt = this.db.prepare('DELETE FROM sync_queue WHERE id = ?');

    for (const item of items) {
      try {
        if (item.entity_type === 'entry' && item.entity_uuid) {
          await this._pushEntryToPB(item.entity_uuid);
        } else if (item.entity_type === 'tag' && item.entity_uuid) {
          await this._pushTagToPB(item.entity_uuid);
        } else if (item.entity_type === 'active_timer') {
          const payload = item.payload ? JSON.parse(item.payload) : null;
          await this.pushActiveTimer(payload);
        }
        deleteStmt.run(item.id);
      } catch (err) {
        console.warn(`[pb-sync] Queue drain failed for item ${item.id}:`, err.message);
        break; // Leave remaining items for next attempt
      }
    }
  }
}

module.exports = { PocketBaseSyncEngine };
