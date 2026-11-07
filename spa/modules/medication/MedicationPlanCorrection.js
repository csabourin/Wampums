/**
 * Correcting a medication plan (#1379): what the screen shows before, during and after a family
 * corrects its child's plan in place.
 *
 * - Before saving, a correction to what is given is shown as "before → after" to confirm.
 * - Each plan lists its corrections: when, by whom, and what changed.
 * - A dose still scheduled at a time the corrected plan no longer has is pointed out to the team.
 */
import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDate, formatTimestamp } from '../../utils/DateUtils.js';
import { ISO_DATE_LENGTH } from '../../utils/TimeUnits.js';
import { describeMedicationDose, describeMedicationFrequency } from '../../utils/MedicationTextUtils.js';

/** Length of a clock time written HH:MM. */
const CLOCK_TIME_LENGTH = 5;

/** The label of each field a correction can change, as the form names it. */
const FIELD_LABEL_KEYS = Object.freeze({
  medication_name: 'medication_name_label',
  default_dose_amount: 'dose',
  default_dose_unit: 'unit',
  dosage_instructions: 'medication_dosage_label',
  frequency_preset_type: 'medication_frequency_label',
  frequency_times: 'medication_administration_times',
  frequency_slots: 'medication_administration_times',
  frequency_interval_hours: 'medication_frequency_interval_hours',
  frequency_interval_start: 'medication_frequency_anchor_time',
  route: 'medication_route_label',
  start_date: 'medication_start_date_label',
  end_date: 'medication_end_date_label',
  general_notes: 'medication_general_notes_label',
});

/**
 * One value of a recorded change, as a person reads it.
 *
 * @param {string} field - Plan field
 * @param {*} value - Recorded value
 * @param {string} lang - Interface language
 * @returns {string} Plain text
 */
function readableValue(field, value, lang) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (field === 'frequency_preset_type') {
    return translate(`medication_frequency_${value}`);
  }
  if (field === 'start_date' || field === 'end_date') {
    return formatDate(value, lang) || String(value);
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  if (typeof value === 'object') {
    return Object.values(value).join(', ');
  }
  return String(value);
}

/**
 * "Dose : 5 ml → 7,5 ml", with the punctuation of the page's language.
 *
 * @param {string} label - Field label
 * @param {string} from - Value before
 * @param {string} to - Value after
 * @returns {string} Plain text
 */
function changeLine(label, from, to) {
  return translate('medication_plan_change_line')
    .replace('{field}', label).replace('{from}', from).replace('{to}', to);
}

/**
 * A plan's schedule as one comparable value: type, times, meal slots and interval.
 *
 * @param {Object} plan - Listed plan, or the plan the form will send
 * @returns {string} Comparable schedule
 */
function scheduleKey(plan) {
  const times = Array.isArray(plan.frequency_times) ? plan.frequency_times : [];
  const slots = plan.frequency_slots && typeof plan.frequency_slots === 'object' ? plan.frequency_slots : {};
  const hours = plan.frequency_interval_hours ? Number(plan.frequency_interval_hours) : null;
  const start = plan.frequency_interval_start ? String(plan.frequency_interval_start).slice(0, CLOCK_TIME_LENGTH) : null;
  return JSON.stringify([plan.frequency_preset_type || null, times, Object.entries(slots).sort(), hours, start]);
}

/**
 * The schedule's type in the page's language, so both sides of the check read alike.
 *
 * @param {Object} plan - Listed plan, or the plan the form will send
 * @returns {string} Schedule type, or the recorded wording when it has none
 */
function scheduleName(plan) {
  return plan.frequency_preset_type ? translate(`medication_frequency_${plan.frequency_preset_type}`) : (plan.frequency_text || '');
}

/**
 * What a correction changes in what is given, one line each, for the confirmation:
 * "Dose : 5 ml → 7,5 ml". Notes and dates are not listed: they do not change what is given.
 *
 * @param {Object} before - The plan as listed
 * @param {Object} after - The plan as the form will send it
 * @param {string} lang - Interface language
 * @returns {Array<string>} Lines, empty when what is given does not change
 */
export function describeGivenChanges(before, after, lang) {
  const lines = [];
  const line = (labelKey, from, to) => {
    if (from !== to) {
      lines.push(changeLine(translate(labelKey), from || '—', to || '—'));
    }
  };
  line('medication_name_label', before.medication_name || '', after.medication_name || '');
  line('dose', describeMedicationDose(before, lang), describeMedicationDose(after, lang));
  // The schedule is compared by what it is, not by its wording: a plan written in another
  // language reads differently without being given at other times.
  if (scheduleKey(before) !== scheduleKey(after)) {
    const frequency = (plan) => describeMedicationFrequency({ ...plan, frequency_text: scheduleName(plan) }, lang,
      translate('medication_frequency_prn_text'), translate('medication_frequency_with_times'));
    lines.push(changeLine(translate('medication_frequency_label'), frequency(before) || '—', frequency(after) || '—'));
  }
  line('medication_route_label', before.route || '', after.route || '');
  return lines;
}

/**
 * The corrections of a plan, newest first, in a disclosure under the plan. Names and values
 * come from people: every one is escaped.
 *
 * @param {Object} requirement - A listed plan, with its `revisions`
 * @param {string} lang - Interface language
 * @returns {string} HTML, empty when the plan was never corrected
 */
export function renderPlanHistory(requirement, lang) {
  const revisions = Array.isArray(requirement?.revisions) ? requirement.revisions : [];
  if (revisions.length === 0) {
    return '';
  }
  const latest = formatTimestamp(revisions[0].changed_at, lang);
  const entries = revisions.map((revision) => {
    const who = revision.changed_by_name || translate('unknown');
    const when = formatTimestamp(revision.changed_at, lang);
    const changes = Object.entries(revision.changes || {}).map(([field, change]) => `
      <li>${escapeHTML(changeLine(translate(FIELD_LABEL_KEYS[field] || 'medication'),
    readableValue(field, change?.from, lang), readableValue(field, change?.to, lang)))}</li>`).join('');
    const signature = revision.requires_new_signature
      ? `<p class="medication-plan-history__signature">${escapeHTML(translate('medication_plan_history_signature'))}</p>`
      : '';
    return `
      <li class="medication-plan-history__entry">
        <p><strong>${escapeHTML(when)}</strong> — ${escapeHTML(who)}</p>
        <ul>${changes}</ul>
        ${signature}
      </li>`;
  }).join('');

  return `
    <p class="medication-plan-modified">${escapeHTML(translate('medication_plan_modified_on').replace('{date}', latest))}</p>
    <details class="medication-plan-history">
      <summary>${escapeHTML(translate('medication_plan_history').replace('{count}', String(revisions.length)))}</summary>
      <ol>${entries}</ol>
    </details>`;
}

/**
 * Whether a dose still scheduled sits at a time its plan no longer has, read in this device's
 * time zone: a correction removed that time, and the team decides what to do with the dose.
 *
 * @param {Object} distribution - Scheduled dose
 * @param {Array<{iso: string}>} slots - The plan's times on that day
 * @param {Function} localTime - Instant → "HH:MM" on this device
 * @returns {boolean} True for a scheduled dose at a time the plan no longer has
 */
export function isOffPlanDose(distribution, slots, localTime) {
  if (distribution?.status !== 'scheduled' || !Array.isArray(slots) || slots.length === 0) {
    return false;
  }
  const time = localTime(distribution.scheduled_for);
  return !slots.some((slot) => localTime(slot.iso) === time);
}

/**
 * Put a listed plan into the requirement form, the schedule type first since it decides which
 * time fields exist.
 *
 * @param {HTMLFormElement} form - Requirement form
 * @param {Object} requirement - The plan as listed
 */
export function fillRequirementForm(form, requirement) {
  const preset = form.elements.frequency_preset_type;
  if (preset && requirement.frequency_preset_type && preset.value !== requirement.frequency_preset_type) {
    preset.value = requirement.frequency_preset_type;
    preset.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const set = (name, value) => {
    const field = form.elements[name];
    if (field && !(field instanceof RadioNodeList)) {
      field.value = value ?? '';
    }
  };
  set('medication_name', requirement.medication_name);
  set('dosage_instructions', requirement.dosage_instructions);
  set('route', requirement.route);
  set('default_dose_amount', requirement.default_dose_amount === null || requirement.default_dose_amount === undefined
    ? '' : String(Number(requirement.default_dose_amount)));
  set('default_dose_unit', requirement.default_dose_unit);
  set('general_notes', requirement.general_notes);
  set('start_date', requirement.start_date ? String(requirement.start_date).slice(0, ISO_DATE_LENGTH) : '');
  set('end_date', requirement.end_date ? String(requirement.end_date).slice(0, ISO_DATE_LENGTH) : '');

  const times = Array.isArray(requirement.frequency_times) ? requirement.frequency_times : [];
  [...form.querySelectorAll('input[name="frequency_times"]')].forEach((input, index) => {
    input.value = times[index] || '';
  });
  Object.entries(requirement.frequency_slots || {}).forEach(([slot, time]) => {
    const box = form.elements[`frequency_meal_${slot}`];
    const clock = form.elements[`frequency_meal_${slot}_time`];
    if (box) {box.checked = true;}
    if (clock) {clock.value = time;}
  });
  if (requirement.frequency_interval_hours) {
    set('frequency_interval_hours', requirement.frequency_interval_hours);
  }
  if (requirement.frequency_interval_start) {
    set('frequency_interval_start', String(requirement.frequency_interval_start).slice(0, CLOCK_TIME_LENGTH));
  }
}
