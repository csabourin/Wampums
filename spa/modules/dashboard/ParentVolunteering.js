/**
 * "Lend a hand" on the parent dashboard: the places still open on the unit's
 * volunteer shifts, and the family's own places, each leading to its page.
 *
 * Parents hold `volunteers.view` and `volunteer_space.view` since migration
 * 084: the cooks and drivers of a camp are most often the youth's parents.
 * `GET /v1/volunteer-shifts` never names the other volunteers to them.
 *
 * @module spa/modules/dashboard/ParentVolunteering
 */
import { translate } from '../../app.js';

/**
 * What the dashboard says about volunteering.
 *
 * @param {Array<Object>} shifts - Upcoming shifts, as `/v1/volunteer-shifts` returns them
 * @returns {{openPlaces: number, openShifts: number, myPlaces: number}} Counts
 */
export function summarizeVolunteering(shifts) {
  const list = Array.isArray(shifts) ? shifts : [];
  const open = list.filter((shift) => !shift.mine && Number(shift.slots) > Number(shift.taken));
  return {
    openPlaces: open.reduce((sum, shift) => sum + (Number(shift.slots) - Number(shift.taken)), 0),
    openShifts: open.length,
    myPlaces: list.filter((shift) => shift.mine).length,
  };
}

/**
 * Markup of the section, or nothing when there is neither a place to take
 * nor one taken: it is an invitation, not a list to keep.
 *
 * @param {{openPlaces: number, myPlaces: number}} summary - From summarizeVolunteering
 * @param {Object} options - What the account may open
 * @param {boolean} options.space - The account may open the volunteer space
 * @returns {string} Markup
 */
export function renderVolunteeringSection(summary, { space }) {
  if (!summary || (summary.openPlaces === 0 && summary.myPlaces === 0)) {
    return '';
  }
  const openText = summary.openPlaces > 0
    ? `<p class="parent-volunteering__text">${translate(summary.openPlaces === 1 ? 'parent_volunteering_open_one' : 'parent_volunteering_open_other')
      .replace('{count}', String(summary.openPlaces))}</p>`
    : '';
  const mineText = summary.myPlaces > 0
    ? `<p class="parent-volunteering__text">${translate(summary.myPlaces === 1 ? 'parent_volunteering_mine_one' : 'parent_volunteering_mine_other')
      .replace('{count}', String(summary.myPlaces))}</p>`
    : '';
  const mineLink = summary.myPlaces > 0 && space
    ? `<a class="button button--secondary" href="/volunteer-space">${translate('parent_volunteering_my_space')}</a>`
    : '';
  const openLink = summary.openPlaces > 0
    ? `<a class="button button--primary" href="/volunteers">${translate('parent_volunteering_take')}</a>`
    : '';
  return `
    <section class="parent-dashboard__volunteering parent-volunteering" aria-labelledby="parent-volunteering-title">
      <h2 class="parent-volunteering__heading" id="parent-volunteering-title">${translate('parent_volunteering_title')}</h2>
      ${openText}
      ${mineText}
      <div class="parent-volunteering__actions">${openLink}${mineLink}</div>
    </section>`;
}
