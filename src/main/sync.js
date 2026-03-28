const crypto = require('crypto');
const {
  collection, doc, setDoc, onSnapshot, query, where, orderBy, getDocs, Timestamp, writeBatch, getDoc,
} = require('firebase/firestore');
const {
  ref, set, remove, onValue, onDisconnect, serverTimestamp,
} = require('firebase/database');

class SyncEngine {
  /**
   * @param {object} opts
   * @param {object} opts.db              - better-sqlite3 instance
   * @param {object} opts.firestore       - Firestore instance
   * @param {object} opts.rtdb            - Realtime Database instance
   * @param {string} opts.uid             - Firebase user ID
   * @param {string} opts.deviceId        - Unique device identifier
   * @param {function} opts.onActiveTimerChanged - Callback when remote active timer changes
   * @param {function} opts.onEntriesUpdated     - Callback when remote entries change
   * @param {function} opts.onTagsUpdated        - Callback when remote tags change
   * @param {function} opts.onConflictResolved   - Callback when a timer conflict is resolved
   * @param {function} opts.onStatusChanged      - Callback when sync status changes
   */
  constructor(opts) {
    this.db        = opts.db;
    this.firestore = opts.firestore;
    this.rtdb      = opts.rtdb;
    this.uid       = opts.uid;
    this.deviceId  = opts.deviceId;

    this.onActiveTimerChanged = opts.onActiveTimerChanged || (() => {});
    this.onEntriesUpdated     = opts.onEntriesUpdated || (() => {});
    this.onTagsUpdated        = opts.onTagsUpdated || (() => {});
    this.onConflictResolved   = opts.onConflictResolved || (() => {});
    this.onStatusChanged      = opts.onStatusChanged || (() => {});

    this._unsubscribers = [];
    this._status = 'connecting';
    this._isStarted = false;
    this._processingRemoteTimer = false;
    this._fetchedRanges = []; // track which date ranges have been fetched on-demand
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async start() {
    if (this._isStarted) return;
    this._isStarted = true;
    this._setStatus('syncing');

    try {
      // Run initial sync
      await this._initialSync();

      // Attach real-time listeners
      this._listenActiveTimer();
      this._listenEntries();
      this._listenTags();

      // Drain any offline queue
      this._drainQueue();

      this._setStatus('synced');
    } catch (err) {
      console.error('SyncEngine start error:', err);
      this._setStatus('error');
    }
  }

  stop() {
    this._isStarted = false;
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch {}
    }
    this._unsubscribers = [];
    this._setStatus('disconnected');
  }

  getStatus() {
    return { state: this._status };
  }

  _setStatus(status) {
    this._status = status;
    this.onStatusChanged({ state: status });
  }

  // ─── Initial Sync ───────────────────────────────────────────────

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

    for (const row of rows) {
      try {
        if (type === 'entry') await this._pushEntryToFirestore(row.uuid);
        else await this._pushTagToFirestore(row.uuid);
      } catch (err) {
        console.warn(`Failed to push ${type} ${row.uuid}:`, err.message);
      }
    }
  }

  // ─── Active Timer (RTDB) ────────────────────────────────────────

  _getTimerRef() {
    return ref(this.rtdb, `users/${this.uid}/activeTimer`);
  }

  /**
   * Push local active timer state to RTDB.
   * @param {object|null} data - { description, startTime, tagIds } or null to clear
   */
  async pushActiveTimer(data) {
    if (!this._isStarted) {
      this._queueAction('active_timer', null, data ? 'upsert' : 'delete', data);
      return;
    }

    try {
      const timerRef = this._getTimerRef();
      if (data) {
        await set(timerRef, {
          description: data.description,
          startTime:   data.startTime,
          tagIds:      data.tagIds || [],
          updatedBy:   this.deviceId,
          updatedAt:   serverTimestamp(),
        });
        // Auto-clear if this device disconnects unexpectedly
        onDisconnect(timerRef).remove();
      } else {
        await remove(timerRef);
      }
    } catch (err) {
      console.warn('pushActiveTimer error:', err.message);
      this._queueAction('active_timer', null, data ? 'upsert' : 'delete', data);
    }
  }

  _listenActiveTimer() {
    const timerRef = this._getTimerRef();
    const unsub = onValue(timerRef, (snapshot) => {
      const remote = snapshot.val();
      this._handleRemoteActiveTimer(remote);
    });
    this._unsubscribers.push(unsub);
  }

  _handleRemoteActiveTimer(remote) {
    // Ignore our own writes
    if (remote && remote.updatedBy === this.deviceId) return;

    // Check for local running timer
    const local = this.db.prepare('SELECT description, start_time FROM active_timer WHERE id = 1').get();

    if (remote && local) {
      // CONFLICT: both local and remote have running timers
      this._resolveActiveTimerConflict(local, remote);
    } else if (remote && !local) {
      // No local timer — apply remote (the "continue on another PC" flow)
      this.db.prepare(`
        INSERT OR REPLACE INTO active_timer (id, description, start_time)
        VALUES (1, ?, ?)
      `).run(remote.description, remote.startTime);

      this.onActiveTimerChanged({
        description: remote.description,
        startTime:   remote.startTime,
        tagIds:      remote.tagIds || [],
        source:      'remote',
      });
    } else if (!remote && local) {
      // Remote timer cleared — stop local
      this.db.prepare('DELETE FROM active_timer WHERE id = 1').run();
      this.onActiveTimerChanged(null);
    }
    // If both null, nothing to do
  }

  /**
   * Conflict resolution: local timer wins, remote timer is auto-saved as a completed entry.
   */
  _resolveActiveTimerConflict(local, remote) {
    const now = new Date().toISOString();
    const durationMs = Date.now() - new Date(remote.startTime).getTime();

    // Save the remote timer as a completed entry so no time data is lost
    const uuid = crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      remote.description,
      remote.startTime,
      now,
      Math.max(0, durationMs),
      uuid,
      now,
    );

    // Push the auto-saved entry to Firestore
    this._pushEntryToFirestore(uuid).catch(() => {
      this._queueAction('entry', uuid, 'upsert', null);
    });

    // Push local timer to RTDB (local wins)
    this.pushActiveTimer({
      description: local.description,
      startTime:   local.start_time,
      tagIds:      [],
    });

    this.onConflictResolved(
      `A timer "${remote.description}" from another device was auto-saved as a completed entry.`
    );
    this.onEntriesUpdated();
  }

  // ─── Entries (Firestore) ────────────────────────────────────────

  /**
   * Push a single entry to Firestore by its UUID.
   */
  async pushEntry(uuid) {
    if (!this._isStarted) {
      this._queueAction('entry', uuid, 'upsert', null);
      return;
    }

    try {
      await this._pushEntryToFirestore(uuid);
    } catch (err) {
      console.warn('pushEntry error:', err.message);
      this._queueAction('entry', uuid, 'upsert', null);
    }
  }

  async _pushEntryToFirestore(uuid) {
    const entry = this.db.prepare(
      'SELECT * FROM time_entries WHERE uuid = ?'
    ).get(uuid);
    if (!entry) return;

    // Get tag UUIDs for this entry
    const tagRows = this.db.prepare(`
      SELECT t.uuid FROM entry_tags et
      JOIN tags t ON t.id = et.tag_id
      WHERE et.entry_id = ?
    `).all(entry.id);
    const tagIds = tagRows.map(r => r.uuid).filter(Boolean);

    const docRef = doc(this.firestore, `users/${this.uid}/timeEntries`, uuid);
    await setDoc(docRef, {
      description: entry.description,
      startTime:   entry.start_time,
      endTime:     entry.end_time,
      durationMs:  entry.duration_ms,
      tagIds,
      createdAt:   entry.created_at,
      updatedAt:   entry.updated_at || new Date().toISOString(),
      deleted:     entry.deleted === 1,
    });

    // Mark as synced locally
    this.db.prepare('UPDATE time_entries SET synced_at = ? WHERE uuid = ?')
      .run(new Date().toISOString(), uuid);
  }

  _getSyncWindowStart() {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString();
  }

  _listenEntries() {
    const colRef = collection(this.firestore, `users/${this.uid}/timeEntries`);
    const windowStart = this._getSyncWindowStart();
    const q = query(colRef, where('startTime', '>=', windowStart));
    const unsub = onSnapshot(q, (snapshot) => {
      let changed = false;
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        const uuid = change.doc.id;

        // Skip if this is our own recent write (check synced_at)
        const local = this.db.prepare('SELECT updated_at, synced_at FROM time_entries WHERE uuid = ?').get(uuid);
        if (local && local.synced_at && local.updated_at === data.updatedAt) continue;

        if (data.deleted) {
          // Remote soft delete
          this.db.prepare('UPDATE time_entries SET deleted = 1, updated_at = ?, synced_at = ? WHERE uuid = ?')
            .run(data.updatedAt, new Date().toISOString(), uuid);
          changed = true;
        } else if (!local) {
          // New entry from another device
          const result = this.db.prepare(`
            INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at, synced_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            data.description, data.startTime, data.endTime, data.durationMs,
            uuid, data.updatedAt, new Date().toISOString(), data.createdAt,
          );

          // Restore tag associations
          if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
            const entryId = result.lastInsertRowid;
            const ins = this.db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?');
            for (const tagUuid of data.tagIds) {
              ins.run(entryId, tagUuid);
            }
          }
          changed = true;
        } else if (local && data.updatedAt > local.updated_at) {
          // Remote is newer — update local
          this.db.prepare(`
            UPDATE time_entries SET description = ?, start_time = ?, end_time = ?, duration_ms = ?,
              updated_at = ?, synced_at = ?
            WHERE uuid = ?
          `).run(
            data.description, data.startTime, data.endTime, data.durationMs,
            data.updatedAt, new Date().toISOString(), uuid,
          );

          // Update tag associations
          if (Array.isArray(data.tagIds)) {
            const row = this.db.prepare('SELECT id FROM time_entries WHERE uuid = ?').get(uuid);
            if (row) {
              this.db.prepare('DELETE FROM entry_tags WHERE entry_id = ?').run(row.id);
              const ins = this.db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?');
              for (const tagUuid of data.tagIds) {
                ins.run(row.id, tagUuid);
              }
            }
          }
          changed = true;
        }
      }
      if (changed) this.onEntriesUpdated();
    });
    this._unsubscribers.push(unsub);
  }

  /**
   * On-demand fetch for a date range outside the realtime sync window.
   * Called when the user navigates to historical dates in the calendar.
   * Returns true if new entries were pulled, false otherwise.
   */
  async fetchEntriesForRange(startDate, endDate) {
    if (!this._isStarted) return false;

    // Check if this range was already fetched this session
    const rangeKey = `${startDate}_${endDate}`;
    if (this._fetchedRanges.includes(rangeKey)) return false;

    try {
      const colRef = collection(this.firestore, `users/${this.uid}/timeEntries`);
      const q = query(
        colRef,
        where('startTime', '>=', startDate),
        where('startTime', '<=', endDate),
      );
      const snapshot = await getDocs(q);

      let changed = false;
      for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const uuid = docSnap.id;
        if (data.deleted) continue;

        const local = this.db.prepare('SELECT uuid FROM time_entries WHERE uuid = ?').get(uuid);
        if (local) continue; // already have it

        const result = this.db.prepare(`
          INSERT INTO time_entries (description, start_time, end_time, duration_ms, uuid, updated_at, synced_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          data.description, data.startTime, data.endTime, data.durationMs,
          uuid, data.updatedAt, new Date().toISOString(), data.createdAt,
        );

        if (Array.isArray(data.tagIds) && data.tagIds.length > 0) {
          const entryId = result.lastInsertRowid;
          const ins = this.db.prepare('INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) SELECT ?, id FROM tags WHERE uuid = ?');
          for (const tagUuid of data.tagIds) {
            ins.run(entryId, tagUuid);
          }
        }
        changed = true;
      }

      this._fetchedRanges.push(rangeKey);
      if (changed) this.onEntriesUpdated();
      return changed;
    } catch (err) {
      console.warn('fetchEntriesForRange error:', err.message);
      return false;
    }
  }

  // ─── Tags (Firestore) ──────────────────────────────────────────

  async pushTag(uuid) {
    if (!this._isStarted) {
      this._queueAction('tag', uuid, 'upsert', null);
      return;
    }

    try {
      await this._pushTagToFirestore(uuid);
    } catch (err) {
      console.warn('pushTag error:', err.message);
      this._queueAction('tag', uuid, 'upsert', null);
    }
  }

  async _pushTagToFirestore(uuid) {
    const tag = this.db.prepare('SELECT * FROM tags WHERE uuid = ?').get(uuid);
    if (!tag) return;

    const docRef = doc(this.firestore, `users/${this.uid}/tags`, uuid);
    await setDoc(docRef, {
      name:      tag.name,
      color:     tag.color,
      createdAt: tag.created_at || new Date().toISOString(),
      updatedAt: tag.updated_at || new Date().toISOString(),
      deleted:   tag.deleted === 1,
    });

    this.db.prepare('UPDATE tags SET synced_at = ? WHERE uuid = ?')
      .run(new Date().toISOString(), uuid);
  }

  _listenTags() {
    const colRef = collection(this.firestore, `users/${this.uid}/tags`);
    const unsub = onSnapshot(colRef, (snapshot) => {
      let changed = false;
      for (const change of snapshot.docChanges()) {
        const data = change.doc.data();
        const uuid = change.doc.id;

        const local = this.db.prepare('SELECT updated_at, synced_at FROM tags WHERE uuid = ?').get(uuid);
        if (local && local.synced_at && local.updated_at === data.updatedAt) continue;

        if (data.deleted) {
          this.db.prepare('UPDATE tags SET deleted = 1, updated_at = ?, synced_at = ? WHERE uuid = ?')
            .run(data.updatedAt, new Date().toISOString(), uuid);
          changed = true;
        } else if (!local) {
          // New tag from another device
          this.db.prepare(`
            INSERT INTO tags (name, color, uuid, updated_at, synced_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(data.name, data.color, uuid, data.updatedAt, new Date().toISOString());
          changed = true;
        } else if (local && data.updatedAt > local.updated_at) {
          // Remote is newer
          this.db.prepare('UPDATE tags SET name = ?, color = ?, updated_at = ?, synced_at = ? WHERE uuid = ?')
            .run(data.name, data.color, data.updatedAt, new Date().toISOString(), uuid);
          changed = true;
        }
      }
      if (changed) this.onTagsUpdated();
    });
    this._unsubscribers.push(unsub);
  }

  // ─── Offline Queue ──────────────────────────────────────────────

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
          await this._pushEntryToFirestore(item.entity_uuid);
        } else if (item.entity_type === 'tag' && item.entity_uuid) {
          await this._pushTagToFirestore(item.entity_uuid);
        } else if (item.entity_type === 'active_timer') {
          const payload = item.payload ? JSON.parse(item.payload) : null;
          const timerRef = this._getTimerRef();
          if (item.action === 'delete' || !payload) {
            await remove(timerRef);
          } else {
            await set(timerRef, {
              description: payload.description,
              startTime:   payload.startTime,
              tagIds:      payload.tagIds || [],
              updatedBy:   this.deviceId,
              updatedAt:   serverTimestamp(),
            });
            onDisconnect(timerRef).remove();
          }
        }
        deleteStmt.run(item.id);
      } catch (err) {
        console.warn(`Queue drain failed for item ${item.id}:`, err.message);
        // Leave in queue for next attempt
        break;
      }
    }
  }
}

module.exports = { SyncEngine };
