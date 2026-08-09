/**
 * Reading answers out of a `fiche_sante` submission.
 *
 * A health form submission is a free-shaped JSONB document, not a typed row, and
 * its shape has drifted: the same question has been a radio, a checkbox and a
 * plain text box across form versions, organisations customise their own form
 * format, and rows imported from other systems never went through the form at
 * all. So the same answer is stored as `"yes"`, `"oui"`, `"on"`, `"1"`, `true`
 * or `1` depending on when and how it was filled in, and a question that was
 * added to the form later is simply absent from every submission that predates
 * it.
 *
 * Reports must therefore never test a submission with `=== 'yes'`. Allergy and
 * medication reports are read on site to decide what to do with a child, so the
 * rule they follow is: a health form that says anything about an allergy puts
 * the child on the allergy report. Missing the child is a safety incident;
 * listing one child too many is a line a leader reads and moves past.
 *
 * @module utils/health-form
 */

/** Every spelling of "yes" a submission has ever carried. */
const AFFIRMATIVE_ANSWERS = new Set(['true', 'vrai', 'on', '1', 'yes', 'y', 'oui', 'o']);

/**
 * Every spelling of "no" a parent types into a free-text box. Matched against
 * the whole answer only: `aucune` is a "no", `aucune noix` is an allergy.
 */
const NEGATIVE_ANSWERS = new Set([
  'no', 'non', 'n', 'nope', 'false', 'faux', '0',
  'none', 'nil', 'na', 'n a', 'nc', 's o', 'so',
  'aucun', 'aucune', 'aucuns', 'aucunes',
  'aucune allergie', 'aucunes allergies', 'aucune allergies', 'aucun medicament',
  'aucune connue', 'aucune allergie connue', 'aucun probleme',
  'pas d allergie', 'pas d allergies', 'pas dallergie', 'pas dallergies',
  'pas de medicament', 'pas de medicaments', 'pas de',
  'no allergies', 'no allergy', 'no known allergies', 'no medication',
  'rien', 'nothing', 'sans', 'sans objet', 'x'
]);

/**
 * Fields carrying the allergy itself, across form versions and languages.
 * `allergie` is the field name the standard fiche_sante uses today.
 */
const ALLERGY_TEXT_FIELDS = [
  'allergie', 'allergies', 'allergie_details', 'allergies_details',
  'details_allergies', 'allergie_precisions', 'allergy', 'allergy_details'
];

/**
 * Fields carrying the response plan around an allergy. Text in any of them is
 * itself a declaration: nobody writes down a reaction for a child who has none.
 */
const ALLERGY_DETAIL_FIELDS = [
  'allergie_gravite', 'severite_allergie', 'allergy_severity',
  'allergie_reaction', 'reaction_allergie', 'allergy_reaction',
  'allergie_action', 'mesures_allergie', 'allergy_action',
  'notes_allergies', 'allergie_notes'
];

/** Fields carrying the medication itself, across form versions and languages. */
const MEDICATION_TEXT_FIELDS = [
  'medicament', 'medicaments', 'medication', 'medications',
  'medicament_details', 'details_medicaments'
];

/**
 * Reduce an answer to letters and digits so spelling, accents, capitals and
 * punctuation stop mattering: `"N/A"`, `"n.a."` and `"NA"` all become `n a`,
 * `"Aucune."` becomes `aucune`.
 *
 * @param {*} value - Raw submission value
 * @returns {string} Normalised answer, empty when there is nothing to read
 */
function normalizeAnswer(value) {
  if (value === null || value === undefined || typeof value === 'object') {
    return '';
  }
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Interpret the many shapes a checkbox/radio answer takes across form versions.
 *
 * @param {*} value - Raw submission value
 * @returns {boolean} True when the answer is affirmative
 */
function isAffirmative(value) {
  if (value === true) {
    return true;
  }
  if (typeof value === 'number') {
    return value === 1;
  }
  if (typeof value !== 'string') {
    return false;
  }
  return AFFIRMATIVE_ANSWERS.has(normalizeAnswer(value));
}

/**
 * True when an answer is a "no" rather than content — including a "no" typed
 * into a free-text box, which is how parents answer a question whose radio was
 * added to the form later.
 *
 * @param {*} value - Raw submission value
 * @returns {boolean} True when the answer denies or says nothing
 */
function isNegative(value) {
  if (value === false) {
    return true;
  }
  const normalized = normalizeAnswer(value);
  return normalized === '' || NEGATIVE_ANSWERS.has(normalized);
}

/**
 * Collect the answers of `fields` that actually say something.
 *
 * @param {Object} healthData - `fiche_sante` submission_data
 * @param {Array<string>} fields - Field names to read, in order of preference
 * @returns {Array<string>} Trimmed answers, empty when none says anything
 */
function meaningfulAnswers(healthData, fields) {
  if (!healthData || typeof healthData !== 'object') {
    return [];
  }
  return fields
    .map((field) => healthData[field])
    .filter((value) => typeof value === 'string' && !isNegative(value))
    .map((value) => value.trim());
}

/**
 * The allergy as written on the health form, whichever field version holds it.
 *
 * @param {Object} healthData - `fiche_sante` submission_data
 * @returns {string|null} The allergy text, or null when the form carries none
 */
function allergyText(healthData) {
  return meaningfulAnswers(healthData, ALLERGY_TEXT_FIELDS)[0] || null;
}

/**
 * The medication as written on the health form, whichever field version holds it.
 *
 * @param {Object} healthData - `fiche_sante` submission_data
 * @returns {string|null} The medication text, or null when the form carries none
 */
function medicationText(healthData) {
  return meaningfulAnswers(healthData, MEDICATION_TEXT_FIELDS)[0] || null;
}

/**
 * Whether a health form declares an allergy.
 *
 * Deliberately wider than the `has_allergies` radio, because that radio is not
 * where the information reliably lives:
 *   * an affirmative answer in any of its stored shapes counts;
 *   * an EpiPen counts — it is prescribed for anaphylaxis, so a child carrying
 *     one is allergic whatever the radio says;
 *   * allergy text counts even when the radio is missing or negative, which is
 *     the case for every submission filled in before the radio was added to the
 *     form and for every submission imported from another system.
 *
 * @param {Object} healthData - `fiche_sante` submission_data
 * @returns {boolean} True when the form declares an allergy
 */
function declaresAllergy(healthData) {
  if (!healthData || typeof healthData !== 'object') {
    return false;
  }
  if (isAffirmative(healthData.has_allergies) || isAffirmative(healthData.epipen)) {
    return true;
  }
  return meaningfulAnswers(healthData, [...ALLERGY_TEXT_FIELDS, ...ALLERGY_DETAIL_FIELDS]).length > 0;
}

/**
 * Whether a health form declares a medication, read the same way as an allergy.
 *
 * @param {Object} healthData - `fiche_sante` submission_data
 * @returns {boolean} True when the form declares a medication
 */
function declaresMedication(healthData) {
  if (!healthData || typeof healthData !== 'object') {
    return false;
  }
  if (isAffirmative(healthData.has_medication)) {
    return true;
  }
  return meaningfulAnswers(healthData, MEDICATION_TEXT_FIELDS).length > 0;
}

module.exports = {
  ALLERGY_TEXT_FIELDS,
  ALLERGY_DETAIL_FIELDS,
  MEDICATION_TEXT_FIELDS,
  normalizeAnswer,
  isAffirmative,
  isNegative,
  allergyText,
  medicationText,
  declaresAllergy,
  declaresMedication
};
