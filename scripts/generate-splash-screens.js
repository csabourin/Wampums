#!/usr/bin/env node

/**
 * Generate iOS Splash Screens for PWA
 *
 * This script generates splash screen images for various iOS device sizes
 * from the existing icon file.
 *
 * Usage: node scripts/generate-splash-screens.js
 *
 * Requirements: This script requires canvas or sharp library to be installed
 * Install with: npm install canvas
 */

const fs = require('fs');
const path = require('path');

// Splash screen sizes for different iOS devices
const SPLASH_SIZES = [
    // iPhone X, XS, 11 Pro, 12 mini, 13 mini
    { width: 1125, height: 2436, name: 'apple-splash-1125-2436.png' },
    // iPhone XS Max, XR, 11, 11 Pro Max, 12, 12 Pro, 13, 13 Pro, 14
    { width: 1170, height: 2532, name: 'apple-splash-1170-2532.png' },
    // iPhone 14 Plus, 15 Plus
    { width: 1242, height: 2688, name: 'apple-splash-1242-2688.png' },
    // iPhone 14 Pro
    { width: 1179, height: 2556, name: 'apple-splash-1179-2556.png' },
    // iPhone 14 Pro Max, 15 Pro Max
    { width: 1290, height: 2796, name: 'apple-splash-1290-2796.png' },
    // iPad Mini, Air
    { width: 1536, height: 2048, name: 'apple-splash-1536-2048.png' },
    // iPad Pro 10.5"
    { width: 1668, height: 2224, name: 'apple-splash-1668-2224.png' },
    // iPad Pro 11"
    { width: 1668, height: 2388, name: 'apple-splash-1668-2388.png' },
    // iPad Pro 12.9"
    { width: 2048, height: 2732, name: 'apple-splash-2048-2732.png' }
];

const THEME_COLOR = '#4c65ae';
const SOURCE_ICON = path.join(__dirname, '..', 'images', 'icon-512x512.png');
const OUTPUT_DIR = path.join(__dirname, '..', 'images', 'splash');

/**
 * Generate splash screen using canvas
 */
async function generateSplashWithCanvas(size) {
    try {
        const { createCanvas, loadImage } = require('canvas');

        const canvas = createCanvas(size.width, size.height);
        const ctx = canvas.getContext('2d');

        // Fill background with theme color
        ctx.fillStyle = THEME_COLOR;
        ctx.fillRect(0, 0, size.width, size.height);

        // Load and draw centered icon
        const icon = await loadImage(SOURCE_ICON);
        const iconSize = Math.min(size.width, size.height) * 0.3; // Icon is 30% of smallest dimension
        const x = (size.width - iconSize) / 2;
        const y = (size.height - iconSize) / 2;

        ctx.drawImage(icon, x, y, iconSize, iconSize);

        // Save to file
        const outputPath = path.join(OUTPUT_DIR, size.name);
        const buffer = canvas.toBuffer('image/png');
        fs.writeFileSync(outputPath, buffer);

        console.log(`✓ Generated ${size.name} (${size.width}x${size.height})`);
        return true;
    } catch (error) {
        console.error(`✗ Failed to generate ${size.name}: ${error.message}`);
        return false;
    }
}

/**
 * Generate simple SVG splash screens as fallback
 */
function generateSvgSplash(size) {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${size.width}" height="${size.height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <rect width="${size.width}" height="${size.height}" fill="${THEME_COLOR}"/>
  <g transform="translate(${size.width / 2}, ${size.height / 2})">
    <circle r="${Math.min(size.width, size.height) * 0.15}" fill="white" opacity="0.9"/>
    <text x="0" y="${Math.min(size.width, size.height) * 0.06}"
          text-anchor="middle"
          font-family="system-ui, -apple-system, sans-serif"
          font-size="${Math.min(size.width, size.height) * 0.08}"
          font-weight="bold"
          fill="${THEME_COLOR}">W</text>
  </g>
</svg>`;

    const outputPath = path.join(OUTPUT_DIR, size.name.replace('.png', '.svg'));
    fs.writeFileSync(outputPath, svg);
    console.log(`✓ Generated SVG fallback ${size.name} (${size.width}x${size.height})`);
}

/**
 * Main function
 */
async function main() {
    console.log('🎨 Generating iOS Splash Screens for PWA\n');

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`✓ Created directory: ${OUTPUT_DIR}\n`);
    }

    // Check if source icon exists
    if (!fs.existsSync(SOURCE_ICON)) {
        console.error(`✗ Source icon not found: ${SOURCE_ICON}`);
        console.log('\nPlease ensure icon-512x512.png exists in the images directory.');
        process.exit(1);
    }

    // Try to load canvas library
    let canvasAvailable = false;
    try {
        require('canvas');
        canvasAvailable = true;
        console.log('✓ Canvas library detected\n');
    } catch (error) {
        console.log('⚠ Canvas library not found. Will generate SVG fallbacks instead.');
        console.log('  Install canvas for better results: npm install canvas\n');
    }

    // Generate all splash screens
    let successCount = 0;
    for (const size of SPLASH_SIZES) {
        if (canvasAvailable) {
            const success = await generateSplashWithCanvas(size);
            if (success) successCount++;
        } else {
            generateSvgSplash(size);
            successCount++;
        }
    }

    console.log(`\n✨ Complete! Generated ${successCount}/${SPLASH_SIZES.length} splash screens`);
    console.log(`📁 Output directory: ${OUTPUT_DIR}`);

    if (!canvasAvailable) {
        console.log('\n⚠ Note: SVG splash screens were generated as fallbacks.');
        console.log('  For better quality PNG splash screens:');
        console.log('  1. Run: npm install canvas');
        console.log('  2. Run this script again');
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

module.exports = { generateSplashWithCanvas, generateSvgSplash, SPLASH_SIZES };
