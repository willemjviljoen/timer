const { initializeApp } = require('firebase/app');
const { getAuth } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');
const { getDatabase } = require('firebase/database');

// Firebase client config — this is public by design.
// Security is enforced by Firestore/RTDB rules, not by hiding this config.
const FIREBASE_CONFIG = {
  // TODO: Replace with your Firebase project config from the Firebase Console
  // Go to: Firebase Console → Project Settings → General → Your apps → Web app
  apiKey:            'YOUR_API_KEY',
  authDomain:        'YOUR_PROJECT.firebaseapp.com',
  projectId:         'YOUR_PROJECT',
  storageBucket:     'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId:             'YOUR_APP_ID',
  databaseURL:       'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
};

let firebaseApp = null;
let auth = null;
let firestore = null;
let rtdb = null;

/**
 * Lazily initialize Firebase services.
 * Called only when the user signs in for the first time.
 */
function initFirebase() {
  if (firebaseApp) return { auth, firestore, rtdb };

  firebaseApp = initializeApp(FIREBASE_CONFIG);
  auth        = getAuth(firebaseApp);
  firestore   = getFirestore(firebaseApp);
  rtdb        = getDatabase(firebaseApp);

  return { auth, firestore, rtdb };
}

function getFirebaseAuth()      { return auth; }
function getFirebaseFirestore() { return firestore; }
function getFirebaseRtdb()      { return rtdb; }
function isFirebaseInitialized() { return firebaseApp !== null; }

module.exports = {
  initFirebase,
  getFirebaseAuth,
  getFirebaseFirestore,
  getFirebaseRtdb,
  isFirebaseInitialized,
};
