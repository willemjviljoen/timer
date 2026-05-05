// Lazy-load electron APIs so this module can be required outside the Electron
// runtime (e.g. in Vitest tests) without errors.
function _electron() {
  return require('electron');
}
function _safeStorage() { return _electron().safeStorage; }
function _app()         { return _electron().app; }

const path = require('path');
const fs   = require('fs');

let currentUser = null;
let authStateListeners = [];

function getTokenPath() {
  return path.join(_app().getPath('userData'), 'pb-auth.enc');
}

// ─── Token persistence ───────────────────────────────────────────

function storeAuth(token, record) {
  try {
    const data = JSON.stringify({ token, record });
    if (_safeStorage().isEncryptionAvailable()) {
      const encrypted = _safeStorage().encryptString(data);
      fs.writeFileSync(getTokenPath(), encrypted);
    } else {
      // Fall back to plain text when OS encryption is unavailable
      fs.writeFileSync(getTokenPath(), data, 'utf-8');
    }
  } catch (e) {
    console.warn('[pb-auth] Failed to store auth:', e.message);
  }
}

function loadAuth() {
  const p = getTokenPath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = fs.readFileSync(p);
    const data = _safeStorage().isEncryptionAvailable()
      ? _safeStorage().decryptString(raw)
      : raw.toString('utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function clearAuth() {
  const p = getTokenPath();
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch {}
  }
}

// ─── User serialization ──────────────────────────────────────────

function serializeUser(record) {
  if (!record) return null;
  return {
    uid:         record.id,
    email:       record.email,
    displayName: record.name || record.username || record.email,
    photoURL:    null,
  };
}

// ─── Listeners ───────────────────────────────────────────────────

function notifyListeners(user) {
  for (const cb of authStateListeners) {
    try { cb(user); } catch (e) { console.error('[pb-auth] Listener error:', e); }
  }
}

// ─── Public API ──────────────────────────────────────────────────

async function signIn(pb, email, password) {
  const authData = await pb.collection('users').authWithPassword(email, password);
  storeAuth(pb.authStore.token, authData.record);
  currentUser = serializeUser(authData.record);
  notifyListeners(currentUser);
  return currentUser;
}

async function signOut(pb) {
  clearAuth();
  pb.authStore.clear();
  currentUser = null;
  notifyListeners(null);
}

/**
 * Attempt silent sign-in using stored credentials.
 * Returns the user object on success, null otherwise.
 */
async function trySilentSignIn(pb) {
  const stored = loadAuth();
  if (!stored) return null;

  try {
    pb.authStore.save(stored.token, stored.record);
    if (!pb.authStore.isValid) {
      clearAuth();
      return null;
    }

    // Refresh the token so it stays valid
    const authData = await pb.collection('users').authRefresh();
    storeAuth(pb.authStore.token, authData.record);
    currentUser = serializeUser(authData.record);
    notifyListeners(currentUser);
    return currentUser;
  } catch (err) {
    console.warn('[pb-auth] Silent sign-in failed:', err.message);
    clearAuth();
    pb.authStore.clear();
    return null;
  }
}

function getAuthState() {
  return currentUser;
}

function onAuthStateChanged(callback) {
  authStateListeners.push(callback);
  return () => {
    authStateListeners = authStateListeners.filter(cb => cb !== callback);
  };
}

module.exports = { signIn, signOut, trySilentSignIn, getAuthState, onAuthStateChanged };
