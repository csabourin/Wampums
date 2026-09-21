/**
 * Shared handling for a dynamic form field's `dependsOn` condition.
 *
 * A field such as the fiche santé's "précisez" box declares
 * `dependsOn: { field: "has_allergies", value: "yes" }`: it only applies once
 * its controlling question is answered yes.
 *
 * The comparison has to be tolerant, because the controlling answer is not
 * always stored the way the form format spells it. A radio saved as `"yes"`, a
 * checkbox saved as `true`, `"on"` or `"1"`, and a French `"oui"` all mean the
 * same thing, and the fiche santé has been filled with every one of them over
 * the years. The renderer already compared this way; the live toggle did not,
 * and used a strict `===` against values it had itself normalised to
 * `"yes"`/`"no"` — so answering the question never enabled the field it
 * controlled.
 *
 * @module utils/FormDependencyUtils
 */

/** Values that all count as "yes". */
const AFFIRMATIVE = new Set(["yes", "oui", "true", "on", "1", "y"]);

/**
 * Normalize a stored or live answer for comparison.
 *
 * @param {*} input - The raw answer
 * @returns {string} A lowercased, trimmed string form
 */
function normalize(input) {
  if (input === true) {
    return "true";
  }
  return String(input).trim().toLowerCase();
}

/**
 * Whether a `dependsOn` condition is satisfied by a given answer.
 *
 * @param {*} currentValue - The controlling field's current answer
 * @param {*} expectedValue - The value the dependent field waits for
 * @returns {boolean} True when the dependent field should apply
 */
export function isDependencySatisfied(currentValue, expectedValue) {
  if (currentValue === undefined || currentValue === null || currentValue === "") {
    return false;
  }

  const current = normalize(currentValue);
  const expected = normalize(expectedValue);

  if (current === expected) {
    return true;
  }
  return AFFIRMATIVE.has(current) && AFFIRMATIVE.has(expected);
}

/**
 * Whether a `dependsOn` condition is already met by a set of saved answers.
 *
 * @param {Object} dependsOn - `{ field, value }` from the form format
 * @param {Object} formData - The saved answers, keyed by field name
 * @returns {boolean} True when the dependent field should be editable
 */
export function isDependencyMet(dependsOn, formData) {
  if (!dependsOn || !dependsOn.field) {
    return true;
  }
  return isDependencySatisfied(formData ? formData[dependsOn.field] : undefined, dependsOn.value);
}
