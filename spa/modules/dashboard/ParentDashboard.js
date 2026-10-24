import familyTasksStylesheetUrl from '../../../css/family-tasks.css?url';
import {
  getCurrentOrganizationId,
  getAuthHeader,
  fetchParticipants,
  getOrganizationFormFormats,
  getOrganizationSettings,
  getPublicOrganizationSettings,
  getParticipantStatement,
  linkUserParticipants,
  getCurrentUser,
} from '../../ajax-functions.js';
import {
  declinePermissionSlip,
  getPermissionSlips,
  signPermissionSlip,
} from '../../api/api-endpoints.js';
import { formTypeLabel } from '../../utils/FormLabelUtils.js';
import { loadHiddenParentDashboardButtons } from '../../config/parent-dashboard-buttons.js';
import {
  getFormsNeedingReview,
  confirmFormReview,
  getAuthorizationsPendingSignature,
} from '../../api/api-scout-years.js';
import { buildApiUrl } from '../../api/api-core.js';
import {
  debugLog,
  debugError,
  debugWarn,
} from '../../utils/DebugUtils.js';
import { translate, registerPushSubscription } from '../../app.js';
import { CONFIG } from '../../config.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { apiErrorMessage, apiErrorMessageKey } from '../../utils/ApiErrorUtils.js';
import { setContent, loadStylesheet } from '../../utils/DOMUtils.js';
import { openModal } from '../../utils/ModalUtils.js';
import { isAppInstalled, onInstallAvailabilityChange } from '../../utils/InstallPromptUtils.js';
import { offerAppInstall } from '../install/InstallAppDialog.js';
import { renderBackLink } from '../../utils/BackLinkUtils.js';
import { CarpoolQuickAccessModal } from '../modals/CarpoolQuickAccessModal.js';
import { isParent, hasPermission, canViewBadges, canApproveBadges, canViewReports, canViewActivities, canViewCarpools } from '../../utils/PermissionUtils.js';
import { getTodayISO, parseDate } from '../../utils/DateUtils.js';
import {
  confirm as confirmDialog,
  prompt as promptDialog,
} from '../../utils/DialogUtils.js';
import {
  ALL_CHILDREN,
  buildFamilyTasks,
  renderFamilyFilter,
  renderFamilyTaskList,
  taskChildNames,
} from './FamilyTasks.js';

// Safari cancels a download whose object URL is revoked in the same task as the click.
const CALENDAR_URL_REVOKE_DELAY_MS = 1000;

export class ParentDashboard {
  constructor(app) {
    this.app = app;
    this.participants = [];
    this.formStructures = {};
    this.formFormats = {};
    this.participantStatements = new Map();
    this.permissionSlips = new Map();
    this.permissionSlipHandlerBound = false;
    this.formsToReview = [];
    this.authorizationsToSign = [];
    this.hiddenButtons = new Set();
    this.participantsFailed = false;
    // Something the family tasks are built from did not load: say so, never "nothing to do".
    this.taskSourcesFailed = false;
    this.childFilter = ALL_CHILDREN;
    this.familyTasks = [];
    // Delegated listeners on #app, which outlives this screen: released in destroy().
    this.listeners = new AbortController();
    this.destroyed = false;
  }

  /** Before anything is loaded: the welcome heading and a polite "loading". */
  renderLoading() {
    setContent(document.getElementById('app'), `
      <section class="page parent-dashboard" aria-busy="true">
        ${isParent() ? '' : renderBackLink('/dashboard')}
        <h1 class="parent-dashboard__title">${translate('bienvenue')}</h1>
        <p role="status">${translate('loading')}</p>
      </section>
    `);
  }

  async init() {
    this.renderLoading();
    let hasErrors = false;
    this.participantsFailed = false;
    this.taskSourcesFailed = false;
    // Run one step; a failure (thrown or rejected) is logged and the page
    // still renders with what the other steps loaded.
    const attempt = (step, message) => Promise.resolve()
      .then(step)
      .catch((error) => {
        debugError(message, error);
        hasErrors = true;
      });

    // Only the statements and permission slips need the children; every
    // other request starts at once instead of one after another.
    const loadStatements = () => attempt(() => this.fetchParticipantStatements(), 'Error fetching participant statements:');
    const loadPermissionSlips = () => attempt(() => this.fetchPermissionSlips(), 'Error fetching permission slips:');
    // Children that did not load must not read as "no children": that list
    // says so with a retry, and its statements and slips are not asked for.
    const perChildReady = Promise.resolve()
      .then(() => this.fetchParticipants())
      .then(() => Promise.all([loadStatements(), loadPermissionSlips()]))
      .catch((error) => {
        debugError('Error fetching participants:', error);
        this.participantsFailed = true;
      });
    const formFormatsReady = attempt(() => this.fetchFormFormats(), 'Error fetching form formats:');
    const hiddenButtonsReady = loadHiddenParentDashboardButtons(this.app?.organizationSettings, getPublicOrganizationSettings);

    // The two reminder lists are independent: one failing must not hide
    // the other, and neither may hide the dashboard.
    const remindersReady = Promise.allSettled([
      getFormsNeedingReview(),
      getAuthorizationsPendingSignature(),
    ]);

    const [, , hiddenButtons, [reviewResult, signatureResult]] = await Promise.all([
      perChildReady,
      formFormatsReady,
      hiddenButtonsReady,
      remindersReady,
    ]);
    this.hiddenButtons = hiddenButtons;

    if (reviewResult.status === 'fulfilled') {
      this.formsToReview = reviewResult.value;
    } else {
      debugError('Error fetching forms to review:', reviewResult.reason);
      this.formsToReview = [];
      this.taskSourcesFailed = true;
    }

    if (signatureResult.status === 'fulfilled') {
      this.authorizationsToSign = signatureResult.value;
    } else {
      debugError(
        'Error fetching authorizations to sign:',
        signatureResult.reason,
      );
      this.authorizationsToSign = [];
      this.taskSourcesFailed = true;
    }

    await loadStylesheet(familyTasksStylesheetUrl);
    // #app outlives this screen: a late answer must not draw over the next one.
    if (this.destroyed) {
      return;
    }

    // Always render the page, even with partial data
    try {
      this.render();
      this.attachEventListeners();
      this.checkAndShowLinkParticipantsDialog();

      if (hasErrors) {
        this.app.showMessage(
          translate('error_loading_data'),
          'error',
        );
      }
    } catch (error) {
      debugError('Error rendering parent dashboard:', error);
      this.renderError();
    }
  }

  checkAndShowLinkParticipantsDialog() {
    const guardianParticipants = JSON.parse(
      localStorage.getItem('guardianParticipants'),
    );
    if (guardianParticipants && guardianParticipants.length > 0) {
      this.showLinkParticipantsDialog(guardianParticipants);
      localStorage.removeItem('guardianParticipants'); // Clear after showing
    }
  }

  showLinkParticipantsDialog(guardianParticipants) {
    const dialogContent = `
                                        <h2>${translate('link_existing_participants')}</h2>
                                        <p>${translate('existing_participants_found')}</p>
                                        <form id="link-participants-form">
                                                        ${guardianParticipants
    .map(
      (
        participant,
      ) => `
                                                                        <label>
                                                                                        <input type="checkbox" name="link_participants" value="${participant.participant_id}">
                                                                                        ${escapeHTML(participant.first_name)} ${escapeHTML(participant.last_name)}
                                                                        </label>
                                                        `,
    )
    .join('')}
                                                        <button type="submit">${translate('link_selected_participants')}</button>                                                       <button id="cancel" type="button">${translate('cancel')}</button>
                                        </form>
                        `;

    const dialog = document.createElement('div');
    setContent(dialog, dialogContent);
    dialog.style.cssText =
                        'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border: 1px solid black; z-index: 1000;';
    document.body.appendChild(dialog);

    document.querySelector('#cancel').addEventListener(
      'click',
      () => {
        dialog.remove();
      },
    );

    document.getElementById(
      'link-participants-form',
    ).addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const selectedParticipants =
                                formData.getAll('link_participants');

      try {
        const result = await linkUserParticipants({
          participant_ids: selectedParticipants,
        });
        if (result.success) {
          this.app.showMessage(
            translate(
              'participants_linked_successfully',
            ),
          );
          await this.fetchParticipants(); // Refresh the participants list
          this.render(); // Re-render the dashboard
        } else {
          this.app.showMessage(
            translate(
              'error_linking_participants',
            ),
            'error',
          );
        }
      } catch (error) {
        debugError(
          'Error linking participants:',
          error,
        );
        this.app.showMessage(
          translate('error_linking_participants'),
          'error',
        );
      }

      document.body.removeChild(dialog);
    });
  }

  async fetchParticipants() {
    try {
      // Only the account's own children, even for a leader who sees the whole unit elsewhere.
      const response = await fetchParticipants(
        getCurrentOrganizationId(), { includeMedication: true, ownChildren: true },
      );

      // Use a Map to store unique participants
      const uniqueParticipants = new Map();

      // Validate response is an array before processing
      if (Array.isArray(response)) {
        response.forEach((participant) => {
          // If this participant isn't in our Map yet, add them
          if (
            !uniqueParticipants.has(
              participant.id,
            )
          ) {
            uniqueParticipants.set(
              participant.id,
              participant,
            );
          }
        });
      }

      // Convert the Map values back to an array
      this.participants = Array.from(
        uniqueParticipants.values(),
      );

      debugLog('Fetched participants:', this.participants);
    } catch (error) {
      debugError('Error fetching participants:', error);
      this.participants = [];
      throw error;
    }
  }

  async fetchParticipantStatements() {
    if (
      !Array.isArray(this.participants) ||
                        this.participants.length === 0
    ) {
      return;
    }

    await Promise.all(
      this.participants.map(async (participant) =>
        this.loadSingleStatement(participant.id),
      ),
    );
  }

  async loadSingleStatement(participantId) {
    try {
      const response =
                                await getParticipantStatement(participantId);
      const payload = response?.data || response;
      const statementData = payload?.data || payload;

      if (statementData?.participant?.id) {
        this.participantStatements.set(
          statementData.participant.id,
          statementData,
        );
        return statementData;
      }
    } catch (error) {
      debugWarn(
        'Unable to load participant statement',
        error,
      );
      this.taskSourcesFailed = true;
    }

    return null;
  }

  async fetchPermissionSlips() {
    if (
      !Array.isArray(this.participants) ||
                        this.participants.length === 0
    ) {
      return;
    }

    await Promise.all(
      this.participants.map(async (participant) =>
        this.loadPermissionSlips(participant.id),
      ),
    );
  }

  async loadPermissionSlips(participantId, forceRefresh = false) {
    try {
      const response = await getPermissionSlips(
        { participant_id: participantId },
        { forceRefresh },
      );
      const slips =
                                response?.data?.permission_slips ||
                                response?.permission_slips ||
                                [];
      this.permissionSlips.set(participantId, slips);
      return slips;
    } catch (error) {
      debugError('Error loading permission slips', error);
      this.permissionSlips.set(participantId, []);
      this.taskSourcesFailed = true;
      return [];
    }
  }

  async fetchFormFormats() {
    try {
      // Request only participant-context forms (excludes organization_info, etc.)
      const result = await getOrganizationFormFormats(
        null,
        'participant',
        { includeMeta: true },
      );
      const response = result?.formats || null;
      this.formMeta = result?.meta || {};
      debugLog('Form formats response:', response);
      debugLog(
        'Form formats response type:',
        typeof response,
      );
      debugLog(
        'Form formats response keys:',
        response ? Object.keys(response) : 'null',
      );

      if (response && typeof response === 'object') {
        this.formFormats = response;
        debugLog(
          'Stored form formats:',
          this.formFormats,
        );
      } else {
        debugError(
          'Invalid form formats response:',
          response,
        );
        // The children still show, with the buttons that need no form.
        this.formFormats = {};
      }
    } catch (error) {
      debugError('Error fetching form formats:', error);
      this.formFormats = {};
      throw error;
    }
  }

  async fetchOrganizationInfo() {
    try {
      // Fetch all organization settings
      const response = await getOrganizationSettings();

      // Check if the response is successful and contains settings
      if (response && response.success && response.settings) {
        // Get the organization_info setting
        const organizationInfo =
                                        response.settings.organization_info;

        // If the setting exists, extract the name, otherwise set a default
        if (organizationInfo && organizationInfo.name) {
          this.organizationName =
                                                organizationInfo.name;
        } else {
          this.organizationName = translate(
            'organization_name_default',
          );
        }
      } else {
        debugError(
          'Invalid organization info response:',
          response,
        );
      }
    } catch (error) {
      debugError('Error fetching organization info:', error);
    }
  }

  async fetchUserFullName() {
    // If userFullName is not set, fetch it from the server
    if (!this.app.userFullName) {
      try {
        const result = await getCurrentUser();
        const fullName =
                                        result?.data?.full_name ||
                                        result?.full_name ||
                                        result?.data?.fullName ||
                                        result?.fullName;
        if (fullName) {
          this.app.userFullName = fullName;
        } else {
          debugError(
            'Failed to fetch user full name: missing full name',
            result,
          );
        }
      } catch (error) {
        debugError(
          'Error fetching user full name:',
          error,
        );
      }
    }
  }

  render() {
    const organizationName =
                        this.app.organizationSettings?.organization_info
                          ?.name || 'Scouts';
    const notificationButton = this.shouldShowNotificationButton()
      ? `<button id="enableNotifications" class="dashboard-button dashboard-button--secondary">
                                                ${translate('enable_notifications')}
                                        </button>`
      : ''; // Only render the button if needed

    // Offered until the app is installed: the browser's prompt when it has
    // one, else the steps for this browser, so a dismissed prompt is not final.
    const installButton = isAppInstalled()
      ? ''
      : `<button id="installPwaButton" type="button" class="dashboard-button dashboard-button--secondary">
                                                ${translate('install_app')}
                                        </button>`;

    const calendarDownloadAction = `
                        <div class="parent-dashboard__calendar-download" style="margin-top: 1rem;">
                                <p class="muted-text" style="margin-top: 0.5rem;">${translate('calendar_download_description')}</p>
                        </div>
                `;

    // Only show staff back link when accessed outside the parent context
    const backLink = isParent() ? '' : renderBackLink('/dashboard');

    // Parents who can register their own children go through the
    // short step that links the child to their family, then on to
    // the paperwork. It is the only path that guarantees the link.
    const managesOwnFamily = hasPermission('participants.create_own');
    const addChildHref = managesOwnFamily ? '/parent-onboarding' : '/formulaire-inscription';
    const familySharingLink = managesOwnFamily && !this.hiddenButtons.has('family_access')
      ? `<a href="/family-access" class="dashboard-button dashboard-button--secondary">${translate('family_access_title')}</a>`
      : '';
    // Where the family's children stand in the campaigns under way.
    // The unit-wide campaign screens stay behind fundraisers.view.
    const fundraisersLink = this.hiddenButtons.has('fundraisers')
      ? ''
      : `<a href="/parent-fundraisers" class="dashboard-button dashboard-button--secondary">${translate('parent_fundraisers_title')}</a>`;

    // Dynamically replace the title with the organization name
    const userName =
                        this.app.userFullName ||
                        localStorage.getItem('userFullName') ||
                        '';
    const content = `
                        <div class="parent-dashboard">
                                ${backLink}
                                <header class="parent-dashboard__header">
                                        <h1 class="parent-dashboard__title">${translate('bienvenue')}${userName ? ` ${escapeHTML(userName)}` : ''}</h1>
                                        <p class="parent-dashboard__subtitle">${escapeHTML(organizationName)}</p>
                                </header>

                                ${this.renderFamilySection()}

                                <section class="parent-dashboard__participants">
                                        <h2 class="${this.participants.length > 1 ? 'parent-dashboard__section-title' : 'visually-hidden'}">${translate('participants_list')}</h2>
                                        ${this.renderParticipantsList()}
                                </section>

                                <section class="parent-dashboard__actions">
                                        <h2 class="visually-hidden">${translate('main_actions')}</h2>
                                        <div class="parent-dashboard__actions-grid">
                                                ${this.hiddenButtons.has('finances') ? '' : `<a href="/parent-finance" class="dashboard-button dashboard-button--primary">
                                                        ${translate('my_finances')}
                                                </a>`}
                                                ${fundraisersLink}
                                                ${familySharingLink}
                                                <a href="/account-info" class="dashboard-button dashboard-button--secondary">
                                                        ${translate('account_settings')}
                                                </a>
                                                ${this.hiddenButtons.has('program_progress') ? '' : `<a href="/parent-program-progress" class="dashboard-button dashboard-button--secondary">
                                                        ${translate('program_progress_parent_link')}
                                                </a>`}
                                                ${canViewActivities() && !this.hiddenButtons.has('download_calendar') ? `<button id="downloadCalendarButton" type="button" class="dashboard-button dashboard-button--secondary">
                                                        ${translate('download_activities_calendar')}
                                                </button>` : ''}
                                        </div>
                                        ${canViewActivities() && !this.hiddenButtons.has('download_calendar') ? calendarDownloadAction : ''}
                                        ${this.renderCarpoolButton()}
                                </section>

                                <footer class="parent-dashboard__footer">
                                        <div class="parent-dashboard__footer-actions">
                                                ${notificationButton}
                                                ${installButton}
                                        </div>
                                        <div class="parent-dashboard__footer-account">
                                                <a href="${addChildHref}" class="dashboard-button dashboard-button--primary">
                                                        ${translate('ajouter_participant')}
                                                </a>
                                                <a href="/logout" class="dashboard-button dashboard-button--logout">
                                                        ${translate('deconnexion')}
                                                </a>
                                        </div>
                                </footer>
                        </div>
                `;
    setContent(document.getElementById('app'), content);
    this.applyChildFilter();
    this.bindStatementHandlers();
    this.bindPermissionSlipHandlers();
    this.bindFamilyTaskHandlers();
  }

  /**
   * What the family tasks are built from, as loaded.
   *
   * @returns {Object} Data for buildFamilyTasks
   */
  familyTaskData() {
    return {
      participants: this.participantsFailed ? [] : this.participants,
      permissionSlips: this.permissionSlips,
      formFormats: this.formFormats,
      formMeta: this.formMeta,
      formsToReview: this.formsToReview,
      authorizationsToSign: this.authorizationsToSign,
      statements: this.participantStatements,
      today: getTodayISO(),
    };
  }

  /**
   * The filter and task list, for the current filter.
   *
   * @returns {string} Markup
   */
  renderFamilyContent() {
    const data = this.familyTaskData();
    const known = data.participants.some((child) => String(child.id) === String(this.childFilter));
    if (!known) {
      this.childFilter = ALL_CHILDREN;
    }
    this.familyTasks = buildFamilyTasks(data, this.childFilter);
    const counts = new Map(data.participants.map((child) => [
      Number(child.id),
      buildFamilyTasks(data, Number(child.id)).length,
    ]));
    if (this.participantsFailed) {
      return `<p class="family-tasks__empty">${translate('family_tasks_children_failed')}</p>`;
    }
    return `
      ${renderFamilyFilter(data.participants, this.childFilter, counts)}
      ${renderFamilyTaskList(this.familyTasks, {
    lang: this.app?.language || CONFIG.DEFAULT_LANG || 'en',
    formatDate: (value) => this.formatDateSafe(value),
    formatMoney: (amount) => this.formatCurrency(amount),
    financeHidden: this.hiddenButtons.has('finances'),
    incomplete: this.taskSourcesFailed,
  })}`;
  }

  /**
   * "To do for your family": one task per thing to do, naming the children
   * it concerns, with a filter for one child when there are several.
   *
   * @returns {string} Markup
   */
  renderFamilySection() {
    return `
      <section class="parent-dashboard__family-tasks family-tasks" aria-labelledby="family-tasks-title">
        <h2 class="family-tasks__title" id="family-tasks-title" tabindex="-1">${translate('family_tasks_title')}</h2>
        <div id="family-tasks-content">${this.renderFamilyContent()}</div>
      </section>`;
  }

  /**
   * Redraw the tasks after a filter change or an answer, keeping focus on
   * the control that was used, or on the section's heading once it is gone.
   */
  refreshFamilyView() {
    const container = document.getElementById('family-tasks-content');
    if (!container || this.destroyed) {
      return;
    }
    const active = document.activeElement;
    const focusedFilter = container.contains(active) ? active?.dataset?.familyFilter : undefined;
    const hadFocus = container.contains(active);
    setContent(container, this.renderFamilyContent());
    this.applyChildFilter();
    if (focusedFilter !== undefined) {
      [...container.querySelectorAll('[data-family-filter]')]
        .find((option) => option.dataset.familyFilter === focusedFilter)?.focus();
    } else if (hadFocus) {
      document.getElementById('family-tasks-title')?.focus();
    }
  }

  /**
   * Show every child's file, or only the chosen child's, opened.
   */
  applyChildFilter() {
    const single = this.participants.length === 1;
    document.querySelectorAll('[data-child-card]').forEach((card) => {
      const chosen = this.childFilter !== ALL_CHILDREN && card.dataset.childCard === String(this.childFilter);
      // eslint-disable-next-line no-param-reassign -- toggling the card's own state
      card.hidden = this.childFilter !== ALL_CHILDREN && !chosen;
      const details = card.querySelector('details');
      if (details && (chosen || single)) {
        details.open = true;
      }
    });
  }

  /**
   * One listener for the tasks' controls, released when the screen goes:
   * #app outlives this screen.
   */
  bindFamilyTaskHandlers() {
    if (this.familyTaskHandlerBound) {
      return;
    }
    const appContainer = document.getElementById('app');
    if (!appContainer) {
      return;
    }
    this.familyTaskHandlerBound = true;
    appContainer.addEventListener('click', (event) => {
      const filter = event.target.closest('[data-family-filter]');
      if (filter) {
        this.childFilter = filter.dataset.familyFilter === ALL_CHILDREN
          ? ALL_CHILDREN
          : Number(filter.dataset.familyFilter);
        this.refreshFamilyView();
        return;
      }
      const respond = event.target.closest('.js-family-sign, .js-family-decline');
      if (respond) {
        this.respondToEvent(respond.dataset.taskKey, respond.classList.contains('js-family-decline'));
        return;
      }
      const review = event.target.closest('.js-confirm-review');
      if (review) {
        this.handleConfirmReview(review);
        return;
      }
      const statement = event.target.closest('.js-family-statement');
      if (statement) {
        this.showStatementModal(statement.dataset.participantId);
        return;
      }
      if (event.target.closest('#family-tasks-retry')) {
        this.init();
      }
    }, { signal: this.listeners.signal });
  }

  /**
   * Sign or decline an event's permission slips for every child the task
   * names, with one signer name. Each child's own file still answers one slip.
   *
   * @param {string} taskKey - The task's key
   * @param {boolean} isDecline - Decline rather than sign
   * @returns {Promise<void>}
   */
  async respondToEvent(taskKey, isDecline) {
    const task = this.familyTasks.find((candidate) => candidate.key === taskKey);
    if (!task || this.responding) {
      return;
    }
    const lang = this.app?.language || CONFIG.DEFAULT_LANG || 'en';
    const children = taskChildNames(task, lang);
    const title = task.title || translate('permission_slip_section_title');
    const signerName = (await promptDialog({
      title: translate(isDecline ? 'family_tasks_decline_title' : 'family_tasks_sign_title').replace('{activity}', title),
      message: translate('family_tasks_signer_prompt').replace('{children}', children),
    }))?.trim();
    if (!signerName) {
      return;
    }
    if (isDecline && !(await confirmDialog({
      message: translate('family_tasks_decline_confirm').replace('{children}', children),
      danger: true,
    }))) {
      return;
    }

    this.responding = true;
    [...document.querySelectorAll('.family-task')]
      .filter((item) => item.dataset.taskKey === taskKey)
      .flatMap((item) => [...item.querySelectorAll('button')])
      .forEach((button) => {
        // eslint-disable-next-line no-param-reassign -- busy while the answers are sent
        button.disabled = true;
      });
    const results = await Promise.allSettled(task.rows.map((row) => (isDecline
      ? declinePermissionSlip(row.slipId, { declined_by: signerName })
      : signPermissionSlip(row.slipId, { signed_by: signerName, signature_hash: `signed-${Date.now()}` }))));
    this.responding = false;

    const failedRows = task.rows.filter((_row, index) => results[index].status === 'rejected');
    const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
    failures.forEach((failure) => debugError('Error responding to permission slip', failure));
    const queued = results.some((result) => result.status === 'fulfilled' && result.value?.queued);

    if (!failures.length) {
      this.app.showMessage(
        translate(queued ? 'family_tasks_response_queued' : (isDecline ? 'permission_slip_declined' : 'permission_slip_signed')),
        queued ? 'info' : 'success',
      );
    } else if (failures.every((failure) => apiErrorMessageKey(failure) === 'api_error_conflict')) {
      this.app.showMessage(translate('permission_slip_already_answered'), 'warning');
    } else if (failedRows.length < task.rows.length) {
      const failedNames = taskChildNames({ rows: failedRows }, lang);
      this.app.showMessage(translate('family_tasks_partial_failure').replace('{children}', failedNames), 'error');
    } else {
      this.app.showMessage(apiErrorMessage(failures[0], 'error_saving'), 'error');
    }

    const childIds = [...new Set(task.rows.map((row) => row.participantId))];
    await Promise.all(childIds.map((participantId) => this.loadPermissionSlips(participantId, true)));
    if (this.destroyed) {
      return;
    }
    childIds.forEach((participantId) => this.refreshPermissionSlipSection(participantId));
    this.refreshFamilyView();
  }

  /**
         * Record that a form was re-read and found still accurate.
         *
         * @param {HTMLElement} button - The button that was pressed
         * @returns {Promise<void>}
         */
  async handleConfirmReview(button) {
    const submissionId = Number(button.dataset.submissionId);
    if (!Number.isInteger(submissionId) || submissionId < 1) {
      return;
    }

    button.disabled = true;

    try {
      await confirmFormReview(submissionId);
      this.formsToReview = this.formsToReview.filter(
        (form) => Number(form.id) !== submissionId,
      );
      this.app.showMessage(
        translate('form_review_confirmed'),
        'success',
      );
      this.refreshFamilyView();
    } catch (error) {
      debugError('Failed to confirm form review:', error);
      button.disabled = false;
      this.app.showMessage(
        apiErrorMessage(error, 'form_review_failed'),
        'error',
      );
    }
  }

  renderCarpoolButton() {
    // Show a carpooling link for parents to coordinate rides; it
    // lists the unit's activities, then opens their carpools.
    if (!canViewActivities() || !canViewCarpools() || this.hiddenButtons.has('carpool')) {
      return '';
    }
    return `
                        <div class="parent-dashboard__carpool-section" style="margin-top: 1.5rem;">
                                <a href="#" id="view-carpool-activities" class="dashboard-button dashboard-button--secondary" style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <rect x="1" y="3" width="15" height="13"></rect>
                                                <path d="M16 8h2"></path>
                                                <circle cx="18.5" cy="15.5" r="2.5"></circle>
                                                <circle cx="5.5" cy="15.5" r="2.5"></circle>
                                        </svg>
                                        ${translate('carpool_coordination')}
                                </a>
                        </div>
                `;
  }

  formatCurrency(amount = 0) {
    const numericValue = Number.parseFloat(amount);
    if (!Number.isFinite(numericValue)) {
      return this.formatCurrency(0);
    }

    const locale =
                        this.app?.language || CONFIG.DEFAULT_LANG || 'en';
    const currency = CONFIG.DEFAULT_CURRENCY || 'USD';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(numericValue);
  }

  renderStatementLink(participant) {
    const statement = this.participantStatements.get(
      participant.id,
    );
    const outstanding = statement?.totals?.total_outstanding ?? 0;

    if (!statement || outstanding <= 0) {
      return '';
    }

    return `
                        <button type="button" class="participant-card__statement" data-participant-id="${participant.id}">
                                <span class="participant-card__statement-label">${translate('view_statement')}</span>
                                <span class="participant-card__statement-amount">
                                        ${translate('amount_due')}: ${this.formatCurrency(outstanding)}
                                </span>
                        </button>
                `;
  }

  // Check notification permission and decide whether to show the button
  shouldShowNotificationButton() {
    if ('Notification' in window) {
      return (
        Notification.permission === 'default' ||
                                Notification.permission === 'denied'
      );
    }
    return false;
  }

  renderParticipantsList() {
    if (this.participantsFailed) {
      return `
        <p class="status-message error" role="alert">${translate('error_loading_parent_dashboard')}</p>
        <button type="button" class="button button--secondary" id="parent-dashboard-retry">${translate('retry')}</button>
      `;
    }
    if (
      !Array.isArray(this.participants) ||
                        this.participants.length === 0
    ) {
      return `<p class="parent-dashboard__empty">${translate('no_participants')}</p>`;
    }

    return this.participants
      .map((participant) => {
        const participantName = escapeHTML(
          `${participant.first_name} ${participant.last_name}`,
        );
        const statementLink =
                                        this.renderStatementLink(participant);

        // The full file opens on demand: the family tasks above carry what is due.
        return `
                        <article class="participant-card" data-child-card="${Number(participant.id)}">
                                <header class="participant-card__header">
                                        <h3 class="participant-card__name">${participantName}</h3>
                                        <a href="/formulaire-inscription/${participant.id}" class="participant-card__edit-btn">
                                                ${translate('modifier')}<span class="visually-hidden"> — ${participantName}</span>
                                        </a>
                                </header>
                                <details class="participant-card__details">
                                        <summary class="participant-card__summary">
                                                ${translate('family_child_file_show')}<span class="visually-hidden"> — ${participantName}</span>
                                        </summary>
                                        <div class="participant-card__body">
                                                <div class="participant-card__forms">
                                                        ${this.renderFormButtons(participant)}
                                                </div>
                                                ${statementLink ? `<div class="participant-card__section">${statementLink}</div>` : ''}
                                                ${this.renderPermissionSlipSection(participant)}
                                        </div>
                                </details>
                        </article>
                `;
      })
      .join('');
  }

  renderFormButtons(participant) {
    debugLog(
      'renderFormButtons called for participant:',
      participant.id,
    );
    debugLog('this.formFormats:', this.formFormats);
    debugLog('Form format keys:', Object.keys(this.formFormats));

    // The backend now filters forms based on user permissions
    // We no longer need to hardcode exclusions here
    const formButtons = Object.keys(this.formFormats)
      .map((formType) => {
        const formLabel = formTypeLabel(
          formType,
          this.formMeta?.[formType]?.display_name
        );
        const isCompleted =
                                        participant[`has_${formType}`] === 1 ||
                                        participant[`has_${formType}`] === true;
        const statusClass = isCompleted
          ? 'form-btn--completed'
          : 'form-btn--incomplete';
        const statusIcon = isCompleted ? '✅' : '❌';

        debugLog(
          `Rendering form button for: ${formType}, label: ${formLabel}`,
        );

        return `
                <a href="/dynamic-form/${formType}/${participant.id}" class="form-btn ${statusClass}">
                    <span class="form-btn__icon">${statusIcon}</span>
                    <span class="form-btn__label">${formLabel}</span>
                </a>
            `;
      })
      .join('');

    // Badges and reports are unit-wide pages: offering them to an
    // account that cannot open them only leads to a refusal.
    const badgeButton = (canViewBadges() || canApproveBadges()) && !this.hiddenButtons.has('request_badge') ? `
                <a href="/badge-form/${participant.id}" class="form-btn form-btn--badge">
                        <span class="form-btn__icon">🏅</span>
                        <span class="form-btn__label">${translate('manage_badge_progress')}</span>
                </a>
        ` : '';

    const progressReportButton = canViewReports() && !this.hiddenButtons.has('progress_report') ? `
                <a href="/reports?participantId=${participant.id}" class="form-btn form-btn--badge">
                        <span class="form-btn__icon">📊</span>
                        <span class="form-btn__label">${translate('view_progress_report')}</span>
                </a>
        ` : '';

    const programProgressButton = !this.hiddenButtons.has('program_progress') ? `
                <a href="/parent-program-progress" class="form-btn form-btn--badge">
                        <span class="form-btn__icon">🧭</span>
                        <span class="form-btn__label">${translate('program_progress_parent_link')}</span>
                </a>
        ` : '';

    // Offered when the health form declares a medication, or a plan is already under way.
    const medicationButton = (participant.declares_medication === true || participant.has_planned_medication === true) && !this.hiddenButtons.has('medications') ? `
                <a href="/medication-planning/${participant.id}" class="form-btn form-btn--badge">
                        <span class="form-btn__icon">💊</span>
                        <span class="form-btn__label">${translate('manage_medications')}</span>
                </a>
        ` : '';

    debugLog(
      `Total form buttons HTML length: ${formButtons.length}, with badge, progress, and medications: ${(formButtons + badgeButton + progressReportButton + programProgressButton + medicationButton).length}`,
    );

    return (
      formButtons +
                        badgeButton +
                        progressReportButton +
                        programProgressButton +
                        medicationButton
    );
  }

  renderPermissionSlipSection(participant) {
    return `
                        <div class="participant-card__section">
                                <div class="participant-card__section-header">
                                        <h4>${translate('permission_slip_section_title')}</h4>
                                        <p class="muted-text">${translate('permission_slip_parent_hint')}</p>
                                </div>
                                <div class="permission-slip-section" data-permission-slips-for="${participant.id}">
                                        ${this.renderPermissionSlipItems(participant.id)}
                                </div>
                        </div>
                `;
  }

  renderPermissionSlipItems(participantId) {
    const slips = this.permissionSlips.get(participantId) || [];

    if (!Array.isArray(slips) || slips.length === 0) {
      return `<p class="muted-text">${translate('no_permission_slips')}</p>`;
    }

    return `
                        <ul class="permission-slip-list">
                                ${slips
    .map((slip) => {
      const statusLabel = escapeHTML(
        this.getPermissionSlipStatusLabel(
          slip.status,
        ),
      );
      const meetingLabel = escapeHTML(
        this.formatDateSafe(
          slip.meeting_date,
        ),
      );
      const signedDate =
                                                        slip.signed_at
                                                          ? escapeHTML(
                                                            this.formatDateSafe(
                                                              slip.signed_at,
                                                            ),
                                                          )
                                                          : '';
      const signer = slip.signed_by
        ? escapeHTML(
          slip.signed_by,
        )
        : '';
      const declinedDate =
                                                        slip.declined_at
                                                          ? escapeHTML(
                                                            this.formatDateSafe(
                                                              slip.declined_at,
                                                            ),
                                                          )
                                                          : '';
      const declinedBy =
                                                        slip.declined_by
                                                          ? escapeHTML(
                                                            slip.declined_by,
                                                          )
                                                          : '';
      const canSign =
                                                        slip.status ===
                                                        'pending';

      const signedMeta =
                                                        signedDate || signer
                                                          ? `<p class="muted-text">${[signedDate ? `${translate('permission_slip_signed_at')}: ${signedDate}` : '', signer ? `${translate('permission_slip_signer')}: ${signer}` : ''].filter(Boolean).join(' · ')}</p>`
                                                          : declinedDate || declinedBy
                                                            ? `<p class="muted-text">${[declinedDate ? `${translate('permission_slip_declined_at')}: ${declinedDate}` : '', declinedBy ? `${translate('permission_slip_declined_by')}: ${declinedBy}` : ''].filter(Boolean).join(' · ')}</p>`
                                                            : '';

      const actionArea = canSign
        ? `<button type="button" class="dashboard-button dashboard-button--secondary permission-slip-sign-btn" data-slip-id="${slip.id}" data-participant-id="${participantId}">${translate('permission_slip_sign')}</button>
                                                           <button type="button" class="dashboard-button dashboard-button--danger permission-slip-decline-btn" data-slip-id="${slip.id}" data-participant-id="${participantId}">${translate('permission_slip_decline')}</button>`
        : `<span class="status-badge status-${escapeHTML(slip.status)}">${statusLabel}</span>`;

      return `
                                                <li class="permission-slip-item">
                                                        <div>
                                                                <p class="permission-slip-meeting">${translate('meeting_date_label')}: ${meetingLabel}</p>
                                                                <p class="permission-slip-status">${translate('status')}: ${statusLabel}</p>
                                                                ${signedMeta}
                                                        </div>
                                                        <div class="permission-slip-actions">${actionArea}</div>
                                                </li>
                                        `;
    })
    .join('')}
                        </ul>
                `;
  }

  refreshPermissionSlipSection(participantId) {
    const container = document.querySelector(
      `[data-permission-slips-for="${participantId}"]`,
    );
    if (!container) {
      return;
    }

    setContent(
      container,
      this.renderPermissionSlipItems(participantId),
    );
  }

  getPermissionSlipStatusLabel(status) {
    if (!status) {
      return translate('unknown');
    }

    const localized = translate(`permission_slip_status_${status}`);
    return localized === `permission_slip_status_${status}`
      ? status
      : localized;
  }

  formatDateSafe(dateString) {
    if (!dateString) {
      return translate('meeting_date_label');
    }

    const parsed = parseDate(dateString);
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return translate('meeting_date_label');
    }

    const locale =
                        this.app?.currentLanguage ||
                        this.app?.language ||
                        CONFIG.DEFAULT_LANG ||
                        'en';
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(parsed);
  }

  attachEventListeners() {
    document.getElementById('parent-dashboard-retry')?.addEventListener('click', () => this.init());

    const notificationButton = document.getElementById(
      'enableNotifications',
    );
    if (notificationButton) {
      notificationButton.addEventListener(
        'click',
        async () => {
          await this.requestNotificationPermission();
        },
      );
    }

    // Carpool activities button
    const carpoolButton = document.getElementById(
      'view-carpool-activities',
    );
    if (carpoolButton) {
      carpoolButton.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.showCarpoolActivitiesModal();
      });
    }

    const downloadCalendarButton = document.getElementById(
      'downloadCalendarButton',
    );
    if (downloadCalendarButton) {
      downloadCalendarButton.addEventListener(
        'click',
        async () => {
          await this.handleCalendarDownload();
        },
      );
    }

    document.getElementById('installPwaButton')?.addEventListener('click', async () => {
      const outcome = await offerAppInstall();
      debugLog('Install offer:', outcome);
    });

    // One subscription per screen: re-rendering replaces it, never stacks it.
    this.stopInstallWatch?.();
    this.stopInstallWatch = onInstallAvailabilityChange(({ installed }) => {
      if (!installed || this.destroyed) {
        return;
      }
      // Removed, not hidden: `.dashboard-button { display: flex }` outranks
      // the browser's [hidden] rule. Focus on it moves to the next action.
      const button = document.getElementById('installPwaButton');
      if (button) {
        const hadFocus = document.activeElement === button;
        button.remove();
        if (hadFocus) {
          document.querySelector('.parent-dashboard__footer a, .parent-dashboard__footer button')?.focus();
        }
      }
      this.app.showMessage(translate('install_app_installed'), 'success');
    });
  }

  /**
         * Called by the router before navigating away.
         */
  destroy() {
    this.destroyed = true;
    this.listeners.abort();
    this.stopInstallWatch?.();
    this.stopInstallWatch = null;
  }

  async handleCalendarDownload() {
    this.app.showMessage(
      translate('calendar_download_loading'),
      'info',
    );

    try {
      const response = await fetch(
        buildApiUrl('v1/activities/calendar.ics'),
        {
          method: 'GET',
          headers: {
            ...getAuthHeader(),
            Accept: 'text/calendar',
          },
        },
      );

      if (!response.ok) {
        throw new Error(
          `Calendar download failed with status ${response.status}`,
        );
      }

      const calendarText = await response.text();
      const calendarBlob = new Blob([calendarText], {
        type: 'text/calendar;charset=utf-8',
      });
      const downloadUrl = URL.createObjectURL(calendarBlob);
      const downloadLink = document.createElement('a');

      downloadLink.href = downloadUrl;
      downloadLink.download = 'activities-calendar.ics';
      downloadLink.style.display = 'none';

      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), CALENDAR_URL_REVOKE_DELAY_MS);

      debugLog(
        'Parent dashboard calendar downloaded successfully',
      );
      this.app.showMessage(
        translate('calendar_download_success'),
        'success',
      );
    } catch (error) {
      debugError(
        'Error downloading parent dashboard calendar:',
        error,
      );
      this.app.showMessage(
        translate('calendar_download_error'),
        'error',
      );
    }
  }

  bindStatementHandlers() {
    const statementButtons = document.querySelectorAll(
      '.participant-card__statement',
    );

    statementButtons.forEach((button) => {
      button.addEventListener('click', async (event) => {
        const participantId =
                                        event.currentTarget?.dataset
                                          ?.participantId;
        await this.showStatementModal(participantId);
      });
    });
  }

  bindPermissionSlipHandlers() {
    if (this.permissionSlipHandlerBound) {
      return;
    }

    const appContainer = document.getElementById('app');
    if (!appContainer) {
      return;
    }

    appContainer.addEventListener('click', async (event) => {
      const button = event.target.closest(
        '.permission-slip-sign-btn, .permission-slip-decline-btn',
      );
      if (!button) {
        return;
      }

      const slipId = Number.parseInt(
        button.dataset?.slipId,
        10,
      );
      const participantId = Number.parseInt(
        button.dataset?.participantId,
        10,
      );

      if (!slipId || !participantId) {
        return;
      }

      const signerName = (await promptDialog({
        title: translate('permission_slip_signer'),
        message: translate('permission_slip_signer'),
      }))?.trim();
      if (!signerName) {
        return;
      }

      const isDecline = button.classList.contains(
        'permission-slip-decline-btn',
      );
      if (
        isDecline &&
                                !(await confirmDialog(
                                  translate(
                                    'permission_slip_decline_confirm',
                                  ),
                                ))
      ) {
        return;
      }

      try {
        if (isDecline) {
          await declinePermissionSlip(slipId, {
            declined_by: signerName,
          });
        } else {
          await signPermissionSlip(slipId, {
            signed_by: signerName,
            signature_hash: `signed-${Date.now()}`,
          });
        }
        this.app.showMessage(
          translate(
            isDecline
              ? 'permission_slip_declined'
              : 'permission_slip_signed',
          ),
          'success',
        );
        await this.loadPermissionSlips(
          participantId,
          true,
        );
        this.refreshPermissionSlipSection(
          participantId,
        );
      } catch (error) {
        debugError(
          'Error responding to permission slip',
          error,
        );

        const errorMessage = error?.message || '';
        if (
          apiErrorMessageKey(error) === 'api_error_conflict' ||
                                        errorMessage.includes('already been answered')
        ) {
          this.app.showMessage(
            translate('permission_slip_already_answered'),
            'warning',
          );
          // Refresh the section to show current state
          await this.loadPermissionSlips(participantId, true);
          this.refreshPermissionSlipSection(participantId);
        } else if (
          errorMessage.includes(
            'only respond to permission slips for your own children',
          )
        ) {
          this.app.showMessage(
            translate('permission_slip_not_your_child'),
            'error',
          );
        } else {
          // The server's message is English; explain in the page's language.
          this.app.showMessage(
            apiErrorMessage(error, 'error_saving'),
            'error',
          );
        }
      }
      this.refreshFamilyView();
    }, { signal: this.listeners.signal });

    this.permissionSlipHandlerBound = true;
  }

  async showStatementModal(participantId) {
    if (!participantId) {return;}

    const numericId = Number.parseInt(participantId, 10);
    const existingStatement =
                        this.participantStatements.get(numericId) ||
                        (await this.loadSingleStatement(numericId));

    if (!existingStatement) {
      this.app.showMessage(
        translate('statement_unavailable'),
        'error',
      );
      return;
    }

    const totals = existingStatement.totals || {
      total_billed: 0,
      total_paid: 0,
      total_outstanding: 0,
    };
    const feeLines =
                        Array.isArray(existingStatement.fees) &&
                        existingStatement.fees.length > 0
                          ? existingStatement.fees
                            .map((fee) => {
                              const yearRange =
                                                          fee.year_start &&
                                                          fee.year_end
                                                            ? `${fee.year_start} – ${fee.year_end}`
                                                            : translate(
                                                              'membership_period',
                                                            );
                              const safeStatus = escapeHTML(
                                fee.status ||
                                                                  translate(
                                                                    'status',
                                                                  ),
                              );

                              return `
                                        <div class="statement-line">
                                                <div>
                                                        <p class="muted-text">${translate('membership_period')}: ${escapeHTML(yearRange)}</p>
                                                        <p>${translate('status')}: ${safeStatus}</p>
                                                </div>
                                                <div class="statement-amounts">
                                                        <span>${translate('total_billed')}: ${this.formatCurrency(fee.total_amount)}</span>
                                                        <span>${translate('payments_to_date')}: ${this.formatCurrency(fee.total_paid)}</span>
                                                        <span class="${fee.outstanding > 0 ? 'text-warning' : 'text-success'}">${translate('amount_due')}: ${this.formatCurrency(fee.outstanding)}</span>
                                                </div>
                                        </div>
                                `;
                            })
                            .join('')
                          : `<p class="muted-text">${translate('no_financial_activity')}</p>`;

    const participantName = escapeHTML(
      `${existingStatement.participant.first_name} ${existingStatement.participant.last_name}`,
    );

    openModal({
      id: 'statement-modal',
      title: `${translate('membership_statement_title')} — ${participantName}`,
      body: `
                                <div class="statement-summary">
                                        <div>
                                                <span>${translate('total_billed')}</span>
                                                <strong>${this.formatCurrency(totals.total_billed)}</strong>
                                        </div>
                                        <div>
                                                <span>${translate('payments_to_date')}</span>
                                                <strong>${this.formatCurrency(totals.total_paid)}</strong>
                                        </div>
                                        <div>
                                                <span>${translate('amount_due')}</span>
                                                <strong>${this.formatCurrency(totals.total_outstanding)}</strong>
                                        </div>
                                </div>
                                <div class="statement-lines">${feeLines}</div>
                        `,
      initialFocus: false,
    });
  }

  /**
         * Pick an upcoming activity to open its carpool page. Parents share
         * the leaders' dialog, without its "create an activity" action.
         */
  async showCarpoolActivitiesModal() {
    await new CarpoolQuickAccessModal(this.app, { allowCreate: false }).show();
  }

  async requestNotificationPermission() {
    if ('Notification' in window) {
      // Proceed with Notification logic
      if (Notification.permission === 'granted') {
        registerPushSubscription();
      } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(
          (permission) => {
            if (permission === 'granted') {
              registerPushSubscription();
            }
          },
        );
      }
    } else {
      debugError(
        'This browser does not support notifications.',
      );
    }
  }

  renderError() {
    setContent(document.getElementById('app'), `
      <section class="page parent-dashboard">
        <h1>${translate('error')}</h1>
        <p class="status-message error" role="alert">${translate('error_loading_parent_dashboard')}</p>
        <button type="button" class="button button--primary" id="parent-dashboard-retry">${translate('retry')}</button>
      </section>
    `);
    document.getElementById('parent-dashboard-retry')?.addEventListener('click', () => this.init());
  }
}
