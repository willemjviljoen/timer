import React, { useState, useCallback, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import TrackerBar from './components/TrackerBar';
import HistoryList from './components/HistoryList';
import EditModal from './components/EditModal';
import DeleteConfirm from './components/DeleteConfirm';
import SavedFlash from './components/SavedFlash';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [showFlash, setShowFlash] = useState(false);
  const [entries, setEntries] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const [deletingEntry, setDeletingEntry] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ notificationThresholdMinutes: 120 });
  const [updateInfo, setUpdateInfo] = useState(null);

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

  const loadTags = useCallback(async () => {
    if (api?.getTags) {
      try { const tags = await api.getTags(); setAllTags(tags); } catch {}
    }
  }, [api]);

  useEffect(() => {
    loadEntries();
    loadTags();
    refreshSettings();
    setTimeout(() => {
      api?.checkForUpdate?.().then(result => {
        if (result?.ok && result?.hasUpdate) setUpdateInfo(result);
      }).catch(() => {});
    }, 3000);
  }, [loadEntries, loadTags, refreshSettings]);

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

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar onOpenSettings={() => setShowSettings(true)} hasUpdate={!!updateInfo} />
      <TrackerBar
        onEntrySaved={handleEntrySaved}
        settings={settings}
        allTags={allTags}
        onCreateTag={handleCreateTag}
      />
      <HistoryList
        entries={entries}
        allTags={allTags}
        onEdit={entry => { setEditingEntry(entry); setIsNewEntry(false); }}
        onDelete={entry => setDeletingEntry(entry)}
        onCreateFromGap={handleCreateFromGap}
      />

      {editingEntry && (
        isNewEntry ? (
          <EditModal
            entry={editingEntry}
            isNew={true}
            allTags={allTags}
            onCreateTag={handleCreateTag}
            onSave={handleNewEntrySave}
            onCancel={() => { setEditingEntry(null); setIsNewEntry(false); }}
          />
        ) : (
          <EditModal
            entry={editingEntry}
            isNew={false}
            allTags={allTags}
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
        />
      )}
      {showFlash && <SavedFlash />}
    </div>
  );
}
