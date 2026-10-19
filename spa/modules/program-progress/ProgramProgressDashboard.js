import { translate } from '../../app.js';
import { getProgramProgressStream } from '../../ajax-functions.js';
import { debugError } from '../../utils/DebugUtils.js';
import { setContent } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { formatDateShort, parseDate } from '../../utils/DateUtils.js';
import { BaseModule } from '../../utils/BaseModule.js';
import { getMountPoint, resolveMountOptions } from '../../utils/PageMount.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';

/** Columns of the stream table, for a row that spans it. */
const STREAM_COLUMNS = 5;

const SOURCE_LABEL_KEYS = {
  badge_presentation: 'program_progress_source_badge_presentation',
  oas_competency: 'program_progress_source_oas_competency',
  oas_stage_award: 'program_progress_source_oas_stage_award',
  credential: 'program_progress_source_credential',
  pab_plan: 'program_progress_source_pab_plan',
  pab_review: 'program_progress_source_pab_review',
  top_award_progress: 'program_progress_source_top_award_progress',
  top_award_service: 'program_progress_source_top_award_service',
  top_award_project: 'program_progress_source_top_award_project',
  top_award_review: 'program_progress_source_top_award_review'
};

/**
 * Every status the progress tables hold (their CHECK constraints, and what the
 * badge routes write), each shown as `program_progress_status_<status>`.
 * Anything else shows as "other", never as the raw value.
 */
export const PROGRAM_PROGRESS_STATUSES = [
  'recorded', 'pending', 'approved', 'rejected', 'in_progress', 'awarded', 'revoked', 'active',
  'expired', 'planned', 'completed', 'cancelled', 'submitted', 'logged', 'draft', 'revisions_required',
];

export class ProgramProgressDashboard extends BaseModule {
  constructor(app, options = {}) {
    super(app);
    this.items = [];
    this.participants = [];
    this.summary = { total: 0, by_source: {} };
    this.selectedParticipantId = options.participantId ? Number(options.participantId) : null;
    this.viewOnly = !!options.viewOnly;
    this.returnUrl = options.returnUrl || '/dashboard';
    Object.assign(this, resolveMountOptions(options));
  }

  async init() {
    this.renderLoading();
    await this.reload();
  }

  /**
   * Load the stream and draw it, or the error state. A failed load is never
   * shown as an empty stream.
   *
   * @returns {Promise<void>}
   */
  async reload() {
    try {
      await this.loadData();
    } catch (error) {
      debugError('Error loading program progress stream', error);
      this.renderError();
      return;
    }
    // A late answer must not draw over the screen the person moved to.
    if (this.isDestroyed) {
      return;
    }
    this.render();
    this.attachEventListeners();
  }

  async loadData() {
    const params = this.selectedParticipantId ? { participant_id: this.selectedParticipantId } : {};
    const response = await getProgramProgressStream(params);
    const data = response?.data || response || {};
    this.items = Array.isArray(data.items) ? data.items : [];
    this.participants = Array.isArray(data.participants) ? data.participants : [];
    this.summary = data.summary || { total: this.items.length, by_source: {} };
  }

  /** @returns {string} Back link and heading, unless the tabbed page draws them */
  renderChrome() {
    return this.embedded
      ? ''
      : `${renderBackLink(this.returnUrl)}<h1>${translate('program_progress_dashboard_title')}</h1>`;
  }

  renderLoading() {
    setContent(getMountPoint(this), `
      <div class="container" aria-busy="true">
        ${this.renderChrome()}
        <p role="status">${translate('loading')}</p>
      </div>
    `);
  }

  renderError() {
    if (this.isDestroyed) {
      return;
    }
    setContent(getMountPoint(this), `
      <div class="container">
        ${this.renderChrome()}
        <p class="status-message error" role="alert">${translate('error_loading_data')}</p>
        <button type="button" class="button button--secondary" id="program-progress-retry">${translate('retry')}</button>
      </div>
    `);
    document.getElementById('program-progress-retry')?.addEventListener('click', () => this.init());
  }

  getSourceLabel(sourceKey) {
    return translate(SOURCE_LABEL_KEYS[sourceKey] || 'program_progress_source_generic');
  }

  /**
   * @param {string} status - Status as the progress table stores it
   * @returns {string} Its label in the page's language
   */
  getStatusLabel(status) {
    return translate(PROGRAM_PROGRESS_STATUSES.includes(status)
      ? `program_progress_status_${status}`
      : 'program_progress_status_other');
  }

  /**
   * A record with no title of its own is given its source's key by the server:
   * name the source instead.
   *
   * @param {Object} item - Stream item
   * @returns {string} Text for the description column
   */
  getItemTitle(item) {
    if (!item.title || item.title === item.source_key) {
      return this.getSourceLabel(item.source_key);
    }
    return item.title;
  }

  renderSummaryChips() {
    const entries = Object.entries(this.summary?.by_source || {});
    if (entries.length === 0) {
      return `<p class="muted-text">${translate('program_progress_no_summary')}</p>`;
    }

    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([source, count]) => `
        <span class="badge-summary-chip">
          ${escapeHTML(this.getSourceLabel(source))}: <strong>${count}</strong>
        </span>
      `)
      .join('');
  }

  renderRows() {
    if (!Array.isArray(this.items) || this.items.length === 0) {
      return `<tr><td colspan="${STREAM_COLUMNS}" class="muted-text">${translate('program_progress_empty')}</td></tr>`;
    }

    return this.items
      .map((item) => {
        const eventDate = item.event_at ? formatDateShort(parseDate(item.event_at)) : translate('not_available');
        return `
          <tr>
            <td>${escapeHTML(item.participant_name || '-')}</td>
            <td>${escapeHTML(this.getSourceLabel(item.source_key))}</td>
            <td>${escapeHTML(this.getItemTitle(item))}</td>
            <td>${escapeHTML(this.getStatusLabel(item.status))}</td>
            <td>${escapeHTML(eventDate)}</td>
          </tr>
        `;
      })
      .join('');
  }

  render() {
    const participantOptions = this.participants
      .map((participant) => {
        const selected = Number(participant.id) === Number(this.selectedParticipantId) ? 'selected' : '';
        const name = `${participant.first_name || ''} ${participant.last_name || ''}`.trim();
        return `<option value="${participant.id}" ${selected}>${escapeHTML(name)}</option>`;
      })
      .join('');

    const participantFilter = this.viewOnly
      ? ''
      : `
      <div class="program-progress__filters">
        <label for="program-progress-participant-filter">${translate('participant')}</label>
        <select id="program-progress-participant-filter">
          <option value="">${translate('all_participants')}</option>
          ${participantOptions}
        </select>
      </div>
    `;

    // When embedded in a TabbedPage the host already draws the back link and
    // the page title; repeating them would stack two headings.
    const content = `
      <div class="container">
        ${this.embedded ? '' : renderBackLink(this.returnUrl)}
        <section class="card" style="margin-top: 1rem;">
          ${this.embedded ? '' : `<h1>${translate('program_progress_dashboard_title')}</h1>`}
          <p class="muted-text">${translate('program_progress_dashboard_subtitle')}</p>
          ${participantFilter}
          <div class="program-progress__summary" style="margin: 1rem 0; display:flex; gap:.5rem; flex-wrap:wrap;">
            <span class="badge-summary-chip">${translate('total')}: <strong>${this.summary?.total || 0}</strong></span>
            ${this.renderSummaryChips()}
          </div>
          <div class="table-container">
            <table class="participants-table">
              <thead>
                <tr>
                  <th>${translate('participant')}</th>
                  <th>${translate('program_progress_stream_type')}</th>
                  <th>${translate('description')}</th>
                  <th>${translate('status')}</th>
                  <th>${translate('date')}</th>
                </tr>
              </thead>
              <tbody>
                ${this.renderRows()}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    setContent(getMountPoint(this), content);
  }

  attachEventListeners() {
    if (this.viewOnly) {
      return;
    }

    const participantFilter = document.getElementById('program-progress-participant-filter');
    if (!participantFilter) {
      return;
    }

    participantFilter.addEventListener('change', async (event) => {
      const selectedValue = event.target.value;
      this.selectedParticipantId = selectedValue ? Number(selectedValue) : null;
      await this.reload();
    });
  }
}
