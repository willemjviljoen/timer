import React, { useState, useEffect } from 'react';

export default function AuthButton({ compact = false, syncBackend = 'firebase', pocketbaseUrl = '' }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  // PocketBase-specific form state
  const [pbEmail, setPbEmail] = useState('');
  const [pbPassword, setPbPassword] = useState('');
  const [pbError, setPbError] = useState('');
  const api = window.electronAPI;

  useEffect(() => {
    api?.getAuthState?.().then(u => setUser(u)).catch(() => {});
    const unsub = api?.onAuthStateChanged?.(u => setUser(u));
    return () => { unsub?.(); };
  }, []);

  // ─── Firebase sign-in ───────────────────────────────────────────
  const handleFirebaseSignIn = async () => {
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

  // ─── PocketBase sign-in ─────────────────────────────────────────
  const handlePbSignIn = async (e) => {
    e?.preventDefault();
    if (!pbEmail || !pbPassword) return;
    setLoading(true);
    setPbError('');
    try {
      const result = await api.pbSignIn(pbEmail, pbPassword);
      if (result?.ok) {
        setUser(result.user);
        setPbEmail('');
        setPbPassword('');
      } else {
        setPbError(result?.error || 'Sign-in failed.');
      }
    } catch (err) {
      setPbError(err.message || 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await api.signOut();
    setUser(null);
  };

  // ─── Signed-in state ────────────────────────────────────────────
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

  // ─── PocketBase login form ──────────────────────────────────────
  if (syncBackend === 'pocketbase') {
    if (compact) {
      return (
        <button
          className="titlebar__btn"
          title="Sign in to PocketBase"
          style={{ fontSize: 11, opacity: 0.7 }}
          disabled
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
        </button>
      );
    }

    return (
      <form onSubmit={handlePbSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="modal__input"
          type="email"
          placeholder="Email"
          value={pbEmail}
          autoComplete="username"
          onChange={e => setPbEmail(e.target.value)}
          disabled={loading}
          required
        />
        <input
          className="modal__input"
          type="password"
          placeholder="Password"
          value={pbPassword}
          autoComplete="current-password"
          onChange={e => setPbPassword(e.target.value)}
          disabled={loading}
          required
        />
        {pbError && (
          <p style={{ fontSize: 12, color: 'var(--danger, #ef4444)', margin: 0 }}>{pbError}</p>
        )}
        <button
          className="settings__export-btn"
          type="submit"
          disabled={loading || !pbEmail || !pbPassword || !pocketbaseUrl}
          style={{ alignSelf: 'flex-start' }}
        >
          {loading ? 'Signing in…' : 'Sign in to PocketBase'}
        </button>
        {!pocketbaseUrl && (
          <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0 }}>
            Enter your PocketBase URL above first.
          </p>
        )}
      </form>
    );
  }

  // ─── Firebase / Google sign-in button ───────────────────────────
  return (
    <button
      className={compact ? 'titlebar__btn' : 'settings__export-btn'}
      onClick={handleFirebaseSignIn}
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
