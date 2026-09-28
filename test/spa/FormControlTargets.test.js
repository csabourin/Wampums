/**
 * @jest-environment jsdom
 */

/**
 * Form controls fit a phone and can be hit and seen.
 *
 * The health form, the registration form and every other dynamic form share
 * these rules. On a phone the health form was 922px wide, its fields cut off on
 * the right; its radio buttons and checkboxes were 12px; a checked option's
 * label turned almost white; and no checkbox or radio button showed focus.
 * jsdom does not lay out, so this reads the rules and the markup; the rendered
 * sizes were measured in a browser at 390px when the rules were written.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

import { JSONFormRenderer } from '../../spa/JSONFormRenderer.js';

// Comments stripped, so one sitting above a rule does not stick to its selector.
const STYLES = readFileSync(path.join(__dirname, '../../css/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every top-level rule, as selector list and declarations.
 *
 * @returns {Array<{selectors: string[], declarations: string}>} Rules
 */
function rules() {
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  const found = [];
  let match;
  while ((match = pattern.exec(STYLES)) !== null) {
    found.push({
      selectors: match[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
      declarations: match[2]
    });
  }
  return found;
}

/**
 * Declarations of every rule whose selector list contains the selector.
 *
 * @param {string} selector - Exact selector
 * @returns {string} The declarations, concatenated
 */
function declarationsFor(selector) {
  return rules()
    .filter((rule) => rule.selectors.includes(selector))
    .map((rule) => rule.declarations)
    .join('');
}

/**
 * Render one field into the document.
 *
 * @param {Object} field - Field definition
 * @param {Object} [data] - Saved answers
 * @returns {HTMLElement} The field's group
 */
function renderField(field, data = {}) {
  const renderer = new JSONFormRenderer({ fields: [field] }, data, 'test');
  document.body.innerHTML = renderer.render();
  return document.body.firstElementChild;
}

describe('layout on a phone', () => {
  test('a fieldset may shrink below its widest row', () => {
    expect(declarationsFor('fieldset')).toMatch(/min-inline-size:\s*0/);
  });

  test('checkbox options wrap instead of running off the screen', () => {
    expect(declarationsFor('.checkbox-group')).toMatch(/flex-wrap:\s*wrap/);
  });
});

describe('targets', () => {
  test.each([
    '.radio-option input[type="radio"]',
    '.checkbox-option input[type="checkbox"]',
    '.form-group--single-checkbox > input[type="checkbox"]',
    // Also nested in its label, as on the meeting reminder form.
    '.form-group--checkbox input[type="checkbox"]'
  ])('%s is at least 24px', (selector) => {
    const declarations = declarationsFor(selector);
    expect(declarations).toMatch(/inline-size:\s*var\(--control-size-min\)/);
    expect(declarations).toMatch(/block-size:\s*var\(--control-size-min\)/);
  });

  test('the control minimum is 24px', () => {
    expect(declarationsFor(':root')).toMatch(/--control-size-min:\s*24px/);
  });

  test.each([
    '.radio-option label',
    '.checkbox-option label',
    '.form-group--single-checkbox > label',
    '.form-group--checkbox > label'
  ])('%s fills a 44px row, and covers its whole option', (selector) => {
    const declarations = declarationsFor(selector);
    expect(declarations).toMatch(/min-block-size:\s*var\(--touch-target-min\)/);
    expect(declarations).toMatch(/min-inline-size:\s*var\(--touch-target-min\)/);
    expect(declarationsFor(`${selector}::after`)).toMatch(/inset:\s*0/);
  });

  test('a lone checkbox comes before its label, on one row', () => {
    const group = renderField({ type: 'checkbox', name: 'epipen', label: 'epipen' }, { epipen: '1' });

    expect(group.classList.contains('form-group--single-checkbox')).toBe(true);
    const [first, second] = group.children;
    expect(first.matches('input[type="checkbox"]#epipen')).toBe(true);
    expect(first.checked).toBe(true);
    expect(second.matches('label[for="epipen"]')).toBe(true);
    expect(group.querySelectorAll('label')).toHaveLength(1);
  });

  test('other fields keep their label above them', () => {
    const group = renderField({ type: 'text', name: 'nom_medecin', label: 'nom_medecin' });

    expect(group.classList.contains('form-group--single-checkbox')).toBe(false);
    expect(group.firstElementChild.matches('label[for="nom_medecin"]')).toBe(true);
  });
});

/**
 * WCAG contrast ratio between two #rrggbb colours.
 *
 * @param {string} first - Colour
 * @param {string} second - Colour
 * @returns {number} Ratio, from 1 to 21
 */
function contrast(first, second) {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('focus ring colour', () => {
  const PWA_SOURCE = readFileSync(path.join(__dirname, '../../spa/pwa-update-manager.js'), 'utf8');

  test('every focus outline takes the focus-ring token, which a dark surface can override', () => {
    expect(declarationsFor('*:focus-visible')).toMatch(/outline:\s*2px solid var\(--color-focus-ring\)/);
    expect(STYLES).not.toMatch(/outline(-color)?:[^;]*var\(--color-primary\)/);
  });

  test('the default ring is at least 3:1 on the light surfaces', () => {
    const primary = declarationsFor(':root').match(/--color-primary:\s*(#[0-9a-f]{6})/i)[1];
    expect(declarationsFor(':root')).toMatch(/--color-focus-ring:\s*var\(--color-primary\)/);
    expect(contrast(primary, '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrast(primary, '#f3f7f4')).toBeGreaterThanOrEqual(3);
  });

  test('the update prompt sets a light ring on its dark surface, at least 3:1', () => {
    const dark = PWA_SOURCE.match(/prefers-color-scheme: dark\)\s*\{\s*\.pwa-update-prompt\s*\{([^}]*)\}/)[1];
    const surface = dark.match(/background:\s*(#[0-9a-f]{6})/i)[1];
    const ring = dark.match(/--color-focus-ring:\s*(#[0-9a-f]{6})/i)[1];
    const primary = declarationsFor(':root').match(/--color-primary:\s*(#[0-9a-f]{6})/i)[1];

    expect(contrast(primary, surface)).toBeLessThan(3);
    expect(contrast(ring, surface)).toBeGreaterThanOrEqual(3);
  });

  test('the update prompt\'s secondary button text is at least 4.5:1, hovered or not', () => {
    const rule = (selector) => PWA_SOURCE.match(new RegExp(`${selector.replace(/[.:]/g, '\\$&')}\\s*\\{([^}]*)\\}`))[1];
    const text = rule('.pwa-update-btn-secondary').match(/color:\s*(#[0-9a-f]{3,6})/i)[1];
    const full = (hex) => (hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
    const background = rule('.pwa-update-btn-secondary').match(/background:\s*(#[0-9a-f]{6})/i)[1];
    const hovered = rule('.pwa-update-btn-secondary:hover').match(/background:\s*(#[0-9a-f]{6})/i)[1];

    expect(contrast(full(text), background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(full(text), hovered)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('visibility', () => {
  test('no rule takes the focus outline away from form inputs', () => {
    expect(declarationsFor('.form-group input:focus')).not.toMatch(/outline:\s*(none|0)/);
    expect(declarationsFor('.form-group input:focus')).toMatch(/outline:\s*2px solid var\(--color-focus-ring\)/);
  });

  test('a checked option keeps its label in the text colour', () => {
    const recolored = rules().filter((rule) => rule.selectors.some((s) => /:checked\s*~\s*label/.test(s)));
    expect(recolored).toEqual([]);
  });
});
