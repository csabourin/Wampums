/**
 * @jest-environment jsdom
 *
 * Guard against DOMPurify's DOM-clobbering protection silently removing form
 * control names and ids.
 *
 * DOMPurify runs with SANITIZE_DOM enabled (its default) and drops any
 * `name`/`id` attribute whose value collides with a property of `document` or
 * of an HTMLFormElement. The attribute simply vanishes: the markup still looks
 * right in the source, but the control cannot be found by name, is missing from
 * FormData, and any `<label for=...>` pointing at a stripped id is orphaned.
 *
 * This cost real bugs — the campaign name field always read as empty, equipment
 * creation posted no name, organisation registration posted a null role — so
 * the whole SPA is swept here rather than relying on anyone remembering.
 */

const fs = require('fs');
const path = require('path');
const createDOMPurify = require('dompurify');

const SPA_DIRECTORY = path.resolve(__dirname, '../../spa');

/** Sanitiser configuration mirroring spa/utils/SecurityUtils.js. */
const SANITIZE_CONFIG = {
  ALLOW_DATA_ATTR: true,
  USE_PROFILES: { html: true, svg: true, svgFilters: false },
  SAFE_FOR_TEMPLATES: false,
};

/**
 * Recursively collect every JavaScript source file under the SPA.
 *
 * @param {string} directory - Directory to walk
 * @returns {string[]} Absolute file paths
 */
function collectSpaSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSpaSources(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

/**
 * Extract literal attribute values used in the SPA markup templates.
 *
 * Only static literals are checked; values built from template expressions
 * cannot be resolved here.
 *
 * @param {RegExp} pattern - Pattern whose first group is the attribute value
 * @returns {Map<string, string[]>} Attribute value to the files using it
 */
function collectAttributeValues(pattern) {
  const found = new Map();

  collectSpaSources(SPA_DIRECTORY).forEach((file) => {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const value = match[1];
      const relative = path.relative(SPA_DIRECTORY, file);
      const files = found.get(value) || [];
      if (!files.includes(relative)) {
        files.push(relative);
      }
      found.set(value, files);
    }
  });

  return found;
}

/**
 * @param {'name'|'id'} attribute - Attribute to probe
 * @param {string} value - Attribute value
 * @returns {boolean} True when DOMPurify keeps the attribute
 */
function survivesSanitisation(attribute, value) {
  const purify = createDOMPurify(globalThis);
  const markup = attribute === 'name'
    ? `<form id="probe-form"><input type="text" name="${value}"></form>`
    : `<div id="${value}"></div>`;
  return purify.sanitize(markup, SANITIZE_CONFIG).includes(`${attribute}="${value}"`);
}

/**
 * Format offenders for a readable failure message.
 *
 * @param {Array<[string, string[]]>} offenders - Value/files pairs
 * @returns {string} Multi-line description
 */
function describe_(offenders) {
  return offenders
    .map(([value, files]) => `  "${value}" used in: ${files.join(', ')}`)
    .join('\n');
}

test('no form control name in the SPA is stripped by the sanitiser', () => {
  const names = collectAttributeValues(
    /<(?:input|select|textarea)[^>]*\sname="([a-zA-Z_][a-zA-Z0-9_-]*)"/g,
  );
  expect(names.size).toBeGreaterThan(50);

  const offenders = [...names.entries()]
    .filter(([value]) => !survivesSanitisation('name', value))
    .sort();

  expect(
    offenders.length === 0
      ? ''
      : 'DOMPurify strips these control names, so the fields cannot be read back '
        + '(missing from FormData and from form.elements). Rename them, as\n'
        + 'inventory.js does with equipment_name:\n' + describe_(offenders),
  ).toBe('');
});

test('no element id in the SPA is stripped by the sanitiser', () => {
  const ids = collectAttributeValues(/\sid="([a-zA-Z_][a-zA-Z0-9_-]*)"/g);
  expect(ids.size).toBeGreaterThan(200);

  const offenders = [...ids.entries()]
    .filter(([value]) => !survivesSanitisation('id', value))
    .sort();

  expect(
    offenders.length === 0
      ? ''
      : 'DOMPurify strips these ids, so getElementById fails and any matching\n'
        + '<label for="..."> is orphaned. Rename them:\n' + describe_(offenders),
  ).toBe('');
});

test('the sweep actually detects a colliding value', () => {
  // Proves the probe works rather than silently passing everything.
  expect(survivesSanitisation('name', 'name')).toBe(false);
  expect(survivesSanitisation('id', 'role')).toBe(false);
  expect(survivesSanitisation('name', 'campaign_name')).toBe(true);
  expect(survivesSanitisation('id', 'registration-role')).toBe(true);
});
