import React, { useState, useEffect } from 'react';

const STATUS_STYLES = {
  synced:       { color: '#22c55e', title: 'Synced' },
  syncing:      { color: '#f59e0b', title: 'Syncing...' },
  connecting:   { color: '#f59e0b', title: 'Connecting...' },
  error:        { color: '#ef4444', title: 'Sync error' },
  disconnected: { color: '#6b7280', title: 'Offline' },
};

export default function SyncStatus() {
  const [status, setStatus] = useState('disconnected');
  const [user, setUser] = useState(null);
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAuthState?.().then(u => setUser(u)).catch(() => {});
    api?.onAuthStateChanged?.(u => setUser(u));
    api?.onSyncStatusChanged?.(s => setStatus(s?.state || 'disconnected'));
    api?.getSyncStatus?.().then(s => setStatus(s?.state || 'disconnected')).catch(() => {});
  }, []);

  // Don't show anything if not signed in
  if (!user) return null;

  const { color, title } = STATUS_STYLES[status] || STATUS_STYLES.disconnected;
  const isSyncing = status === 'syncing' || status === 'connecting';

  return (
    <div
      title={title}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: color,
          display: 'inline-block',
          animation: isSyncing ? 'sync-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      />
    </div>
  );
}
