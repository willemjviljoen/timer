import React, { useState, useEffect } from 'react';

const STATUS_STYLES = {
  synced:       { color: '#22c55e', label: 'Synced',         icon: '●' },
  syncing:      { color: '#f59e0b', label: 'Syncing...',     icon: '●' },
  connecting:   { color: '#f59e0b', label: 'Connecting...',  icon: '●' },
  error:        { color: '#ef4444', label: 'Sync error',     icon: '!' },
  disconnected: { color: '#6b7280', label: 'Offline',        icon: '●' },
};

export default function SyncStatus() {
  const [status, setStatus] = useState('disconnected');
  const [message, setMessage] = useState('');
  const [user, setUser] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAuthState?.().then(u => setUser(u)).catch(() => {});
    api?.getSyncStatus?.().then(s => {
      setStatus(s?.state || 'disconnected');
      setMessage(s?.message || '');
    }).catch(() => {});
    const unsubAuth = api?.onAuthStateChanged?.(u => setUser(u));
    const unsubSync = api?.onSyncStatusChanged?.(s => {
      setStatus(s?.state || 'disconnected');
      setMessage(s?.message || '');
    });
    return () => { unsubAuth?.(); unsubSync?.(); };
  }, []);

  // Don't show anything if not signed in
  if (!user) return null;

  const style = STATUS_STYLES[status] || STATUS_STYLES.disconnected;
  const isSyncing = status === 'syncing' || status === 'connecting';
  const isError = status === 'error';
  const tooltipText = message ? `${style.label}: ${message}` : style.label;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 4px',
        position: 'relative',
        cursor: isError ? 'help' : 'default',
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          width: isError ? 'auto' : 7,
          height: isError ? 'auto' : 7,
          borderRadius: isError ? 3 : '50%',
          background: isError ? 'transparent' : style.color,
          color: style.color,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: isError ? 10 : 'inherit',
          fontWeight: isError ? 700 : 'normal',
          lineHeight: 1,
          animation: isSyncing ? 'sync-pulse 1.2s ease-in-out infinite' : 'none',
        }}
      >
        {isError ? '⚠' : ''}
      </span>
      {showTooltip && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: 6,
          padding: '4px 8px',
          background: '#1f2937',
          color: '#f9fafb',
          fontSize: 11,
          borderRadius: 4,
          whiteSpace: 'nowrap',
          zIndex: 1000,
          pointerEvents: 'none',
        }}>
          {tooltipText}
        </div>
      )}
    </div>
  );
}
