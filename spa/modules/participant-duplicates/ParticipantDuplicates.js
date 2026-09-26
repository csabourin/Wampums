/**
 * Possible duplicates — two records that may describe one child.
 *
 * Pairs arrive when two parents link, or when a parent registers a child, and
 * the two records share a name and a birth date. Nothing has been merged: a
 * name and a birth date are strong evidence and still not proof, and merging
 * two different children would put one child's medical record in the other's
 * file. The administrator, who knows the family, says which it is.
 *
 * "Same child" records the decision. Combining the two files is a separate,
 * deliberate step, and the page says so rather than implying it happened.
 *
 * @module spa/modules/participant-duplicates/ParticipantDuplicates
 */

import { translate } from '../../app.js';
import { setContent } from '../../utils/DOMUtils.js';
import { loadFamilyAccessStyles } from '../family-access/styles.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugError } from '../../utils/DebugUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import {
  getParticipantDuplicates,
  resolveParticipantDuplicate,
} from '../../api/api-parent-invitations.js';

/** Birth dates in full: telling two children apart may hinge on them. */
const BIRTH_DATE = { year: 'numeric', month: 'long', day: 'numeric' };

export class ParticipantDuplicates {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    this.app = app;
    this.candidates = [];
    this.showDecided = false;
  }

  /** @returns {Promise<void>} */
  async init() {
    loadFamilyAccessStyles();
    this.renderLoading();
    try {
      await this.load();
      this.render();
    } catch (error) {
      debugError('Failed to load duplicate candidates:', error);
      this.renderError();
    }
  }

  /** @returns {Promise<void>} */
  async load() {
    const response = await getParticipantDuplicates({ all: this.showDecided });
    this.candidates = Array.isArray(response?.data) ? response.data : [];
  }

  /** @returns {HTMLElement|null} The page root */
  root() {
    return document.getElementById('app');
  }

  /** @returns {string} The page language */
  lang() {
    return this.app?.lang || document.documentElement.lang || 'fr';
  }

  /** @returns {void} */
  renderLoading() {
    setContent(this.root(), `
      <section class="page participant-duplicates" aria-busy="true">
        <h1>${translate('participant_duplicates_title')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  /** @returns {void} */
  renderError() {
    setContent(this.root(), `
      <section class="page participant-duplicates">
        <h1>${translate('participant_duplicates_title')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button" id="participant-duplicates-retry">${translate('parent_invitations_retry')}</button>
      </section>
    `);
    document.getElementById('participant-duplicates-retry')?.addEventListener('click', () => this.init());
  }

  /** @returns {void} */
  render() {
    setContent(this.root(), `
      <section class="page participant-duplicates">
        <h1>${translate('participant_duplicates_title')}</h1>
        <p>${translate('participant_duplicates_intro')}</p>
        <label class="checkbox-label">
          <input type="checkbox" id="participant-duplicates-show-decided" ${this.showDecided ? 'checked' : ''} />
          ${translate('participant_duplicates_show_decided')}
        </label>
        <p id="participant-duplicates-status" class="status-message" role="status" hidden></p>
        ${this.candidates.length === 0
          ? `<p class="empty-state">${translate('participant_duplicates_empty')}</p>`
          : `<ul class="duplicate-list">${this.candidates.map((candidate) => this.renderCandidate(candidate)).join('')}</ul>`}
      </section>
    `);

    document.getElementById('participant-duplicates-show-decided')?.addEventListener('change', async (event) => {
      this.showDecided = event.currentTarget.checked;
      await this.init();
    });

    this.root()?.querySelectorAll('[data-decision]').forEach((button) => {
      button.addEventListener('click', () => this.decide(button.dataset.id, button.dataset.decision));
    });
  }

  /**
   * One side of a pair.
   *
   * @param {Object} side - Participant description from the API
   * @returns {string} HTML
   */
  renderSide(side) {
    const list = (items) => (Array.isArray(items) && items.length > 0
      ? items.map((item) => escapeHTML(item)).join(', ')
      : translate('participant_duplicates_none'));

    return `
      <div class="duplicate-side">
        <span class="duplicate-side__label">${translate('participant_duplicates_record').split('{id}').join(escapeHTML(String(side.id)))}</span>
        <strong>${escapeHTML(`${side.first_name || ''} ${side.last_name || ''}`.trim())}</strong>
        <dl>
          <dt>${translate('date_naissance')}</dt>
          <dd>${escapeHTML(formatDate(side.date_naissance, this.lang(), BIRTH_DATE))}</dd>
          <dt>${translate('participant_duplicates_units')}</dt>
          <dd>${list(side.units)}</dd>
          <dt>${translate('participant_duplicates_accounts')}</dt>
          <dd>${list(side.accounts)}</dd>
        </dl>
        ${side.in_this_unit ? '' : `<p class="form-hint">${translate('participant_duplicates_other_unit')}</p>`}
      </div>
    `;
  }

  /**
   * A pair, with the two answers when it is still undecided.
   *
   * @param {Object} candidate - Candidate from the API
   * @returns {string} HTML
   */
  renderCandidate(candidate) {
    const id = escapeHTML(String(candidate.id));
    const sides = Array.isArray(candidate.participants) ? candidate.participants : [];

    return `
      <li class="duplicate-card">
        <div class="duplicate-card__sides">${sides.map((side) => this.renderSide(side)).join('')}</div>
        ${candidate.status === 'pending' ? `
          <label for="duplicate-note-${id}">${translate('participant_duplicates_note')}</label>
          <textarea id="duplicate-note-${id}" rows="2" maxlength="1000"></textarea>
          <div class="duplicate-card__actions">
            <button type="button" class="button button--primary" data-id="${id}" data-decision="same_person">
              ${translate('participant_duplicates_same')}
            </button>
            <button type="button" class="button button--secondary" data-id="${id}" data-decision="different">
              ${translate('participant_duplicates_different')}
            </button>
          </div>
        ` : `
          <p class="duplicate-card__decision">
            ${translate(`participant_duplicates_decided_${candidate.status === 'same_person' ? 'same' : 'different'}`)}
            ${candidate.resolved_by_name ? `— ${escapeHTML(candidate.resolved_by_name)}` : ''}
            ${candidate.resolution_note ? `<br />${escapeHTML(candidate.resolution_note)}` : ''}
          </p>
        `}
      </li>
    `;
  }

  /**
   * Record a decision.
   *
   * @param {string} candidateId - Candidate id
   * @param {string} decision - `same_person` or `different`
   * @returns {Promise<void>}
   */
  async decide(candidateId, decision) {
    const note = document.getElementById(`duplicate-note-${candidateId}`)?.value.trim() || null;
    try {
      await resolveParticipantDuplicate(Number(candidateId), decision, note);
      await this.load();
      this.render();
      this.showStatus(decision === 'same_person'
        ? 'participant_duplicates_recorded_same'
        : 'participant_duplicates_recorded_different');
    } catch (error) {
      debugError('Failed to record duplicate decision:', error);
      this.showStatus('participant_duplicates_failed', 'error');
    }
  }

  /**
   * Show a message at the top of the list.
   *
   * @param {string} key - Translation key
   * @param {string} [kind] - `success` or `error`
   * @returns {void}
   */
  showStatus(key, kind = 'success') {
    const element = document.getElementById('participant-duplicates-status');
    if (!element) return;
    element.textContent = translate(key);
    element.className = `status-message ${kind}`;
    element.hidden = false;
  }
}
