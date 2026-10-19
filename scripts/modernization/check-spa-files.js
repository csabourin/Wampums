/**
 * check-spa-files.js
 * 
 * Ensures no new files are added to the root of the spa/ directory.
 * All new features must be added as modules under spa/modules/.
 */

const fs = require('fs');
const path = require('path');

const SPA_ROOT = path.join(__dirname, '../../spa');

// Shared infrastructure that stays in the spa/ root (see CLAUDE.md §7). Every
// screen lives in spa/modules/<feature>/.
const SPA_ALLOW_LIST = [
  'JSONFormRenderer.js',
  'MANUEL_PARENTS.md',
  'ajax-functions.js',
  'app.js',
  'config.js',
  'dynamicFormHandler.js',
  'functions.js',
  'indexedDB.js',
  'jwt-helper.js',
  'offline-init.js',
  'pwa-update-manager.js',
  'router.js'
];

function checkSpaFiles() {
  const files = fs.readdirSync(SPA_ROOT);
  const errors = [];

  files.forEach(file => {
    const filePath = path.join(SPA_ROOT, file);
    const stats = fs.statSync(filePath);

    // Only check files in the root, ignore directories
    if (stats.isFile()) {
      if (!SPA_ALLOW_LIST.includes(file)) {
        errors.push(`New top-level SPA file detected: spa/${file}`);
      }
    }
  });

  if (errors.length > 0) {
    console.error('❌ SPA Architecture Violation:');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('\nNo new files may be added to the spa/ root. Please use spa/modules/<feature>/');
    process.exit(1);
  } else {
    console.log('✅ SPA structure check passed.');
  }
}

checkSpaFiles();
