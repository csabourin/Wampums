/**
 * Field names a dynamic form may not use: DOMPurify strips a control's name
 * when it names a property of `document` or of a form, and the answer is lost.
 * The server refuses the same list (utils/formFieldNames.js).
 *
 * @module spa/utils/FormFieldNameUtils
 */
import reservedConfig from '../../config/reserved_form_field_names.json';

const RESERVED_FIELD_NAMES = new Set(reservedConfig.names);

/**
 * @param {string} name - A field name
 * @returns {boolean} True when no dynamic form could send that field
 */
export function isReservedFieldName(name) {
  return RESERVED_FIELD_NAMES.has(name);
}
