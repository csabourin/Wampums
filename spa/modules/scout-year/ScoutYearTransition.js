/**
 * Scout Year Transition
 *
 * End-of-year wizard: review who leaves the section, see the consequences,
 * confirm, and read the report.
 *
 * Nothing is ever deleted. Participants who leave keep their record and stay
 * consultable in the year they belonged to; parent accounts are deactivated,
 * never removed, and can be brought back in one click.
 *
 * The happy path is meant to be one look and one click: everything is
 * pre-filled from the age rule, and the review step only costs time when there
 * is an actual exception to make.
 */

import { BaseModule } from '../../utils/BaseModule.js';
import { translate } from '../../app.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { debugLog, debugError } from '../../utils/DebugUtils.js';
import { hasPermission } from '../../utils/PermissionUtils.js';
import { formatDate } from '../../utils/DateUtils.js';
import { confirm as confirmDialog } from '../../utils/DialogUtils.js';
import {
  getScoutYears,
  getTransitionPreview,
  executeTransition,
  setMembershipStatus,
  getTransitions,
  getReactivationRequests,
  rollbackTransition
} from '../../api/api-scout-years.js';
import { sendAlumniInvitations } from '../../api/api-alumni.js';

const STEP_ROSTER = 1;
const STEP_CONSEQUENCES = 2;
const STEP_CONFIRM = 3;
const STEP_REPORT = 4;
const LAST_WIZARD_STEP = STEP_CONFIRM;
/** The age reference date reads better without the weekday. */
const DATE_FORMAT = { year: 'numeric', month: 'long', day: 'numeric' };

export class ScoutYearTransition extends BaseModule {
  /**
   * @param {Object} app - Application instance
   */
  constructor(app) {
    super(app);
    this.step = STEP_ROSTER;
    this.isLoading = true;
    this.isSubmitting = false;
    this.canManage = false;
    this.isRollingBack = false;
    this.isInvitingAlumni = false;
    this.preview = null;
    this.years = [];
    this.transitions = [];
    this.reactivationRequests = [];
    this.result = null;
    this.loadError = null;

    /** @type {Map<number, string>} participant id -> 'graduating' | 'returning' */
    this.dispositions = new Map();
    /** @type {Map<number, string>} participant id -> note explaining an exception */
    this.exceptionNotes = new Map();
    /** @type {Set<number>} membership ids confirmed for deactivation */
    this.selectedMemberships = new Set();
    /** Dispositions the age rule proposed, to detect leader overrides. */
    this.proposedDispositions = new Map();
    /** Delegated listeners are bound once; see attachEventListeners(). */
    this._listenersAttached = false;
  }

  async init() {
    this.canManage = hasPermission('scout_year.manage');

    const container = document.getElementById('app');
    setContent(container, `<div class="page-loading">${translate('loading')}</div>`);

    await loadStylesheet('/css/scout-year.css');

    try {
      await this.loadData();
      this.loadError = null;
    } catch (error) {
      debugError('Failed to load scout year transition:', error);
      this.loadError = error?.message || translate('scout_year_load_failed');
    }

    this.isLoading = false;
    this.render();
    this.attachEventListeners();
  }

  async loadData() {
    this.years = await getScoutYears({ forceRefresh: true });
    this.transitions = await getTransitions();

    if (!this.canManage) {
      return;
    }

    this.reactivationRequests = await getReactivationRequests();
    this.preview = await getTransitionPreview();
    this.dispositions = new Map(
      this.preview.participants.map(p => [p.id, p.disposition])
    );
    this.proposedDispositions = new Map(this.dispositions);
    this.selectedMemberships = new Set(
      this.preview.memberships_to_deactivate.map(m => m.membership_id)
    );
    debugLog('Transition preview loaded', this.preview.counts);
  }

  /**
   * Participant ids currently marked as leaving.
   *
   * @returns {Array<number>} Participant ids
   */
  graduatingIds() {
    return [...this.dispositions.entries()]
      .filter(([, disposition]) => disposition === 'graduating')
      .map(([id]) => id);
  }

  /**
   * Participants kept in the section despite reaching the age limit.
   *
   * @returns {Array<Object>} Participants
   */
  exceptions() {
    return this.preview.participants.filter(
      p => this.proposedDispositions.get(p.id) === 'graduating'
        && this.dispositions.get(p.id) === 'returning'
    );
  }

  // ---------------------------------------------------------------- rendering

  render() {
    const container = document.getElementById('app');

    if (this.isLoading) {
      setContent(container, `<div class="page-loading">${translate('loading')}</div>`);
      return;
    }

    setContent(
      container,
      `<div class="page scout-year-page">
        <a href="/unit-settings" class="button button--ghost">← ${translate('back')}</a>
        <h1>${translate('scout_year_title')}</h1>
        <p class="page-description">${translate('scout_year_description')}</p>
        ${this.loadError ? this.renderError() : ''}
        ${this.canManage && !this.loadError ? this.renderReactivationRequests() : ''}
        ${this.canManage && !this.loadError ? this.renderWizard() : ''}
        ${!this.canManage ? `<p class="muted-text">${translate('scout_year_view_only')}</p>` : ''}
        ${this.renderLastTransition()}
        ${this.renderHistory()}
      </div>`
    );
  }

  renderError() {
    return `<div class="alert alert--error" role="alert">${escapeHTML(this.loadError)}</div>`;
  }

  /**
   * People asking to come back, and the one button that lets them.
   *
   * Renders nothing at all when nobody is waiting. This section answers a
   * question a leader only has when it has an answer, and an empty panel on
   * every visit would train them to stop reading it — which is the one failure
   * mode that matters for a queue whose whole job is to be noticed.
   *
   * @returns {string} Markup, or an empty string
   */
  renderReactivationRequests() {
    if (this.reactivationRequests.length === 0) {
      return '';
    }

    const rows = this.reactivationRequests.map((request) => {
      const name = escapeHTML(request.full_name || request.email || '');
      const email = escapeHTML(request.email || '');
      const askedOn = translate('reactivation_requests_requested_on')
        .replace('{date}', escapeHTML(
          formatDate(request.reactivation_requested_at, this.app?.lang || 'fr', DATE_FORMAT)
        ));

      return `<li class="scout-year-request">
          <div>
            <strong>${name}</strong>
            <span class="muted-text">${email}</span>
            <span class="muted-text">${askedOn}</span>
          </div>
          <button type="button"
                  class="button button--primary js-approve-reactivation"
                  data-membership-id="${request.membership_id}">
            ${translate('reactivation_requests_approve')}
          </button>
        </li>`;
    }).join('');

    return `<section class="card scout-year-requests">
        <h2>${translate('reactivation_requests_title')}</h2>
        <p class="page-description">${translate('reactivation_requests_description')}</p>
        <ul class="scout-year-request-list">${rows}</ul>
      </section>`;
  }

  renderWizard() {
    if (this.step === STEP_REPORT) {
      return this.renderReport();
    }

    const steps = [
      { n: STEP_ROSTER, label: translate('scout_year_step_roster') },
      { n: STEP_CONSEQUENCES, label: translate('scout_year_step_consequences') },
      { n: STEP_CONFIRM, label: translate('scout_year_step_confirm') }
    ];

    const stepper = steps
      .map(({ n, label }) => {
        const state = n === this.step ? 'is-current' : (n < this.step ? 'is-done' : '');
        return `<li class="scout-year-stepper__item ${state}">
            <span class="scout-year-stepper__number">${n}</span>
            <span class="scout-year-stepper__label">${label}</span>
          </li>`;
      })
      .join('');

    let body = '';
    if (this.step === STEP_ROSTER) {
      body = this.renderRosterStep();
    } else if (this.step === STEP_CONSEQUENCES) {
      body = this.renderConsequencesStep();
    } else {
      body = this.renderConfirmStep();
    }

    return `
      <section class="account-section scout-year-wizard">
        <ol class="scout-year-stepper">${stepper}</ol>
        ${body}
        ${this.renderNavigation()}
      </section>`;
  }

  renderYearHeadline() {
    const from = escapeHTML(this.preview.current_year.label);
    const to = escapeHTML(this.preview.next_year.label);
    return `<p class="scout-year-headline"><strong>${from}</strong> → <strong>${to}</strong></p>`;
  }

  renderRosterStep() {
    const { age_rule: ageRule, participants } = this.preview;

    // Everything needing a decision floats to the top: leavers first, then the
    // participants the age rule could not judge, then the untouched majority.
    const ordered = [...participants].sort((a, b) => {
      const weight = p => (this.proposedDispositions.get(p.id) === 'graduating' ? 0 : 1)
        + (p.needs_review ? -0.5 : 0);
      const diff = weight(a) - weight(b);
      return diff !== 0 ? diff : `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
    });

    const rows = ordered.map(p => this.renderParticipantRow(p)).join('');
    const graduatingCount = this.graduatingIds().length;

    return `
      ${this.renderYearHeadline()}
      <h2>${translate('scout_year_step_roster')}</h2>
      <p class="section-description">
        ${translate('scout_year_roster_description').replace('{age}', String(ageRule.max_age))
    .replace('{date}', escapeHTML(formatDate(ageRule.reference_date, this.app?.lang || 'fr', DATE_FORMAT)))}
      </p>
      <p class="scout-year-summary" id="roster-summary">
        ${this.renderRosterSummary(graduatingCount)}
      </p>
      <ul class="scout-year-list">${rows}</ul>`;
  }

  /**
   * @param {number} graduatingCount - Participants currently leaving
   * @returns {string} Summary sentence
   */
  renderRosterSummary(graduatingCount) {
    const total = this.preview.participants.length;
    const staying = total - graduatingCount;
    return translate('scout_year_roster_summary')
      .replace('{leaving}', String(graduatingCount))
      .replace('{staying}', String(staying));
  }

  renderParticipantRow(participant) {
    const disposition = this.dispositions.get(participant.id);
    const proposed = this.proposedDispositions.get(participant.id);
    const isLeaving = disposition === 'graduating';
    const isException = proposed === 'graduating' && disposition === 'returning';
    const name = escapeHTML(`${participant.first_name} ${participant.last_name}`);
    const group = participant.group_name ? escapeHTML(participant.group_name) : '';
    const age = participant.age_at_reference === null
      ? translate('scout_year_unknown_age')
      : translate('scout_year_age_value').replace('{age}', String(participant.age_at_reference));

    return `
      <li class="scout-year-list__item ${isLeaving ? 'is-leaving' : ''} ${participant.needs_review ? 'needs-review' : ''}"
          data-participant-id="${participant.id}">
        <div class="scout-year-list__main">
          <span class="scout-year-list__name">${name}</span>
          <span class="scout-year-list__meta">
            ${age}${group ? ` · ${group}` : ''} · ${translate('scout_year_points_this_year')
  .replace('{points}', String(participant.points_this_year))}
          </span>
          ${participant.needs_review
    ? `<span class="scout-year-flag">${translate('scout_year_needs_review')}</span>`
    : ''}
        </div>
        <div class="scout-year-list__action">
          <label class="toggle-label" for="disposition-${participant.id}">
            <span class="toggle-label__text">
              ${isLeaving ? translate('scout_year_leaving') : translate('scout_year_staying')}
            </span>
            <input type="checkbox"
                   role="switch"
                   id="disposition-${participant.id}"
                   class="js-disposition-toggle"
                   data-participant-id="${participant.id}"
                   ${isLeaving ? 'checked' : ''} />
          </label>
        </div>
        ${isException ? this.renderExceptionNote(participant) : ''}
      </li>`;
  }

  renderExceptionNote(participant) {
    const note = this.exceptionNotes.get(participant.id) || '';
    return `
      <div class="scout-year-exception">
        <label for="exception-note-${participant.id}">${translate('scout_year_exception_label')}</label>
        <input type="text"
               id="exception-note-${participant.id}"
               class="form-control js-exception-note"
               data-participant-id="${participant.id}"
               maxlength="500"
               placeholder="${translate('scout_year_exception_placeholder')}"
               value="${escapeHTML(note)}" />
      </div>`;
  }

  renderConsequencesStep() {
    const memberships = this.preview.memberships_to_deactivate;
    const graduatingCount = this.graduatingIds().length;

    const membershipRows = memberships.length === 0
      ? `<li class="scout-year-list__item is-empty">${translate('scout_year_no_membership_affected')}</li>`
      : memberships.map(m => {
        const checked = this.selectedMemberships.has(m.membership_id) ? 'checked' : '';
        const name = escapeHTML(m.full_name || m.email || '');
        const email = escapeHTML(m.email || '');
        return `
            <li class="scout-year-list__item" data-membership-id="${m.membership_id}">
              <div class="scout-year-list__main">
                <span class="scout-year-list__name">${name}</span>
                <span class="scout-year-list__meta">${email}</span>
              </div>
              <div class="scout-year-list__action">
                <label class="toggle-label" for="membership-${m.membership_id}">
                  <span class="toggle-label__text">${translate('scout_year_deactivate')}</span>
                  <input type="checkbox"
                         role="switch"
                         id="membership-${m.membership_id}"
                         class="js-membership-toggle"
                         data-membership-id="${m.membership_id}"
                         ${checked} />
                </label>
              </div>
            </li>`;
      }).join('');

    return `
      ${this.renderYearHeadline()}
      <h2>${translate('scout_year_step_consequences')}</h2>

      <div class="scout-year-consequence">
        <h3>${translate('scout_year_points_title')}</h3>
        <p class="section-description">
          ${translate('scout_year_points_description')
    .replace('{year}', escapeHTML(this.preview.current_year.label))}
        </p>
      </div>

      <div class="scout-year-consequence">
        <h3>${translate('scout_year_parents_title')}</h3>
        <p class="section-description">${translate('scout_year_parents_description')}</p>
        <p class="muted-text">${translate('scout_year_parents_staff_note')}</p>
        <ul class="scout-year-list">${membershipRows}</ul>
      </div>

      <div class="scout-year-consequence">
        <h3>${translate('scout_year_dens_title')}</h3>
        <p class="section-description">
          ${translate('scout_year_dens_description')
    .replace('{year}', escapeHTML(this.preview.current_year.label))}
        </p>
      </div>

      <div class="scout-year-consequence">
        <h3>${translate('scout_year_kept_title')}</h3>
        <p class="section-description">${translate('scout_year_kept_description')
    .replace('{leaving}', String(graduatingCount))}</p>
      </div>`;
  }

  renderConfirmStep() {
    const graduating = this.graduatingIds();
    const exceptions = this.exceptions();
    const staying = this.preview.participants.length - graduating.length;

    const leavingNames = graduating
      .map(id => this.preview.participants.find(p => p.id === id))
      .filter(Boolean)
      .map(p => `<li>${escapeHTML(`${p.first_name} ${p.last_name}`)}</li>`)
      .join('');

    const exceptionNames = exceptions
      .map(p => {
        const note = this.exceptionNotes.get(p.id);
        const suffix = note ? ` — ${escapeHTML(note)}` : '';
        return `<li>${escapeHTML(`${p.first_name} ${p.last_name}`)}${suffix}</li>`;
      })
      .join('');

    return `
      ${this.renderYearHeadline()}
      <h2>${translate('scout_year_step_confirm')}</h2>
      <p class="section-description">${translate('scout_year_confirm_description')}</p>

      <dl class="scout-year-recap">
        <div><dt>${translate('scout_year_recap_staying')}</dt><dd>${staying}</dd></div>
        <div><dt>${translate('scout_year_recap_leaving')}</dt><dd>${graduating.length}</dd></div>
        <div><dt>${translate('scout_year_recap_deactivated')}</dt><dd>${this.selectedMemberships.size}</dd></div>
      </dl>

      ${leavingNames
    ? `<details class="scout-year-details"><summary>${translate('scout_year_recap_leaving')}</summary>
           <ul>${leavingNames}</ul></details>`
    : ''}
      ${exceptionNames
    ? `<details class="scout-year-details" open><summary>${translate('scout_year_recap_exceptions')}</summary>
           <ul>${exceptionNames}</ul></details>`
    : ''}

      <p class="scout-year-reassurance">${translate('scout_year_nothing_deleted')}</p>`;
  }

  renderReport() {
    const summary = this.result?.summary || {};
    return `
      <section class="account-section scout-year-report">
        <h2>${translate('scout_year_report_title')}</h2>
        <p class="scout-year-headline">
          <strong>${escapeHTML(this.result.previous_year.label)}</strong> →
          <strong>${escapeHTML(this.result.new_year.label)}</strong>
        </p>
        <dl class="scout-year-recap">
          <div><dt>${translate('scout_year_recap_staying')}</dt><dd>${summary.carried_over ?? 0}</dd></div>
          <div><dt>${translate('scout_year_recap_leaving')}</dt><dd>${summary.graduated ?? 0}</dd></div>
          <div><dt>${translate('scout_year_recap_deactivated')}</dt><dd>${summary.memberships_deactivated ?? 0}</dd></div>
        </dl>
        <p class="scout-year-reassurance">${translate('scout_year_report_archive_hint')}</p>
        ${this.renderAlumniInvitation(summary)}
        <a href="/dashboard" class="button button--primary">${translate('scout_year_back_to_dashboard')}</a>
      </section>`;
  }

  /**
   * Offer to ask the families that just lost their access whether they want to
   * stay in touch.
   *
   * Placed here, in the report, because this is the moment the question makes
   * sense — the accounts were deactivated seconds ago. It is deliberately a
   * button and not something the transition does on its own: the transition runs
   * inside a database transaction, and nothing that sends email belongs there.
   *
   * @param {Object} summary - Transition summary
   * @returns {string} Markup, empty when nobody was deactivated
   */
  renderAlumniInvitation(summary) {
    const deactivated = summary.memberships_deactivated ?? 0;
    if (deactivated === 0 || !this.canManage) {
      return '';
    }

    return `
      <div class="scout-year-alumni">
        <p class="section-description">${translate('alumni_audience_help')}</p>
        <button type="button" class="button button--secondary" id="alumni-invite-btn"
                ${this.isInvitingAlumni ? 'disabled' : ''}>
          ${translate('alumni_invitations_send')}
        </button>
        <p class="scout-year-alumni__feedback" role="status" id="alumni-invite-feedback"></p>
      </div>`;
  }

  /**
   * Send the opt-in emails and report how many went out.
   *
   * @returns {Promise<void>}
   */
  async handleAlumniInvitation() {
    if (this.isInvitingAlumni) {
      return;
    }
    this.isInvitingAlumni = true;

    const feedback = document.getElementById('alumni-invite-feedback');
    const button = document.getElementById('alumni-invite-btn');
    if (button) {
      button.disabled = true;
    }

    try {
      const outcome = await sendAlumniInvitations();
      if (feedback) {
        feedback.textContent = translate('alumni_invitations_sent')
          .replace('{count}', String(outcome?.invited ?? 0));
      }
      debugError('Failed to send alumni invitations:', error);
      if (feedback) {
        feedback.textContent = translate('error_generic');
      }
      if (button) {
        button.disabled = false;
      }
    } finally {
      this.isInvitingAlumni = false;
    }
  }

  /**
   * The safety net: the most recent transition, and whether it can still be
   * undone.
   *
   * Rendered as its own section rather than inside the report, so it is still
   * there when the leader comes back the next morning having realised they
   * graduated the wrong child.
   *
   * @returns {string} Markup, empty when the unit has never run a transition
   */
  renderLastTransition() {
    const transition = this.transitions[0];
    if (!transition) {
      return '';
    }

    const from = escapeHTML(transition.from_label || '');
    const to = escapeHTML(transition.to_label || '');
    const when = escapeHTML(formatDate(transition.executed_at, this.app?.lang || 'fr', DATE_FORMAT));
    const who = transition.executed_by_name ? escapeHTML(transition.executed_by_name) : '';

    let action = '';
    if (transition.rolled_back_at) {
      const undoneOn = escapeHTML(
        formatDate(transition.rolled_back_at, this.app?.lang || 'fr', DATE_FORMAT)
      );
      action = `<p class="scout-year-rollback__done">
          ${translate('scout_year_rollback_done').replace('{date}', undoneOn)}
        </p>`;
    } else if (!this.canManage) {
      action = '';
    } else if (transition.can_rollback) {
      action = `
        <p class="section-description">${translate('scout_year_rollback_description')}</p>
        <button type="button"
                class="button button--danger"
                id="rollback-btn"
                data-transition-id="${transition.id}"
                ${this.isRollingBack ? 'disabled' : ''}>
          ${this.isRollingBack
    ? translate('scout_year_rollback_running')
    : translate('scout_year_rollback_button')}
        </button>`;
    } else {
      const reasons = (transition.rollback_blockers || [])
        .map(blocker => `<li>${escapeHTML(
          translate(`scout_year_rollback_blocker_${blocker.reason}`).replace('{count}', String(blocker.count))
        )}</li>`)
        .join('');
      action = `
        <p class="section-description">${translate('scout_year_rollback_blocked')}</p>
        ${reasons ? `<ul class="scout-year-rollback__blockers">${reasons}</ul>` : ''}`;
    }

    return `
      <section class="account-section scout-year-rollback">
        <h2>${translate('scout_year_rollback_title')}</h2>
        <p class="scout-year-headline"><strong>${from}</strong> → <strong>${to}</strong></p>
        <p class="muted-text">
          ${translate('scout_year_last_transition_meta').replace('{date}', when).replace('{who}', who)}
        </p>
        ${action}
      </section>`;
  }

  renderNavigation() {
    const isLast = this.step === LAST_WIZARD_STEP;
    const acceptAll = this.step === STEP_ROSTER
      ? `<button type="button" class="button button--ghost" id="accept-all-btn">
           ${translate('scout_year_accept_all')}
         </button>`
      : '';

    return `
      <div class="scout-year-nav">
        ${this.step > STEP_ROSTER
    ? `<button type="button" class="button button--ghost" id="prev-step-btn">← ${translate('back')}</button>`
    : '<span></span>'}
        <div class="scout-year-nav__right">
          ${acceptAll}
          <button type="button"
                  class="button button--primary"
                  id="next-step-btn"
                  ${this.isSubmitting ? 'disabled' : ''}>
            ${isLast
    ? (this.isSubmitting ? translate('scout_year_running') : translate('scout_year_execute'))
    : translate('next')}
          </button>
        </div>
      </div>`;
  }

  renderHistory() {
    if (!this.years.length) {
      return '';
    }

    const statusLabels = {
      active: 'scout_year_status_active',
      planning: 'scout_year_status_planning',
      closed: 'scout_year_status_closed'
    };

    const rows = this.years.map(year => {
      const isActive = year.status === 'active';
      // A closed year is counted by everyone who belonged to it, graduates
      // included — that is the number you came to the history for.
      const count = isActive
        ? (year.active_participants ?? 0)
        : (year.total_enrollments ?? year.active_participants ?? 0);
      return `
        <li class="scout-year-history__item ${isActive ? 'is-active' : ''}">
          <span class="scout-year-history__label">${escapeHTML(year.label)}</span>
          <span class="scout-year-history__meta">
            ${translate('scout_year_history_participants').replace('{count}', String(count))}
            · ${translate(statusLabels[year.status] || 'scout_year_status_closed')}
          </span>
        </li>`;
    }).join('');

    return `
      <section class="account-section">
        <h2>${translate('scout_year_history_title')}</h2>
        <p class="section-description">${translate('scout_year_history_description')}</p>
        <ul class="scout-year-history">${rows}</ul>
      </section>`;
  }

  // ------------------------------------------------------------------- events

  /**
   * Attach the delegated listeners, exactly once.
   *
   * `render()` only replaces the contents of `#app`, never the element itself,
   * so delegated listeners survive every re-render. Re-attaching them would
   * stack duplicates — BaseModule only removes listeners when the module is
   * destroyed — and each duplicate would run the handler again: a single click
   * on Next would advance a step *and* fire the next step's action, skipping
   * the confirmation screen entirely.
   */
  attachEventListeners() {
    const container = document.getElementById('app');
    if (!container || this._listenersAttached) {
      return;
    }
    this._listenersAttached = true;

    this.addEventListener(container, 'change', (event) => {
      const dispositionToggle = event.target.closest('.js-disposition-toggle');
      if (dispositionToggle) {
        this.handleDispositionToggle(dispositionToggle);
        return;
      }

      const membershipToggle = event.target.closest('.js-membership-toggle');
      if (membershipToggle) {
        this.handleMembershipToggle(membershipToggle);
      }
    });

    this.addEventListener(container, 'input', (event) => {
      const noteInput = event.target.closest('.js-exception-note');
      if (noteInput) {
        const id = parseInt(noteInput.dataset.participantId, 10);
        this.exceptionNotes.set(id, noteInput.value);
      }
    });

    this.addEventListener(container, 'click', (event) => {
      if (event.target.closest('#next-step-btn')) {
        this.handleNext();
      } else if (event.target.closest('#prev-step-btn')) {
        this.step -= 1;
        this.rerender();
      } else if (event.target.closest('#accept-all-btn')) {
        this.handleAcceptAll();
      } else if (event.target.closest('#alumni-invite-btn')) {
        this.handleAlumniInvitation();
      } else if (event.target.closest('.js-approve-reactivation')) {
        const approveButton = event.target.closest('.js-approve-reactivation');
        this.handleReactivationApproval(parseInt(approveButton.dataset.membershipId, 10));
      } else {
        const rollbackButton = event.target.closest('#rollback-btn');
        if (rollbackButton) {
          this.handleRollback(parseInt(rollbackButton.dataset.transitionId, 10));
        }
      }
    });
  }

  /**
   * Re-render the page.
   *
   * Listeners are delegated on `#app` and bound once, so there is nothing to
   * re-attach here.
   */
  rerender() {
    this.render();
  }

  handleDispositionToggle(input) {
    const id = parseInt(input.dataset.participantId, 10);
    this.dispositions.set(id, input.checked ? 'graduating' : 'returning');

    if (input.checked) {
      this.exceptionNotes.delete(id);
    }

    // The exception note field appears and disappears with the choice.
    this.rerender();
    const focusTarget = document.getElementById(`exception-note-${id}`)
      || document.getElementById(`disposition-${id}`);
    focusTarget?.focus();
  }

  handleMembershipToggle(input) {
    const id = parseInt(input.dataset.membershipId, 10);
    if (input.checked) {
      this.selectedMemberships.add(id);
    } else {
      this.selectedMemberships.delete(id);
    }
  }

  handleAcceptAll() {
    this.dispositions = new Map(this.proposedDispositions);
    this.exceptionNotes.clear();
    this.rerender();
  }

  async handleNext() {
    if (this.step === STEP_ROSTER) {
      const refreshed = await this.refreshConsequences();
      if (!refreshed) {
        // Advancing on a stale list could deactivate the parent of a child the
        // leader just decided to keep. Stay put until we have fresh figures.
        return;
      }
      this.step = STEP_CONSEQUENCES;
      this.rerender();
      return;
    }

    if (this.step === STEP_CONSEQUENCES) {
      this.step = STEP_CONFIRM;
      this.rerender();
      return;
    }

    await this.handleExecute();
  }

  /**
   * Recompute the affected parent accounts from the dispositions actually
   * chosen, so the second step never shows a stale list.
   *
   * @returns {Promise<boolean>} True when the list was refreshed
   */
  async refreshConsequences() {
    try {
      const refreshed = await getTransitionPreview(this.graduatingIds());
      this.preview.memberships_to_deactivate = refreshed.memberships_to_deactivate;
      this.preview.counts = refreshed.counts;
      this.selectedMemberships = new Set(
        refreshed.memberships_to_deactivate.map(m => m.membership_id)
      );
      return true;
    } catch (error) {
      debugError('Failed to refresh transition consequences:', error);
      this.app?.showMessage?.(translate('scout_year_refresh_failed'), 'error');
      return false;
    }
  }

  async handleExecute() {
    const confirmed = await confirmDialog({
      title: translate('scout_year_confirm_title'),
      message: translate('scout_year_confirm_message')
        .replace('{from}', this.preview.current_year.label)
        .replace('{to}', this.preview.next_year.label),
      confirmLabel: translate('scout_year_execute'),
      cancelLabel: translate('cancel')
    });

    if (!confirmed) {
      return;
    }

    this.isSubmitting = true;
    this.rerender();

    // Only the transition call itself may leave the wizard on the confirmation
    // step. The endpoint is not idempotent — running it twice would close the
    // year that was just opened and open yet another one — so anything that
    // happens after it commits must never look like a failure that invites a
    // retry.
    try {
      this.result = await executeTransition({
        graduating_participant_ids: this.graduatingIds(),
        deactivate_membership_ids: [...this.selectedMemberships],
        exceptions: this.exceptions().map(p => ({
          participant_id: p.id,
          note: this.exceptionNotes.get(p.id) || ''
        }))
      });
    } catch (error) {
      debugError('Transition failed:', error);
      this.app?.showMessage?.(error?.message || translate('scout_year_execute_failed'), 'error');
      this.isSubmitting = false;
      this.rerender();
      return;
    }

    debugLog('Transition executed', this.result.summary);
    this.step = STEP_REPORT;
    this.app?.showMessage?.(translate('scout_year_execute_success'), 'success');

    // The year history and the undo button are read from the server after the
    // fact; failing to refresh them must not cast doubt on a transition that
    // already went through.
    try {
      this.years = await getScoutYears({ forceRefresh: true });
      this.transitions = await getTransitions();
    } catch (error) {
      debugError('Failed to refresh the scout year history:', error);
    }

    this.isSubmitting = false;
    this.rerender();
  }

  /**
   * Undo the last transition.
   *
   * The server is the authority on whether this is still possible, so a refusal
   * is not an error to hide: reloading gives the leader the up-to-date reason.
   *
   * @param {number} transitionId - Transition to undo
   * @returns {Promise<void>}
   */
  async handleRollback(transitionId) {
    const transition = this.transitions.find(t => t.id === transitionId);
    if (!transition || this.isRollingBack) {
      return;
    }

    const confirmed = await confirmDialog({
      title: translate('scout_year_rollback_confirm_title'),
      message: translate('scout_year_rollback_confirm_message')
        .replace('{from}', transition.to_label || '')
        .replace('{to}', transition.from_label || ''),
      confirmLabel: translate('scout_year_rollback_button'),
      cancelLabel: translate('cancel')
    });

    if (!confirmed) {
      return;
    }

    this.isRollingBack = true;
    this.rerender();

    let succeeded = false;
    try {
      const restored = await rollbackTransition(transitionId);
      debugLog('Transition rolled back', restored.summary);
      succeeded = true;
    } catch (error) {
      debugError('Rollback failed:', error);
      this.app?.showMessage?.(error?.message || translate('scout_year_rollback_failed'), 'error');
    }

    // Either way the page is now showing a state that no longer exists: on
    // success the roster went back a year, on failure something was entered
    // that the blocker list should name.
    this.isRollingBack = false;
    this.step = STEP_ROSTER;
    this.result = null;

    try {
      await this.loadData();
      this.loadError = null;
    } catch (error) {
      debugError('Failed to reload after rollback:', error);
      this.loadError = error?.message || translate('scout_year_load_failed');
    }

    if (succeeded) {
      this.app?.showMessage?.(translate('scout_year_rollback_success'), 'success');
    }

    this.rerender();
  }

  /**
   * Reactivate a membership that was deactivated by mistake.
   *
   * @param {number} membershipId - Membership ID
   * @returns {Promise<void>}
   */
  async reactivateMembership(membershipId) {
    try {
      await setMembershipStatus(membershipId, 'active');
      this.app?.showMessage?.(translate('scout_year_membership_reactivated'), 'success');
      return true;
    } catch (error) {
      debugError('Failed to reactivate membership:', error);
      this.app?.showMessage?.(translate('scout_year_membership_failed'), 'error');
      return false;
    }
  }

  /**
   * Grant a pending request to come back.
   *
   * The server clears the request as part of restoring the membership, so a
   * successful approval is also what removes the row from this list.
   *
   * @param {number} membershipId - Membership ID
   * @returns {Promise<void>}
   */
  async handleReactivationApproval(membershipId) {
    const restored = await this.reactivateMembership(membershipId);
    if (!restored) {
      return;
    }

    this.reactivationRequests = this.reactivationRequests.filter(
      request => request.membership_id !== membershipId
    );
    this.rerender();
  }
}
