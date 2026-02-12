/**
 * check-duplicate-mounts.js
 * 
 * Detects duplicate app.use(path, router) mounts in api.js.
 */

const fs = require('fs');
const path = require('path');

const API_JS_PATH = path.join(__dirname, '../../api.js');

function checkDuplicateMounts() {
    const content = fs.readFileSync(API_JS_PATH, 'utf8');

    // Regex to find app.use(path, router)
    const mountRegex = /app\.use\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    let match;
    const mounts = new Map();
    let duplicates = [];

    while ((match = mountRegex.exec(content)) !== null) {
        const path = match[1];
        const router = match[2].trim();

        const key = `${path}:${router}`;
        if (mounts.has(key)) {
            duplicates.push(`Duplicate mount found: app.use("${path}", ${router})`);
        } else {
            mounts.set(key, true);
        }
    }

    if (duplicates.length > 0) {
        console.error('❌ Duplicate Route Mounts Detected:');
        duplicates.forEach(dup => console.error(`  - ${dup}`));
        process.exit(1);
    } else {
        console.log('✅ No duplicate route mounts detected.');
    }
}

checkDuplicateMounts();
