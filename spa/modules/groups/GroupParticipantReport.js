/**
 * Den list — who is in each den and who leads it, on screen and on paper.
 *
 * Each den is a card. On screen the cards fill the width; printed they flow in
 * two columns and a den is never cut between two pages, so a pack fits on one
 * sheet in type a leader can still read at arm's length.
 *
 * @module spa/modules/groups/GroupParticipantReport
 */
import { getParticipants, getGroups } from '../../ajax-functions.js';
import { debugError } from '../../utils/DebugUtils.js';
import { translate } from '../../app.js';
import { normalizeParticipantList } from '../../utils/ParticipantRoleUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import { youthDisplayName, youthFirstName } from '../../utils/DisplayNameUtils.js';

/** Card key for youth who are in no den. */
const UNASSIGNED = 'unassigned';

/**
 * Where a youth sits in their den's list: den leader first, second last.
 *
 * @param {Object} participant - Normalized participant
 * @returns {number} Sort rank
 */
function leaderRank(participant) {
  if (participant.first_leader) {
    return -1;
  }
  return participant.second_leader ? 1 : 0;
}

export class PrintableGroupParticipantReport {
  /** @param {Object} app - Application instance */
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.groups = [];
    this.destroyed = false;
  }

  /** Called by the router when the person leaves this screen. */
  destroy() {
    this.destroyed = true;
  }

  /** @returns {Promise<void>} */
  async init() {
    this.renderLoading();
    try {
      await this.fetchData();
      this.render();
    } catch (error) {
      debugError('Error loading den list:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async fetchData() {
    const [participantsResponse, groupsResponse] = await Promise.all([getParticipants(), getGroups()]);
    this.participants = normalizeParticipantList(
      participantsResponse?.data || participantsResponse?.participants || []
    );
    const groups = groupsResponse?.data || groupsResponse?.groups || [];
    this.groups = Array.isArray(groups)
      ? [...groups].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
      : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /**
   * The page around a state: back link, then the title.
   *
   * @param {string} body - HTML for the state
   * @param {{busy?: boolean}} [options]
   * @returns {string} HTML
   */
  page(body, { busy = false } = {}) {
    return `
      <section class="page den-list-report"${busy ? ' aria-busy="true"' : ''}>
        ${renderBackLink()}
        <h1>${translate('den_list_report')}</h1>
        ${body}
      </section>
    `;
  }

  renderLoading() {
    setContent(this.root(), this.page(`<p role="status">${translate('loading')}</p>`, { busy: true }));
  }

  renderError() {
    if (this.destroyed) {
      return;
    }
    const root = setContent(this.root(), this.page(`
      <p class="status-message error" role="alert">${translate('error_loading_group_participant_report')}</p>
      <button type="button" class="button button--primary" id="den-list-retry">${translate('retry')}</button>
    `));
    root?.querySelector('#den-list-retry')?.addEventListener('click', () => this.init());
  }

  /**
   * The dens that have youth, in name order, then the youth in no den.
   *
   * @returns {Array<{key: string|number, name: string, members: Array<Object>}>} Den cards
   */
  dens() {
    const groupIds = new Set(this.groups.map((group) => group.id));
    const sortMembers = (members) => members.sort((a, b) => (
      leaderRank(a) - leaderRank(b) || youthFirstName(a).localeCompare(youthFirstName(b))
    ));
    const dens = this.groups.map((group) => ({
      key: group.id,
      name: group.name,
      members: sortMembers(this.participants.filter((participant) => participant.group_id === group.id)),
    }));
    dens.push({
      key: UNASSIGNED,
      name: translate('unassigned_participants'),
      members: sortMembers(this.participants.filter((participant) => !groupIds.has(participant.group_id))),
    });
    return dens.filter((den) => den.members.length > 0);
  }

  /**
   * @param {Object} participant - Normalized participant
   * @returns {string} The youth's den role, or nothing
   */
  roleLabel(participant) {
    if (participant.first_leader) {
      return translate('first_leader');
    }
    return participant.second_leader ? translate('second_leader') : '';
  }

  /**
   * @param {{key: string|number, name: string, members: Array<Object>}} den
   * @returns {string} HTML
   */
  renderDen(den) {
    const headingId = `den-list-den-${escapeHTML(String(den.key))}`;
    return `
      <section class="den-list-card" aria-labelledby="${headingId}">
        <h2 class="den-list-card__title" id="${headingId}">
          ${escapeHTML(den.name)} <span class="den-list-card__count">(${den.members.length})</span>
        </h2>
        <ul class="den-list-card__members">
          ${den.members.map((participant) => {
    const role = this.roleLabel(participant);
    return `
            <li class="den-list-card__member">
              <span class="den-list-card__name">${escapeHTML(youthDisplayName(participant))}</span>
              ${role ? `<strong class="den-list-card__role">${role}</strong>` : ''}
            </li>`;
  }).join('')}
        </ul>
      </section>
    `;
  }

  render() {
    // #app outlives every screen: a late answer must not draw over the next one.
    if (this.destroyed) {
      return;
    }
    const dens = this.dens();
    if (dens.length === 0) {
      setContent(this.root(), this.page(`<p class="den-list-report__empty">${translate('den_list_empty')}</p>`));
      return;
    }
    const printedOn = translate('printed_on').replace('{date}', formatDateShort(new Date(), this.app?.lang));
    const root = setContent(this.root(), this.page(`
      <p class="den-list-report__printed">${escapeHTML(printedOn)}</p>
      <div class="den-list-report__actions">
        <button type="button" class="button button--primary" id="den-list-print">${translate('print_report')}</button>
      </div>
      <div class="den-list-grid">
        ${dens.map((den) => this.renderDen(den)).join('')}
      </div>
    `));
    root?.querySelector('#den-list-print')?.addEventListener('click', () => window.print());
  }
}
