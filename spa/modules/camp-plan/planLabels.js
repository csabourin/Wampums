/**
 * Names of the camp plan's written sections (#1318), shared by the plan, its
 * templates and the camp overview.
 *
 * @module spa/modules/camp-plan/planLabels
 */
import { translate } from '../../app.js';
import rules from '../../../config/camp_plan.json';

/** Every section a camp's plan shows, in plan order. */
export const CAMP_PLAN_SECTIONS = [...rules.VCPREF_SECTIONS, ...rules.STORY_SECTIONS, ...rules.UNIT_SECTIONS];

/**
 * @param {string} key - A section key, or `rain_games`
 * @returns {string} Its translated name
 */
export function planSectionLabel(key) {
  return translate(`camp_plan_section_${key}`);
}

/** The plan's parts, one shown at a time: each groups sections the permit lists together. */
export const CAMP_PLAN_PARTS = [
  { key: 'vcpref', sections: rules.VCPREF_SECTIONS },
  { key: 'story', sections: rules.STORY_SECTIONS },
  { key: 'unit', sections: rules.UNIT_SECTIONS },
  { key: 'rain', sections: ['rain_games'] },
];

/**
 * @param {string} key - A section key, or `rain_games`
 * @returns {string} The part holding it, the first part when unknown
 */
export function planPartOf(key) {
  return (CAMP_PLAN_PARTS.find((part) => part.sections.includes(key)) || CAMP_PLAN_PARTS[0]).key;
}

/**
 * @param {string} part - A part key
 * @returns {string} Its translated name
 */
export function planPartLabel(part) {
  return part === 'rain' ? planSectionLabel('rain_games') : translate(`camp_plan_group_${part}`);
}
