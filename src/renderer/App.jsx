import React, { useState, useCallback, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import TrackerBar from './components/TrackerBar';
import HistoryList from './components/HistoryList';
import EditModal from './components/EditModal';
import DeleteConfirm from './components/DeleteConfirm';
import SavedFlash from './components/SavedFlash';
import SettingsModal from './components/SettingsModal';
import MiniWidget from './components/MiniWidget';

export default function App() {
  const [showFlash, setShowFlash] = useState(false);
  const [entries, setEntries] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ notificationThresholdMinutes: 120 });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [timerState, setTimerState] = useState({ isRunning: false, description: '', elapsed: 0 });
  const [miniMode, setMiniMode] = useState(false);

  const api = window.electronAPI;

  const refreshSettings = useCallback(async () => {
    if (api?.getSettings) {
      try { const s = await api.getSettings(); setSettings(s); } catch {}
    }
  }, [api]);

  const loadEntries = useCallback(async () => {
    if (api?.getRecentEntries) {
      try {
        const data = await api.getRecentEntries(50);
        setEntries(data);
      } catch (err) { console.error('Failed to load entries:', err); }
    }
  }, [api]);

  const loadMoreEntries = useCallback(async () => {
    if (api?.getRecentEntries) {
      try {
        const data = await api.getRecentEntries(entries.length + 50);
        setEntries(data);
      } catch (err) { console.error('Failed to load more entries:', err); }
    }
  }, [api, entries.length]);

  const loadTags = useCallback(async () => {
    if (api?.getTags) {
      try { const tags = await api.getTags(); setAllTags(tags); } catch {}
    }
  }, [api]);

  const loadProjects = useCallback(async () => {
    if (api?.getProjects) {
      try { const projects = await api.getProjects(); setAllProjects(projects); } catch {}
    }
  }, [api]);

  useEffect(() => {
    loadEntries();
    loadTags();
    loadProjects();
    refreshSettings();
    setTimeout(() => {
      api?.checkForUpdate?.().then(result => {
        if (result?.ok && result?.hasUpdate) setUpdateInfo(result);
      }).catch(() => {});
    }, 3000);
  }, [loadEntries, loadTags, loadProjects, refreshSettings]);

  const flash = useCallback(() => {
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 2000);
  }, []);

  const handleEntrySaved = useCallback(() => {
    flash();
    loadEntries();
  }, [flash, loadEntries]);

  const handleCreateTag = useCallback(async (name, color) => {
    if (api?.createTag) {
      try {
        const tag = await api.createTag({ name, color });
        setAllTags(prev => [...prev, tag]);
        return tag;
      } catch {}
    }
    // Fallback: generate local ID if IPC not available
    const tag = { id: Date.now(), name, color };
    setAllTags(prev => [...prev, tag]);
    return tag;
  }, [api]);

  const handleEditSave = useCallback(async (updated) => {
    if (updated.id === '__active_timer__') {
      window.dispatchEvent(new CustomEvent('update-active-timer', {
        detail: { description: updated.description, startTime: updated.startTime },
      }));
      setEditingEntry(null);
      return;
    }
    if (api?.updateEntry) {
      try {
        await api.updateEntry(updated);
        setEditingEntry(null);
        setIsNewEntry(false);
        loadEntries();
      } catch (err) { console.error('Failed to update entry:', err); }
    }
  }, [api, loadEntries]);

  const handleNewEntrySave = useCallback(async (newEntry) => {
    if (api?.saveEntry) {
      try {
        await api.saveEntry({
          description: newEntry.description,
          startTime: newEntry.startTime || newEntry.start_time,
          endTime: newEntry.endTime || newEntry.end_time,
          durationMs: newEntry.durationMs || newEntry.duration_ms,
          tagIds: newEntry.tagIds || [],
          projectId: newEntry.projectId || null,
        });
        setEditingEntry(null);
        setIsNewEntry(false);
        flash();
        loadEntries();
      } catch (err) { console.error('Failed to create entry:', err); }
    }
  }, [api, loadEntries, flash]);

  const handleDeleteConfirm = useCallback(async () => {
    if (api?.deleteEntry && deletingEntry) {
      try {
        await api.deleteEntry(deletingEntry.id);
        setDeletingEntry(null);
        loadEntries();
      } catch (err) { console.error('Failed to delete entry:', err); }
    }
  }, [api, deletingEntry, loadEntries]);

  const handleCreateFromGap = useCallback((startIso, endIso) => {
    const ms = new Date(endIso) - new Date(startIso);
    setEditingEntry({ id: null, description: '', start_time: startIso, end_time: endIso, duration_ms: ms, tags: [] });
    setIsNewEntry(true);
  }, []);

  // Forward timer state to main process
  useEffect(() => {
    api?.updateTimerState?.(timerState);
  }, [timerState, api]);

  // Ctrl+W to close to tray
  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.key === 'w') { e.preventDefault(); api?.closeWindow?.(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [api]);

  // Listen for thumbbar control events
  useEffect(() => {
    api?.onThumbbarPlayPause?.(() => {
      window.dispatchEvent(new CustomEvent('tracker-play-pause'));
    });

    api?.onThumbbarStop?.(() => {
      window.dispatchEvent(new CustomEvent('tracker-stop'));
    });

    api?.onThumbbarSettings?.(() => {
      setShowSettings(true);
    });
  }, [api]);

  // ─── Sync event listeners ─────────────────────────────────────
  useEffect(() => {
    // Refresh entries when another device creates/updates/deletes entries
    api?.onEntriesSync?.(() => loadEntries());
    // Refresh tags when another device creates/deletes tags
    api?.onTagsSync?.(() => loadTags());
    // Show a brief notification when a timer conflict was resolved
    api?.onSyncConflict?.((message) => {
      console.log('Sync conflict resolved:', message);
      // Trigger a flash to indicate the auto-saved entry
      flash();
    });
  }, [api, loadEntries, loadTags, flash]);

  const handleToggleMiniMode = useCallback(async () => {
    // Notify main process to resize window FIRST
    if (!miniMode) {
      // Switching TO mini mode - resize first (compact!)
      await api?.resizeWindow?.({ width: 300, height: 110 });
    } else {
      // Switching FROM mini mode - resize first
      await api?.resizeWindow?.({ width: 720, height: 680 });
    }
    // Then toggle UI
    setMiniMode(prev => !prev);
  }, [miniMode, api]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {miniMode ? (
        // Mini mode - only show the widget, but keep TrackerBar hidden for event handling
        <>
          <MiniWidget timerState={timerState} onToggleMode={handleToggleMiniMode} />
          <div style={{ display: 'none' }}>
            <TrackerBar
              onEntrySaved={handleEntrySaved}
              settings={settings}
              allTags={allTags}
              allProjects={allProjects}
              onCreateTag={handleCreateTag}
              onTimerStateChange={setTimerState}
            />
          </div>
        </>
      ) : (
        // Full mode
        <>
          <TitleBar
            onOpenSettings={() => setShowSettings(true)}
            hasUpdate={!!updateInfo}
            onToggleMiniMode={handleToggleMiniMode}
          />
          <TrackerBar
            onEntrySaved={handleEntrySaved}
            settings={settings}
            allTags={allTags}
            allProjects={allProjects}
            onCreateTag={handleCreateTag}
            onTimerStateChange={setTimerState}
          />
          <HistoryList
            entries={entries}
            allTags={allTags}
            allProjects={allProjects}
            timerState={timerState}
            onEdit={entry => { setEditingEntry(entry); setIsNewEntry(false); }}
            onDelete={entry => setDeletingEntry(entry)}
            onCreateFromGap={handleCreateFromGap}
            onLoadMore={loadMoreEntries}
          />
        </>
      )}

      {editingEntry && (
        isNewEntry ? (
          <EditModal
            entry={editingEntry}
            isNew={true}
            allTags={allTags}
            allProjects={allProjects}
            onCreateTag={handleCreateTag}
            onSave={handleNewEntrySave}
            onCancel={() => { setEditingEntry(null); setIsNewEntry(false); }}
          />
        ) : (
          <EditModal
            entry={editingEntry}
            isNew={false}
            allTags={allTags}
            allProjects={allProjects}
            onCreateTag={handleCreateTag}
            onSave={handleEditSave}
            onCancel={() => setEditingEntry(null)}
          />
        )
      )}

      {deletingEntry && (
        <DeleteConfirm
          entry={deletingEntry}
          allTags={allTags}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingEntry(null)}
        />
      )}

      {showSettings && (
        <SettingsModal
          onClose={() => { setShowSettings(false); refreshSettings(); }}
          onSaved={refreshSettings}
          updateInfo={updateInfo}
          allProjects={allProjects}
          onProjectsChanged={loadProjects}
        />
      )}
      {showFlash && <SavedFlash />}
    </div>
  );
}
