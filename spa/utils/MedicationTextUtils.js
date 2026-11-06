/**
 * Reading the medication a parent wrote on the health form.
 *
 * The fiche santé asks for medications in one free-text box, so a parent lists
 * several on separate lines, or separated by commas or semicolons. A comma
 * followed by a digit is a French decimal ("10,5 mg") and does not separate.
 *
 * @module utils/MedicationTextUtils
 */

import { formatClockTime } from './DateUtils.js';
import { localeForLanguage } from './InterfaceLanguageUtils.js';

/** Most decimals a dose quantity is shown with ("2,5 ml", "0,25 mg"). */
const DOSE_MAX_DECIMALS = 2;

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

/**
 * The times of day a requirement is given, as stored (array or JSON text).
 * @param {Object} requirement - Medication requirement
 * @returns {Array<string>} HH:MM times, in order
 */
function requirementTimes(requirement) {
  let times = requirement?.frequency_times;
  if (typeof times === 'string') {
    try {
      times = JSON.parse(times);
    } catch {
      return [];
    }
  }
  return Array.isArray(times) ? times.filter((time) => typeof time === 'string' && time) : [];
}

/**
 * A requirement's dose as the team reads it: quantity with its unit, then the
 * written instructions ("200 mg · avec le déjeuner"). A quantity is never shown
 * bare, and the instructions are never dropped because a quantity exists.
 * @param {Object} requirement - Medication requirement
 * @param {string} lang - Interface language
 * @returns {string} Dose text, or an empty string when none was given
 */
export function describeMedicationDose(requirement, lang) {
  const parts = [];
  const amount = Number(requirement?.default_dose_amount);
  if (requirement?.default_dose_amount !== null && requirement?.default_dose_amount !== undefined
      && requirement?.default_dose_amount !== '' && Number.isFinite(amount)) {
    const quantity = new Intl.NumberFormat(localeForLanguage(lang), { maximumFractionDigits: DOSE_MAX_DECIMALS })
      .format(amount);
    parts.push([quantity, requirement.default_dose_unit?.trim()].filter(Boolean).join(' '));
  }
  if (requirement?.dosage_instructions?.trim()) {
    parts.push(requirement.dosage_instructions.trim());
  }
  return parts.join(' · ');
}

/**
 * A requirement's frequency with the times it is given ("Moments de la journée : 08:00").
 * @param {Object} requirement - Medication requirement
 * @param {string} lang - Interface language
 * @param {string} fallback - Text when no frequency was recorded
 * @param {string} template - Translated "{frequency}: {times}" pattern
 * @returns {string} Frequency text
 */
export function describeMedicationFrequency(requirement, lang, fallback, template) {
  const text = requirement?.frequency_text || fallback;
  const times = requirementTimes(requirement).map((time) => formatClockTime(time, lang)).filter(Boolean);
  if (!times.length) {
    return text;
  }
  return template.replace('{frequency}', text).replace('{times}', times.join(', '));
}
