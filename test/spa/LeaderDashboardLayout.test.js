/**
 * The leaders' dashboard on a phone, held to what a leader saw in QA (#1398):
 * an ordinary tile painted in the error red read as a failure, the floating
 * "quick actions" button could sit over a focused tile, and an upcoming camp's
 * dates spilled out beside its button. jsdom does not lay out, so this reads
 * the palette and the style rules.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn() }));

import { PALETTES, DEFAULT_PALETTE_ID } from '../../spa/config/dashboard-customization.js';

const css = (file) => readFileSync(path.join(__dirname, '../../css', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const STYLES = css('styles.css');
const DASHBOARD = css('dashboard-v2.css');

/** @returns {string} Declarations of the rule for exactly this selector */
function rule(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match ? match[1] : '';
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('a task tile is not painted in the colour of an error, and stays readable', () => {
  const errorColour = /--color-error:\s*(#[0-9a-f]{6})/i.exec(STYLES)[1].toLowerCase();
  const { safety } = PALETTES[DEFAULT_PALETTE_ID].domains;

  expect(safety.bg.toLowerCase()).not.toBe(errorColour);
  expect(contrast(safety.bg, safety.fg)).toBeGreaterThanOrEqual(4.5);
});

test('a tile reached by keyboard scrolls clear of the floating button', () => {
  expect(rule(DASHBOARD, 'html:has(.dashboard-fab)')).toMatch(/scroll-padding-block-end:\s*var\(--dashboard-fab-space\)/);
  expect(rule(DASHBOARD, '.dashboard-v2')).toMatch(/padding-block-end:\s*var\(--dashboard-fab-space\)/);
});

test('an upcoming camp shows its dates on their own line under its button', () => {
  expect(rule(STYLES, '.dashboard-team-camps__list li')).toMatch(/flex-direction:\s*column/);
  expect(rule(STYLES, '.dashboard-team-camps__list')).toMatch(/list-style:\s*none/);
});
