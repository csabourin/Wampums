/**
 * Volunteer types and their requirements, as config/volunteer_shifts.json lists them (the
 * server applies the same file). Labels come from `volunteer_type_<key>` and
 * `volunteer_requirement_<key>`.
 */
import { translate } from '../app.js';
import config from '../../config/volunteer_shifts.json';

/** Requirements each type carries, in order. */
export const TYPE_REQUIREMENTS = new Map(config.types.map((type) => [type.key, type.requirements]));
export const VOLUNTEER_TYPES = [...TYPE_REQUIREMENTS.keys()];
export const VOLUNTEER_REQUIREMENTS = config.requirements;

/** @param {string} type @returns {string} The type's name in the interface language */
export function volunteerTypeLabel(type) {
  return translate(`volunteer_type_${TYPE_REQUIREMENTS.has(type) ? type : 'other'}`);
}

/** @param {Array<string>} keys @returns {string} Requirement names, joined */
export function requirementsLabel(keys) {
  return (keys || []).map((key) => translate(`volunteer_requirement_${key}`)).join(', ');
}

/**
 * @param {{volunteer_type: string, title?: string}} shift
 * @returns {string} Its type, then its own precision; "Other" is named by its title alone
 */
export function shiftName(shift) {
  if (shift.volunteer_type === 'other' && shift.title) { return shift.title; }
  return shift.title ? `${volunteerTypeLabel(shift.volunteer_type)} · ${shift.title}` : volunteerTypeLabel(shift.volunteer_type);
}
