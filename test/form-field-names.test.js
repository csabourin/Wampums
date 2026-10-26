/**
 * @jest-environment jsdom
 */

/**
 * config/reserved_form_field_names.json names every field name DOMPurify
 * would strip, so the form builder can refuse them (utils/formFieldNames.js,
 * spa/utils/FormFieldNameUtils.js). The list was taken from Chromium and
 * jsdom; this keeps it complete for jsdom, and checks it is really stripped.
 *
 * @module test/form-field-names
 */

const createDOMPurify = require('dompurify');
const { names } = require('../config/reserved_form_field_names.json');

/** Field names the form builder accepts (`pattern="[a-z_]+"`). */
const FIELD_NAME_PATTERN = /^[a-z_]+$/;

/**
 * @param {Object} target - document or a form
 * @returns {string[]} Every property name reachable on it
 */
function propertyNames(target) {
  const found = new Set();
  for (let level = target; level; level = Object.getPrototypeOf(level)) {
    Object.getOwnPropertyNames(level).forEach((name) => found.add(name));
  }
  return [...found];
}

describe('reserved form field names', () => {
  test('every name a form or the document holds is in the list', () => {
    const form = document.createElement('form');
    const missing = [...propertyNames(document), ...propertyNames(form)]
      .filter((name) => FIELD_NAME_PATTERN.test(name) && (name in document || name in form))
      .filter((name) => !names.includes(name));

    expect([...new Set(missing)]).toEqual([]);
  });

  test('a field named after one of them loses its name when drawn', () => {
    const purify = createDOMPurify(window);
    ['name', 'title', 'action', 'submit'].forEach((name) => {
      expect(names).toContain(name);
      expect(purify.sanitize(`<form><input name="${name}"></form>`)).not.toContain(`name="${name}"`);
    });
  });
});
