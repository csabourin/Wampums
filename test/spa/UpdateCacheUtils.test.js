const fs = require('fs');
const path = require('path');
const { cachesToClearOnUpdate } = require('../../spa/utils/UpdateCacheUtils.js');

describe('accepting an app update', () => {
  test('keeps the installed shell, translations, images and the precache, and clears only the replaced build\'s HTML', () => {
    const names = [
      'workbox-precache-v2-https://unit.test/',
      'offline-shell',
      'html-cache',
      'translations-cache',
      'translations-versioned-cache',
      'image-cache',
      'font-awesome-cache',
    ];
    expect(cachesToClearOnUpdate(names)).toEqual(['html-cache', 'translations-cache']);
  });

  test('never deletes the offline data or the queued changes kept in IndexedDB', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../spa/pwa-update-manager.js'), 'utf8');
    expect(source).not.toMatch(/deleteIndexedDB|indexedDB\.deleteDatabase/);
  });
});
