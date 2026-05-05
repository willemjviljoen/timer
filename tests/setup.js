import Module from 'module';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

// Use OS temp dir so path.join() produces a valid absolute path on all OSes.
export const TEST_USERDATA = path.join(os.tmpdir(), 'vitest-electron-userdata');

const electronMock = {
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (s) => Buffer.from(s, 'utf-8'),
    decryptString: (b) => (Buffer.isBuffer(b) ? b.toString('utf-8') : String(b)),
  },
  app: {
    getPath: (name) => (name === 'userData' ? TEST_USERDATA : path.join(os.tmpdir(), name)),
  },
  shell: { openExternal: () => {} },
};

// Patch the resolved path in Node's require cache.
const electronPath = require.resolve('electron');
Module._cache[electronPath] = {
  id: electronPath,
  filename: electronPath,
  loaded: true,
  exports: electronMock,
};
