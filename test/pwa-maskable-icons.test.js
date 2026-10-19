/**
 * Installed on Android, the app's icon is cut to the launcher's shape (circle,
 * squircle…). A "maskable" icon fills its square edge to edge and keeps the
 * logo inside the safe zone, so nothing is clipped; the "any" icons, with
 * their transparent rounded corners, are kept for everything else. Declaring
 * one file as "any maskable" is what Lighthouse warns about.
 *
 * @module test/pwa-maskable-icons
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [192, 512];
const PNG_RGB = 2;

/**
 * Read a PNG's width, height and colour type from its IHDR chunk.
 *
 * @param {string} file - Path to the PNG
 * @returns {{width: number, height: number, colourType: number}} Header fields
 */
function pngHeader(file) {
  const bytes = fs.readFileSync(file);
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colourType: bytes[25],
  };
}

describe('maskable app icons', () => {
  test.each(SIZES)('the %ipx maskable icon is square and opaque, so a mask never shows a hole', (size) => {
    const header = pngHeader(path.join(ROOT, 'assets/images', `icon-maskable-${size}x${size}.png`));

    expect(header).toEqual({ width: size, height: size, colourType: PNG_RGB });
  });

  test('the manifest the app installs from declares them as maskable, apart from the "any" icons', () => {
    const config = fs.readFileSync(path.join(ROOT, 'vite.config.mjs'), 'utf8');

    SIZES.forEach((size) => {
      expect(config).toMatch(new RegExp(
        `src: '/images/icon-maskable-${size}x${size}\\.png',\\s*sizes: '${size}x${size}',\\s*type: 'image/png',\\s*purpose: 'maskable'`
      ));
      expect(config).toMatch(new RegExp(
        `src: '/images/icon-${size}x${size}\\.png',\\s*sizes: '${size}x${size}',\\s*type: 'image/png',\\s*purpose: 'any'`
      ));
    });
  });

  test.each(['manifest.json', 'landing/manifest.json'])('%s gives each purpose its own icons', (file) => {
    const { icons } = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));

    expect(icons.map((icon) => icon.purpose).sort()).toEqual(['any', 'any', 'maskable', 'maskable']);
    icons.filter((icon) => icon.purpose === 'maskable').forEach((icon) => {
      expect(icon.src).toMatch(/\/icon-maskable-(192x192|512x512)\.png$/);
    });
  });
});
