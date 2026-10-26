/**
 * Field names a dynamic form may not use.
 *
 * The SPA draws dynamic forms through DOMPurify, which strips a control's
 * `name` and `id` when they name a property of `document` or of a form. A
 * field so named is drawn without a name and its answer is never sent.
 *
 * @module utils/formFieldNames
 */

const { names } = require('../config/reserved_form_field_names.json');

const RESERVED_FIELD_NAMES = new Set(names);

/**
 * The reserved names a form structure introduces.
 *
 * A name the stored format already uses is kept: a unit can still edit an
 * older form, whose screen may draw that field under another name.
 *
 * @param {Object} formStructure - Submitted structure, with a `fields` array
 * @param {Object|null} [storedStructure] - The format as it is stored now
 * @returns {string[]} Reserved names, each once
 */
function findReservedFieldNames(formStructure, storedStructure = null) {
  const kept = new Set((Array.isArray(storedStructure?.fields) ? storedStructure.fields : [])
    .map((field) => field?.name));
  const found = (formStructure.fields || [])
    .map((field) => field?.name)
    .filter((name) => typeof name === 'string' && RESERVED_FIELD_NAMES.has(name) && !kept.has(name));
  return [...new Set(found)];
}

module.exports = { RESERVED_FIELD_NAMES, findReservedFieldNames };
