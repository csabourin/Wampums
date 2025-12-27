#!/usr/bin/env node
/**
 * Migrate Console Logs to DebugUtils
 *
 * Automatically replaces console.log/error/warn with debugLog/debugError/debugWarn
 * and adds the necessary imports from DebugUtils.js
 *
 * Usage:
 *   node scripts/migrate-console-logs.js spa/**\/*.js
 *   node scripts/migrate-console-logs.js mobile/src/**\/*.js
 */

const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

// Statistics
let stats = {
  filesProcessed: 0,
  filesUpdated: 0,
  logsReplaced: 0,
  errorsReplaced: 0,
  warnsReplaced: 0,
  filesSkipped: 0
};

/**
 * Check if file already uses DebugUtils
 */
function alreadyUsesDebugUtils(content) {
  return content.includes('DebugUtils.js') &&
         (content.includes('import') || content.includes('require'));
}

/**
 * Determine relative path to DebugUtils based on file location
 */
function getDebugUtilsPath(filePath) {
  const parts = filePath.split(path.sep);

  // Handle SPA files
  if (filePath.includes('spa/utils')) {
    return './DebugUtils.js';
  } else if (filePath.includes('spa/')) {
    const spaIndex = parts.indexOf('spa');
    const depth = parts.length - spaIndex - 2;
    if (depth === 0) {
      return './utils/DebugUtils.js';
    } else {
      return '../'.repeat(depth) + 'utils/DebugUtils.js';
    }
  }

  // Handle mobile files
  if (filePath.includes('mobile/src/utils')) {
    return './DebugUtils.js';
  } else if (filePath.includes('mobile/src/')) {
    const srcIndex = parts.indexOf('src');
    const depth = parts.length - srcIndex - 2;
    if (depth === 0) {
      return './utils/DebugUtils.js';
    } else {
      return '../'.repeat(depth) + 'utils/DebugUtils.js';
    }
  }

  // Default fallback
  return './utils/DebugUtils.js';
}

/**
 * Migrate console statements in a file
 */
function migrateFile(filePath) {
  stats.filesProcessed++;

  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;

    // Skip if already using DebugUtils
    if (alreadyUsesDebugUtils(content)) {
      console.log(`⏭️  Skipped (already using DebugUtils): ${filePath}`);
      stats.filesSkipped++;
      return;
    }

    // Check which console methods are used
    const usesLog = content.includes('console.log');
    const usesError = content.includes('console.error');
    const usesWarn = content.includes('console.warn');

    // Skip if no console statements
    if (!usesLog && !usesError && !usesWarn) {
      stats.filesSkipped++;
      return;
    }

    // Count replacements
    const logMatches = content.match(/console\.log\(/g);
    const errorMatches = content.match(/console\.error\(/g);
    const warnMatches = content.match(/console\.warn\(/g);

    if (logMatches) stats.logsReplaced += logMatches.length;
    if (errorMatches) stats.errorsReplaced += errorMatches.length;
    if (warnMatches) stats.warnsReplaced += warnMatches.length;

    // Build import statement
    const imports = [];
    if (usesLog) imports.push('debugLog');
    if (usesError) imports.push('debugError');
    if (usesWarn) imports.push('debugWarn');

    const debugUtilsPath = getDebugUtilsPath(filePath);
    const importStatement = `import { ${imports.join(', ')} } from '${debugUtilsPath}';\n`;

    // Find where to insert import (after last import or at beginning)
    const lastImportMatch = content.match(/^import .* from .*;?\s*$/gm);
    const lastImportIndex = lastImportMatch ?
      content.lastIndexOf(lastImportMatch[lastImportMatch.length - 1]) : -1;

    if (lastImportIndex !== -1) {
      // Insert after last import
      const insertPosition = content.indexOf('\n', lastImportIndex) + 1;
      content = content.slice(0, insertPosition) + importStatement + content.slice(insertPosition);
    } else {
      // Insert at beginning (after JSDoc comment block if present)
      let insertPosition = 0;

      // Look for end of JSDoc comment block
      const jsdocEndMatch = content.match(/\*\/\n/);
      if (jsdocEndMatch) {
        insertPosition = content.indexOf(jsdocEndMatch[0]) + jsdocEndMatch[0].length;
      }

      content = content.slice(0, insertPosition) + importStatement + '\n' + content.slice(insertPosition);
    }

    // Replace console calls
    content = content.replace(/console\.log\(/g, 'debugLog(');
    content = content.replace(/console\.error\(/g, 'debugError(');
    content = content.replace(/console\.warn\(/g, 'debugWarn(');

    // Only write if content changed
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Updated: ${filePath}`);
      console.log(`   - ${logMatches ? logMatches.length : 0} console.log → debugLog`);
      console.log(`   - ${errorMatches ? errorMatches.length : 0} console.error → debugError`);
      console.log(`   - ${warnMatches ? warnMatches.length : 0} console.warn → debugWarn`);
      stats.filesUpdated++;
    }
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node migrate-console-logs.js <glob-pattern>');
    console.error('Example: node migrate-console-logs.js "spa/**/*.js"');
    process.exit(1);
  }

  console.log('🔍 Finding files to migrate...\n');

  const pattern = args[0];
  const files = await glob(pattern, {
    ignore: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.min.js']
  });

  console.log(`📁 Found ${files.length} files\n`);

  files.forEach(migrateFile);

  // Print statistics
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Statistics');
  console.log('='.repeat(60));
  console.log(`Files processed: ${stats.filesProcessed}`);
  console.log(`Files updated: ${stats.filesUpdated}`);
  console.log(`Files skipped: ${stats.filesSkipped}`);
  console.log(`Total console.log replaced: ${stats.logsReplaced}`);
  console.log(`Total console.error replaced: ${stats.errorsReplaced}`);
  console.log(`Total console.warn replaced: ${stats.warnsReplaced}`);
  console.log(`Total replacements: ${stats.logsReplaced + stats.errorsReplaced + stats.warnsReplaced}`);
  console.log('='.repeat(60));

  if (stats.filesUpdated > 0) {
    console.log('\n✅ Migration complete!');
    console.log('⚠️  Please review the changes and test thoroughly before committing.');
  } else {
    console.log('\n✨ No files needed updating.');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
