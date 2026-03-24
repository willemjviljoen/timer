import React, { useState, useCallback, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import TrackerBar from './components/TrackerBar';
import HistoryList from './components/HistoryList';
import EditModal from './components/EditModal';
import DeleteConfirm from './components/DeleteConfirm';
import SavedFlash from './components/SavedFlash';

export default function App() {
  const [showFlash, setShowFlash] = useState(false);
  const [entries, setEntries] = useState([]);
  const [editingEntry, setEditingEntry] = useState(null);
  const [deletingEntry, setDeletingEntry] = useState(null);

  const api = window.electronAPI;

  const loadEntries = useCallback(async () => {
    if (api?.getRecentEntries) {
      try {
        const data = await api.getRecentEntries(50);
        setEntries(data);
      } catch (err) {
        console.error('Failed to load entries:', err);
      }
    }
  }, [api]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const handleEntrySaved = useCallback(() => {
    setShowFlash(true);
    setTimeout(() => setShowFlash(false), 2000);
    loadEntries();
  }, [loadEntries]);

  const handleEditSave = useCallback(async (updated) => {
    if (api?.updateEntry) {
      try {
        await api.updateEntry(updated);
        setEditingEntry(null);
        loadEntries();
      } catch (err) {
        console.error('Failed to update entry:', err);
      }
    }
  }, [api, loadEntries]);

  const handleDeleteConfirm = useCallback(async () => {
    if (api?.deleteEntry && deletingEntry) {
      try {
        await api.deleteEntry(deletingEntry.id);
        setDeletingEntry(null);
        loadEntries();
      } catch (err) {
        console.error('Failed to delete entry:', err);
      }
    }
  }, [api, deletingEntry, loadEntries]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TitleBar />
      <TrackerBar onEntrySaved={handleEntrySaved} />
      <HistoryList
        entries={entries}
        onEdit={(entry) => setEditingEntry(entry)}
        onDelete={(entry) => setDeletingEntry(entry)}
      />
      {editingEntry && (
        <EditModal
          entry={editingEntry}
          onSave={handleEditSave}
          onCancel={() => setEditingEntry(null)}
        />
      )}
      {deletingEntry && (
        <DeleteConfirm
          entry={deletingEntry}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingEntry(null)}
        />
      )}
      {showFlash && <SavedFlash />}
    </div>
  );
}
