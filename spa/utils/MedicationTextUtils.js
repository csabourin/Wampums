/**
 * Reading the medication a parent wrote on the health form.
 *
 * The fiche santé asks for medications in one free-text box, so a parent lists
 * several on separate lines, or separated by commas or semicolons. A comma
 * followed by a digit is a French decimal ("10,5 mg") and does not separate.
 *
 * @module utils/MedicationTextUtils
 */

/** Separators between two medications in the free-text answer. */
const MEDICATION_SEPARATOR = /\r?\n|;|,(?!\d)/;

/** Bullet characters a list item may start with. */
const LEADING_BULLET = /^[-•*·]+\s*/;

/** Pieces that say "none" rather than naming a medication. */
const NONE_ANSWERS = new Set(['aucun', 'aucune', 'none', 'non', 'no', 'na', 'n a', 'rien', 'nil']);

/**
 * Reduce a piece to letters and digits for comparison.
 * @param {string} value - Text
 * @returns {string} Normalised text
 */
function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Split a declared medication answer into one entry per medication.
 * @param {string|null} text - The health form answer
 * @returns {Array<string>} Medication names, in order, without duplicates
 */
export function splitDeclaredMedications(text) {
  if (typeof text !== 'string') {
    return [];
  }
  const seen = new Set();
  return text.split(MEDICATION_SEPARATOR)
    .map((piece) => piece.replace(LEADING_BULLET, '').trim())
    .filter((piece) => {
      const key = normalize(piece);
      if (!key || NONE_ANSWERS.has(key) || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * Whether two medication names designate the same medication.
 * @param {string} a - Name
 * @param {string} b - Name
 * @returns {boolean} True when they match ignoring case, accents and punctuation
 */
export function isSameMedication(a, b) {
  return normalize(a || '') === normalize(b || '');
}
