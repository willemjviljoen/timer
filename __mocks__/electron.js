// Electron API mock — used by Vitest (resolve.alias in vitest.config.js).
// Covers only the APIs used by src/main/pb-auth.js and any other main-process
// modules that are unit-tested.

const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s) => Buffer.from(s, 'utf-8'),
  decryptString: (b) => Buffer.isBuffer(b) ? b.toString('utf-8') : String(b),
};

const app = {
  getPath: (name) => {
    if (name === 'userData') return '/tmp/test-userdata';
    return '/tmp';
  },
};

const shell = { openExternal: () => {} };

module.exports = { safeStorage, app, shell };
