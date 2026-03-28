const { shell, safeStorage } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { initFirebase, getFirebaseAuth } = require('./firebase');
const { GoogleAuthProvider, signInWithCredential } = require('firebase/auth');

// Google OAuth client credentials — loaded from .env (see .env.example).
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

let currentUser = null;
let authStateListeners = [];

function getTokenPath() {
  return path.join(app.getPath('userData'), 'auth-token.enc');
}

/**
 * Exchange an authorization code for tokens using Google's token endpoint.
 */
function exchangeCodeForTokens(code, redirectUri) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  redirectUri,
      grant_type:    'authorization_code',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length':  Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tokens = JSON.parse(data);
          if (tokens.error) reject(new Error(tokens.error_description || tokens.error));
          else resolve(tokens);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Refresh an access token using a stored refresh token.
 */
function refreshAccessToken(refreshToken) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length':  Buffer.byteLength(postData),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const tokens = JSON.parse(data);
          if (tokens.error) reject(new Error(tokens.error_description || tokens.error));
          else resolve(tokens);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Store the refresh token securely using Electron's safeStorage.
 */
function storeRefreshToken(refreshToken) {
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(refreshToken);
    fs.writeFileSync(getTokenPath(), encrypted);
  } else {
    console.warn('safeStorage encryption unavailable — refresh token will not be persisted. Sign-in will be required on next launch.');
  }
}

/**
 * Load the stored refresh token.
 */
function loadRefreshToken() {
  const tokenPath = getTokenPath();
  if (!fs.existsSync(tokenPath)) return null;

  try {
    const raw = fs.readFileSync(tokenPath);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw);
    }
    return raw.toString('utf-8');
  } catch {
    return null;
  }
}

/**
 * Clear stored tokens.
 */
function clearStoredTokens() {
  const tokenPath = getTokenPath();
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }
}

/**
 * Sign in to Firebase using a Google ID token.
 */
async function signInToFirebase(idToken) {
  const { auth } = initFirebase();
  const credential = GoogleAuthProvider.credential(idToken);
  const userCredential = await signInWithCredential(auth, credential);
  currentUser = userCredential.user;
  notifyListeners(currentUser);
  return currentUser;
}

/**
 * Full sign-in flow: loopback OAuth → exchange code → Firebase sign-in.
 */
function signIn() {
  return new Promise((resolve, reject) => {
    // Create a temporary HTTP server on a random port
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      // Build the Google OAuth URL
      const params = new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        redirect_uri:  redirectUri,
        response_type: 'code',
        scope:         'openid email profile',
        access_type:   'offline',
        prompt:        'consent',
      });
      const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;

      // Open in the user's default browser
      shell.openExternal(authUrl);

      // Handle the callback
      server.on('request', async (req, res) => {
        if (!req.url.startsWith('/callback')) return;

        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const code  = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error || !code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Sign-in cancelled.</h2><p>You can close this tab.</p></body></html>');
          server.close();
          reject(new Error(error || 'No authorization code received'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Signed in successfully!</h2><p>You can close this tab and return to TimeTracker.</p></body></html>');
        server.close();

        try {
          const tokens = await exchangeCodeForTokens(code, redirectUri);

          // Store the refresh token for silent re-auth on future launches
          if (tokens.refresh_token) {
            storeRefreshToken(tokens.refresh_token);
          }

          const user = await signInToFirebase(tokens.id_token);
          resolve(serializeUser(user));
        } catch (err) {
          reject(err);
        }
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('Sign-in timed out'));
      }, 120000);
    });
  });
}

/**
 * Sign out: clear tokens, sign out of Firebase.
 */
async function signOut() {
  clearStoredTokens();
  const auth = getFirebaseAuth();
  if (auth) {
    const { signOut: firebaseSignOut } = require('firebase/auth');
    await firebaseSignOut(auth);
  }
  currentUser = null;
  notifyListeners(null);
}

/**
 * Attempt silent sign-in using stored refresh token.
 * Returns the user if successful, null if no stored token or refresh fails.
 */
async function trySilentSignIn() {
  const refreshToken = loadRefreshToken();
  if (!refreshToken) return null;

  try {
    const tokens = await refreshAccessToken(refreshToken);
    const user = await signInToFirebase(tokens.id_token);
    // Update stored refresh token if a new one was issued
    if (tokens.refresh_token) {
      storeRefreshToken(tokens.refresh_token);
    }
    return serializeUser(user);
  } catch (err) {
    console.warn('Silent sign-in failed:', err.message);
    clearStoredTokens();
    return null;
  }
}

/**
 * Get the current auth state.
 */
function getAuthState() {
  return currentUser ? serializeUser(currentUser) : null;
}

/**
 * Register a listener for auth state changes.
 */
function onAuthStateChanged(callback) {
  authStateListeners.push(callback);
  return () => {
    authStateListeners = authStateListeners.filter(cb => cb !== callback);
  };
}

function notifyListeners(user) {
  const serialized = user ? serializeUser(user) : null;
  for (const cb of authStateListeners) {
    try { cb(serialized); } catch (e) { console.error('Auth listener error:', e); }
  }
}

function serializeUser(user) {
  if (!user) return null;
  return {
    uid:         user.uid,
    email:       user.email,
    displayName: user.displayName,
    photoURL:    user.photoURL,
  };
}

module.exports = {
  signIn,
  signOut,
  trySilentSignIn,
  getAuthState,
  onAuthStateChanged,
};
