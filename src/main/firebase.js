const { initializeApp } = require('firebase/app');
const { getAuth } = require('firebase/auth');
const { getFirestore } = require('firebase/firestore');
const { getDatabase } = require('firebase/database');

// Firebase client config — loaded from .env (see .env.example).
// Security is enforced by Firestore/RTDB rules, not by hiding this config.
const FIREBASE_CONFIG = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.FIREBASE_PROJECT_ID,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
  databaseURL:       process.env.FIREBASE_DATABASE_URL,
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
