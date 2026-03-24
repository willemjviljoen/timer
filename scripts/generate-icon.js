/**
 * generate-icon.js
 * Converts assets/icon.svg → assets/icon.png (256×256)
 *                          → assets/tray.png  (32×32)
 */
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const root  = path.join(__dirname, '..');
const src   = path.join(root, 'assets', 'icon.svg');

async function main() {
  if (!fs.existsSync(src)) {
    console.error('Source SVG not found:', src);
    process.exit(1);
  }

  await sharp(src)
    .resize(256, 256)
    .png()
    .toFile(path.join(root, 'assets', 'icon.png'));
  console.log('✓ assets/icon.png (256×256)');

  await sharp(src)
    .resize(32, 32)
    .png()
    .toFile(path.join(root, 'assets', 'tray.png'));
  console.log('✓ assets/tray.png (32×32)');
}

main().catch(err => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});
