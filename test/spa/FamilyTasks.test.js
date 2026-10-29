/**
 * @jest-environment jsdom
 *
 * "To do for your family" on the parent dashboard.
 *
 * A family of several children used to scroll through each child's card to
 * find one permission slip or form. The tasks now come first, one per thing to
 * do, naming the children it concerns; a filter narrows them to one child, and
 * each child's full file opens on demand.
 */

import axe from 'axe-core';

jest.mock('../../spa/ajax-functions.js', () => ({
  getPublicOrganizationSettings: jest.fn(() => Promise.resolve({ success: true, data: {} })),
  fetchParticipants: jest.fn(() => Promise.resolve([])),
  getCurrentOrganizationId: jest.fn(() => 7),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  declinePermissionSlip: jest.fn(),
  getPermissionSlips: jest.fn(),
  signPermissionSlip: jest.fn(),
}));
jest.mock('../../spa/api/api-activities.js', () => ({ getActivities: jest.fn() }));
jest.mock('../../spa/api/api-scout-years.js', () => ({
  getFormsNeedingReview: jest.fn(() => Promise.resolve([])),
  getAuthorizationsPendingSignature: jest.fn(() => Promise.resolve([])),
  confirmFormReview: jest.fn(() => Promise.resolve({})),
}));
jest.mock('../../spa/api/api-core.js', () => ({ buildApiUrl: (path) => path }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));
// Keys holding a placeholder keep it, so the names they carry can be read.
const mockTemplates = {
  family_tasks_concerns: 'For: {children}',
  family_filter_child: '{name} ({count})',
  family_tasks_deadline: 'Answer by {date}',
};
jest.mock('../../spa/app.js', () => ({
  translate: (key) => mockTemplates[key] || key,
  registerPushSubscription: jest.fn(),
}));
jest.mock('../../spa/functions.js', () => ({}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'en', DEFAULT_CURRENCY: 'CAD' } }));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DOMUtils.js'),
  loadStylesheet: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  ...jest.requireActual('../../spa/utils/DateUtils.js'),
  getTodayISO: () => '2026-10-24',
}));
jest.mock('../../spa/utils/FormLabelUtils.js', () => ({ formTypeLabel: (type, name) => name || type }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(),
  prompt: jest.fn(),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  isParent: () => true,
  hasPermission: () => false,
  canViewBadges: () => false,
  canApproveBadges: () => false,
  canViewReports: () => false,
  canViewActivities: () => false,
  canViewCarpools: () => false,
}));

const endpoints = require('../../spa/api/api-endpoints.js');
const scoutYears = require('../../spa/api/api-scout-years.js');
const { prompt, confirm } = require('../../spa/utils/DialogUtils.js');
const { buildFamilyTasks, ALL_CHILDREN } = require('../../spa/modules/dashboard/FamilyTasks.js');
const { ParentDashboard } = require('../../spa/modules/dashboard/ParentDashboard.js');

const ADA = { id: 4, first_name: 'Ada', last_name: 'Lovelace' };
const LEA = { id: 5, first_name: 'Léa', last_name: 'Tremblay', has_fiche_sante: true };

/**
 * A pending permission slip.
 *
 * @param {number} id - Slip id
 * @param {number} participantId - Child
 * @param {Object} [overrides] - Other fields
 * @returns {Object} Slip
 */
function slip(id, participantId, overrides = {}) {
  return {
    id,
    participant_id: participantId,
    activity_id: 30,
    activity_title: 'Winter camp',
    meeting_date: '2026-11-14T00:00:00.000Z',
    deadline_date: '2026-11-07T00:00:00.000Z',
    status: 'pending',
    ...overrides,
  };
}

/**
 * The dashboard data of a family, with nothing to do unless given.
 *
 * @param {Object} overrides - Fields to set
 * @returns {Object} Data for buildFamilyTasks
 */
function familyData(overrides = {}) {
  return {
    participants: [ADA, LEA],
    permissionSlips: new Map(),
    formFormats: {},
    formMeta: {},
    formsToReview: [],
    authorizationsToSign: [],
    statements: new Map(),
    today: '2026-10-24',
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('grouping the family\'s tasks', () => {
  test.each([null, '', '   '])('an untitled packing list can sort beside a permission slip on the same date: %p', (title) => {
    const tasks = buildFamilyTasks(familyData({
      permissionSlips: new Map([[4, [slip(91, 4)]]]),
      packingLists: [{ meeting_id: 80, participant_id: 4, date: '2026-11-14', title, item_keys: ['untitled-bag'] }],
    }));
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.kind === 'equipment').title).toBe('personal_equipment_camp');
  });

  test('a permission both children need appears once, naming both', () => {
    const tasks = buildFamilyTasks(familyData({
      permissionSlips: new Map([[4, [slip(91, 4)]], [5, [slip(92, 5)]]]),
    }));

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ kind: 'permission', title: 'Winter camp', date: '2026-11-14' });
    expect(tasks[0].rows.map((row) => [row.name, row.slipId])).toEqual([['Ada', 91], ['Léa', 92]]);
  });

  test('answered slips and past events are not tasks, and events come by date', () => {
    const tasks = buildFamilyTasks(familyData({
      permissionSlips: new Map([[4, [
        slip(91, 4, { activity_id: 31, activity_title: 'Hike', meeting_date: '2026-10-30' }),
        slip(93, 4, { activity_id: 32, activity_title: 'Last week', meeting_date: '2026-10-17' }),
        slip(94, 4, { activity_id: 33, status: 'signed' }),
      ]], [5, [slip(92, 5)]]]),
    }));

    expect(tasks.map((task) => task.title)).toEqual(['Hike', 'Winter camp']);
  });

  test('a form neither child has filled is one task; one the account may not submit is none', () => {
    const tasks = buildFamilyTasks(familyData({
      formFormats: { fiche_sante: {}, acceptation_risque: {}, leader_notes: {} },
      formMeta: {
        fiche_sante: { display_name: 'Health form' },
        acceptation_risque: { display_name: 'Risk acceptance' },
        leader_notes: { display_name: 'Leader notes', permissions: { can_view: true, can_submit: false } },
      },
    }));

    expect(tasks.map((task) => [task.title, task.rows.map((row) => row.name)])).toEqual([
      ['Health form', ['Ada']],
      ['Risk acceptance', ['Ada', 'Léa']],
    ]);
  });

  test('forms to re-read, authorizations and payments name each child once', () => {
    const tasks = buildFamilyTasks(familyData({
      formsToReview: [
        { id: 70, participant_id: 4, form_type: 'fiche_sante', display_name: 'Health form' },
        { id: 71, participant_id: 5, form_type: 'fiche_sante', display_name: 'Health form' },
      ],
      authorizationsToSign: [
        { participant_id: 5, kind: 'treatment' },
        { participant_id: 5, kind: 'treatment' },
      ],
      statements: new Map([
        [4, { totals: { total_outstanding: 120 } }],
        [5, { totals: { total_outstanding: 0 } }],
      ]),
    }));

    expect(tasks.map((task) => [task.kind, task.rows.map((row) => row.name)])).toEqual([
      ['review', ['Ada', 'Léa']],
      ['authorization', ['Léa']],
      ['payment', ['Ada']],
    ]);
    expect(tasks[0].rows.map((row) => row.submissionId)).toEqual([70, 71]);
    expect(tasks[2].rows[0].amount).toBe(120);
  });

  test('a child outside the account\'s children never appears', () => {
    const tasks = buildFamilyTasks(familyData({
      participants: [ADA],
      formsToReview: [{ id: 72, participant_id: 99, form_type: 'fiche_sante' }],
      permissionSlips: new Map([[99, [slip(95, 99)]]]),
    }));

    expect(tasks).toEqual([]);
  });

  test('filtered to one child, only that child\'s tasks remain', () => {
    const data = familyData({
      permissionSlips: new Map([[4, [slip(91, 4)]], [5, [slip(92, 5)]]]),
      statements: new Map([[5, { totals: { total_outstanding: 40 } }]]),
    });

    expect(buildFamilyTasks(data, 4).map((task) => [task.kind, task.rows.map((row) => row.name)]))
      .toEqual([['permission', ['Ada']]]);
    expect(buildFamilyTasks(data, ALL_CHILDREN)).toHaveLength(2);
  });

  test('two children sharing a first name are told apart by their full name', () => {
    const tasks = buildFamilyTasks(familyData({
      participants: [ADA, { id: 6, first_name: 'Ada', last_name: 'Byron' }],
      permissionSlips: new Map([[4, [slip(91, 4)]], [6, [slip(96, 6)]]]),
    }));

    expect(tasks[0].rows.map((row) => row.name)).toEqual(['Ada Lovelace', 'Ada Byron']);
  });
});

describe('the parent dashboard', () => {
  /**
   * Render the dashboard for these children and slips.
   *
   * @param {Array<Object>} children - The account's children
   * @param {Map<number, Array<Object>>} slips - Slips by child
   * @param {Object} [extra] - Fields set on the page before it renders
   * @returns {Promise<{page: ParentDashboard, app: Object}>} The page
   */
  async function renderDashboard(children, slips = new Map(), extra = {}) {
    document.body.innerHTML = '<div id="app"></div>';
    const app = { organizationSettings: {}, showMessage: jest.fn(), language: 'en' };
    const page = new ParentDashboard(app);
    page.fetchParticipants = jest.fn(() => { page.participants = children; });
    page.fetchFormFormats = jest.fn(() => { page.formFormats = {}; page.formMeta = {}; });
    page.fetchParticipantStatements = jest.fn();
    page.fetchPermissionSlips = jest.fn(() => { page.permissionSlips = new Map(slips); });
    page.loadPermissionSlips = jest.fn((participantId) => {
      page.permissionSlips.set(participantId, []);
      return Promise.resolve([]);
    });
    page.checkAndShowLinkParticipantsDialog = jest.fn();
    Object.assign(page, extra);
    await page.init();
    return { page, app };
  }

  const twoChildSlips = () => new Map([[4, [slip(91, 4)]], [5, [slip(92, 5)]]]);
  const tasks = () => [...document.querySelectorAll('.family-task')];
  const filterButtons = () => [...document.querySelectorAll('[data-family-filter]')];

  afterEach(() => {
    require('../../spa/utils/ModalUtils.js').closeAllModals();
  });

  test('the family\'s tasks come first, the shared permission once with both children named', async () => {
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips());

    const section = document.querySelector('.family-tasks');
    const children = document.querySelector('.parent-dashboard__participants');
    expect(section.compareDocumentPosition(children) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.querySelector('h2').textContent).toBe('family_tasks_title');
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0].querySelector('h3').textContent).toBe('Winter camp');
    expect(tasks()[0].textContent).toContain('Ada and Léa');
    page.destroy();
  });

  test('a family of several children can show one child\'s tasks, and the state is not colour alone', async () => {
    const { page } = await renderDashboard([ADA, LEA], new Map([[4, [slip(91, 4)]]]));

    expect(filterButtons().map((button) => [button.textContent.replace(/\s+/g, ' ').trim(), button.getAttribute('aria-pressed')]))
      .toEqual([['✓ family_filter_all', 'true'], ['Ada (1)', 'false'], ['Léa (0)', 'false']]);

    const lea = filterButtons()[2];
    lea.focus();
    lea.click();

    expect(filterButtons()[2].getAttribute('aria-pressed')).toBe('true');
    expect(filterButtons()[2].querySelector('.family-filter__mark').textContent).toBe('✓');
    expect(filterButtons()[0].getAttribute('aria-pressed')).toBe('false');
    expect(document.activeElement).toBe(filterButtons()[2]);
    expect(tasks()).toHaveLength(0);
    expect(document.querySelector('.family-tasks__empty').textContent).toBe('family_tasks_empty');
    // Only Léa's file shows, opened.
    expect(document.querySelector('[data-child-card="4"]').hidden).toBe(true);
    expect(document.querySelector('[data-child-card="5"]').hidden).toBe(false);
    expect(document.querySelector('[data-child-card="5"] details').open).toBe(true);

    filterButtons()[0].click();
    expect(tasks()).toHaveLength(1);
    expect(document.querySelector('[data-child-card="4"]').hidden).toBe(false);
    page.destroy();
  });

  test('each child\'s full file opens on demand; a family of one sees no filter and the file open', async () => {
    let { page } = await renderDashboard([ADA, LEA], twoChildSlips());
    expect([...document.querySelectorAll('.participant-card details')].map((details) => details.open)).toEqual([false, false]);
    expect(document.querySelector('[data-child-card="4"] summary').textContent).toContain('family_child_file_show');
    page.destroy();

    ({ page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]])));
    expect(filterButtons()).toHaveLength(0);
    expect(document.querySelector('.participant-card details').open).toBe(true);
    page.destroy();
  });

  test('signing an event answers every child named, with one signer name', async () => {
    const { page, app } = await renderDashboard([ADA, LEA], twoChildSlips());
    prompt.mockResolvedValue(' Marie Tremblay ');
    endpoints.signPermissionSlip.mockResolvedValue({ success: true });

    document.querySelector('.js-family-sign').click();
    await flush();

    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'family_tasks_signer_prompt' }));
    expect(endpoints.signPermissionSlip.mock.calls.map(([id, body]) => [id, body.signed_by]))
      .toEqual([[91, 'Marie Tremblay'], [92, 'Marie Tremblay']]);
    expect(app.showMessage).toHaveBeenCalledWith('permission_slip_signed', 'success');
    expect(page.loadPermissionSlips).toHaveBeenCalledWith(4, true);
    expect(page.loadPermissionSlips).toHaveBeenCalledWith(5, true);
    expect(tasks()).toHaveLength(0);
    page.destroy();
  });

  test('declining asks for confirmation, and declining the confirmation sends nothing', async () => {
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips());
    prompt.mockResolvedValue('Marie Tremblay');
    confirm.mockResolvedValue(false);

    document.querySelector('.js-family-decline').click();
    await flush();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'family_tasks_decline_confirm', danger: true }));
    expect(endpoints.declinePermissionSlip).not.toHaveBeenCalled();
    expect(tasks()).toHaveLength(1);
    page.destroy();
  });

  test('when one child\'s answer fails, the parent is told which, not that all is signed', async () => {
    const { page, app } = await renderDashboard([ADA, LEA], twoChildSlips());
    prompt.mockResolvedValue('Marie Tremblay');
    endpoints.signPermissionSlip
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));

    document.querySelector('.js-family-sign').click();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith('family_tasks_partial_failure', 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('permission_slip_signed', 'success');
    page.destroy();
  });

  test('an answer queued offline is not reported as sent', async () => {
    const { page, app } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]]));
    prompt.mockResolvedValue('Marie Tremblay');
    endpoints.signPermissionSlip.mockResolvedValue({ queued: true });

    document.querySelector('.js-family-sign').click();
    await flush();

    expect(app.showMessage).toHaveBeenCalledWith('family_tasks_response_queued', 'info');
    page.destroy();
  });

  test('confirming a form re-read removes it from the tasks', async () => {
    const { page, app } = await renderDashboard([ADA, LEA], new Map(), {});
    page.formsToReview = [{ id: 70, participant_id: 4, form_type: 'fiche_sante', display_name: 'Health form' }];
    page.refreshFamilyView();

    document.querySelector('.js-confirm-review').click();
    await flush();

    expect(scoutYears.confirmFormReview).toHaveBeenCalledWith(70);
    expect(app.showMessage).toHaveBeenCalledWith('form_review_confirmed', 'success');
    expect(document.querySelector('.js-confirm-review')).toBeNull();
    page.destroy();
  });

  test('a list that failed to load is not shown as "nothing to do"', async () => {
    scoutYears.getFormsNeedingReview.mockRejectedValueOnce(new Error('offline'));
    const { page } = await renderDashboard([ADA, LEA]);

    expect(document.querySelector('.family-tasks [role="alert"]').textContent).toContain('family_tasks_incomplete');
    expect(document.querySelector('.family-tasks__empty').textContent).toBe('family_tasks_none_loaded');
    expect(document.getElementById('family-tasks-retry')).not.toBeNull();
    page.destroy();
  });

  test('children\'s names are shown as text, never as markup', async () => {
    const hostile = { id: 8, first_name: '<img src=x onerror="window.pwned=1">', last_name: 'Doe' };
    const { page } = await renderDashboard([ADA, hostile], new Map([[4, [slip(91, 4)]], [8, [slip(98, 8, {
      activity_title: '<b onmouseover="x">Camp</b>',
    })]]]));

    expect(document.querySelector('.family-tasks img')).toBeNull();
    expect(document.querySelector('.family-tasks b')).toBeNull();
    expect(document.querySelector('.family-tasks').textContent).toContain('<img src=x onerror="window.pwned=1">');
    expect(filterButtons()[2].textContent).toContain('<img src=x');
    expect(window.pwned).toBeUndefined();
    page.destroy();
  });

  test('a leaving parent\'s dashboard stops answering clicks', async () => {
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips());
    page.destroy();

    document.querySelector('.js-family-sign').click();
    await flush();
    expect(prompt).not.toHaveBeenCalled();
  });

  test('has no WCAG A/AA violations, with every kind of task and the filter', async () => {
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips(), {});
    page.formFormats = { acceptation_risque: {} };
    page.formMeta = { acceptation_risque: { display_name: 'Risk acceptance' } };
    page.formsToReview = [{ id: 70, participant_id: 4, form_type: 'fiche_sante', display_name: 'Health form' }];
    page.authorizationsToSign = [{ participant_id: 5, kind: 'treatment' }];
    page.participantStatements = new Map([[4, { totals: { total_outstanding: 120 } }]]);
    page.refreshFamilyView();

    expect(tasks().map((task) => task.className.replace('family-task family-task--', ''))).toEqual([
      'permission', 'form', 'review', 'authorization', 'payment',
    ]);
    const results = await axe.run(document.querySelector('.parent-dashboard'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      // jsdom does no layout, so contrast cannot be computed here.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    page.destroy();
  });
});
