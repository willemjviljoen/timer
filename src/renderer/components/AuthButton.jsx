import React, { useState, useEffect } from 'react';

export default function AuthButton({ compact = false }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAuthState?.().then(u => setUser(u)).catch(() => {});
    api?.onAuthStateChanged?.(u => setUser(u));
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const result = await api.signIn();
      if (result?.ok) setUser(result.user);
    } catch (err) {
      console.error('Sign-in error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await api.signOut();
    setUser(null);
  };

  if (user) {
    if (compact) {
      return (
        <button
          className="titlebar__btn"
          title={`Signed in as ${user.displayName || user.email}`}
          style={{ opacity: 0.7, cursor: 'default', fontSize: 11 }}
        >
          {user.photoURL ? (
            <img
              src={user.photoURL}
              alt=""
              style={{ width: 16, height: 16, borderRadius: '50%' }}
            />
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
        </button>
      );
    }

    // Full version (for settings modal)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {user.photoURL && (
          <img
            src={user.photoURL}
            alt=""
            style={{ width: 28, height: 28, borderRadius: '50%' }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            {user.displayName || 'User'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {user.email}
          </div>
        </div>
        <button
          className="settings__export-btn"
          onClick={handleSignOut}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          Sign out
        </button>
      </div>
    );
  }

  // Not signed in
  return (
    <button
      className={compact ? 'titlebar__btn' : 'settings__export-btn'}
      onClick={handleSignIn}
      disabled={loading}
      title="Sign in with Google for cloud sync"
      style={compact ? { fontSize: 11, opacity: 0.7 } : {}}
    >
      {loading ? 'Signing in...' : compact ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      ) : 'Sign in with Google'}
    </button>
  );
}
