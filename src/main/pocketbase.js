// PocketBase client — lazily initialized when the user configures a URL.

let _pb = null;

/**
 * Initialize (or reinitialize) the PocketBase client with the given URL.
 * Safe to call multiple times; a new instance is created each time.
 */
function initPocketBase(url) {
  const PocketBaseModule = require('pocketbase');
  // Handle both default export patterns (CJS vs ESM interop)
  const PocketBase = PocketBaseModule.default || PocketBaseModule;
  _pb = new PocketBase(url);
  return _pb;
}

function getPocketBase() { return _pb; }
function isPocketBaseInitialized() { return _pb !== null; }

/** Drop the cached instance (call when URL changes). */
function resetPocketBase() { _pb = null; }

module.exports = { initPocketBase, getPocketBase, isPocketBaseInitialized, resetPocketBase };
