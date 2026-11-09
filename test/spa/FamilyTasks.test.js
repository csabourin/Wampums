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
  family_child_file_progress: 'Forms complete: {done} of {total}',
  family_tasks_child_heading: '{name} — {todo}',
  family_child_todo_other: '{count} things to do',
  family_tasks_show_more_other: 'Show {count} more',
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
const { prompt } = require('../../spa/utils/DialogUtils.js');
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
    // The slip's own page, where its text is read and answered (#1410)
    access_token: `00000000-0000-4000-8000-0000000000${String(id).padStart(2, '0')}`,
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

  test('a child\'s file says how many forms are filled in, never that it is complete when it is not', async () => {
    const { page } = await renderDashboard([ADA, LEA], new Map(), {
      fetchFormFormats: jest.fn(function loadFormats() {
        this.formFormats = { fiche_sante: {}, acceptation_risque: {} };
        this.formMeta = {};
      }),
    });

    const summary = (id) => document.querySelector(`[data-child-card="${id}"] summary`).textContent;
    expect(summary(4)).toContain('Forms complete: 0 of 2');
    expect(summary(5)).toContain('Forms complete: 1 of 2');
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

  test('a slip is answered on its own page, where its text is read first: one link per child', async () => {
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips());

    const links = [...document.querySelectorAll('.family-tasks .js-family-read-slip')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/permission-slip/00000000-0000-4000-8000-000000000091',
      '/permission-slip/00000000-0000-4000-8000-000000000092',
    ]);
    // Each link names its child for a screen reader, and the task names the activity
    expect(links[0].textContent).toContain('permission_slip_read_and_answer');
    expect(links[0].textContent).toContain('Ada');
    expect(links[1].textContent).toContain('Léa');
    expect(document.getElementById(links[0].getAttribute('aria-describedby')).textContent).toContain('Winter camp');
    // Nothing is signed from the dashboard, where the text is not shown
    expect(document.querySelector('.js-family-sign, .js-family-decline')).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
    expect(endpoints.signPermissionSlip).not.toHaveBeenCalled();
    page.destroy();
  });

  test('a family of one child has a single link to read and answer the slip', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]]));

    const links = [...document.querySelectorAll('.family-tasks .js-family-read-slip')];
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/permission-slip/00000000-0000-4000-8000-000000000091');
    page.destroy();
  });

  test('a pending slip is answered in one place: the child\'s card counts it and leads to the task', async () => {
    mockTemplates.family_child_todo_one = '{count} thing to do';
    const { page } = await renderDashboard([ADA, LEA], twoChildSlips());
    const card = document.querySelector('[data-child-card="4"]');

    expect(card.querySelector('.js-family-sign, .js-family-decline, .permission-slip-sign-btn, .permission-slip-decline-btn')).toBeNull();
    // The slip still to answer is not repeated in the file.
    expect(card.querySelector('.permission-slip-title')).toBeNull();
    expect(card.querySelector('[data-permission-slip-history]').hidden).toBe(true);
    expect(card.querySelector('.participant-card__todo-text').textContent).toBe('1 thing to do');

    card.querySelector('.js-family-goto-tasks').click();
    expect(document.activeElement).toBe(document.getElementById('family-tasks-title'));
    // Narrowed to Ada: her tasks, her card.
    expect(filterButtons()[1].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-child-card="5"]').hidden).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    delete mockTemplates.family_child_todo_one;
    page.destroy();
  });

  test('a form still to fill is a task, not repeated in the child\'s file; a filled one stays there', async () => {
    const { page } = await renderDashboard([LEA], new Map(), {
      fetchFormFormats: jest.fn(function loadFormats() {
        this.formFormats = { fiche_sante: {}, acceptation_risque: {} };
        this.formMeta = {};
      }),
    });

    const fileLinks = [...document.querySelectorAll('[data-child-card="5"] .participant-card__forms a')]
      .map((link) => link.getAttribute('href'));
    expect(fileLinks).toContain('/dynamic-form/fiche_sante/5');
    expect(fileLinks).not.toContain('/dynamic-form/acceptation_risque/5');
    expect(tasks().map((task) => task.querySelector('h3').textContent)).toEqual(['acceptation_risque']);
    page.destroy();
  });

  test('a child with nothing left to do is told so, with no link to the tasks', async () => {
    const { page } = await renderDashboard([LEA], new Map());

    const card = document.querySelector('[data-child-card="5"]');
    expect(card.querySelector('.participant-card__todo-text').textContent).toBe('family_child_todo_none');
    expect(card.querySelector('.js-family-goto-tasks')).toBeNull();
    page.destroy();
  });

  const SEVEN_FORMS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7'];
  const withForms = (formTypes) => ({
    fetchFormFormats: jest.fn(function loadFormats() {
      this.formFormats = Object.fromEntries(formTypes.map((type) => [type, {}]));
      this.formMeta = {};
    }),
  });

  test('a family of one child sees the child named once, above compact tasks', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]]), withForms(['fiche_sante']));

    expect(document.querySelector('.family-tasks__child').textContent.trim()).toBe('Ada — 2 things to do');
    // No "For: Ada" line, and no row repeating her name beside the button.
    expect(document.querySelector('.family-task__children')).toBeNull();
    expect(document.querySelector('.family-task__rows')).toBeNull();
    const fill = document.querySelector('.family-task--form a');
    expect(fill.getAttribute('href')).toBe('/dynamic-form/fiche_sante/4');
    // Screen readers still hear whom the button is for.
    expect(fill.querySelector('.visually-hidden').textContent).toContain('Ada');
    page.destroy();
  });

  test('beyond five tasks, the rest fold behind a button that keeps focus and says its state', async () => {
    const { page } = await renderDashboard([ADA], new Map(), withForms(SEVEN_FORMS));
    const visible = () => tasks().filter((task) => !task.hidden).length;

    expect(tasks()).toHaveLength(7);
    expect(visible()).toBe(5);
    const more = document.getElementById('family-tasks-more');
    expect(more.tagName).toBe('BUTTON');
    expect(more.getAttribute('aria-controls')).toBe('family-tasks-list');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(more.textContent.trim()).toBe('Show 2 more');

    more.focus();
    more.click();
    expect(visible()).toBe(7);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.textContent.trim()).toBe('family_tasks_show_fewer');
    expect(document.activeElement).toBe(more);

    more.click();
    expect(visible()).toBe(5);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    page.destroy();
  });

  test('five tasks or fewer show no fold button', async () => {
    const { page } = await renderDashboard([ADA], new Map(), withForms(SEVEN_FORMS.slice(0, 5)));
    expect(tasks()).toHaveLength(5);
    expect(document.getElementById('family-tasks-more')).toBeNull();
    page.destroy();
  });

  test('a slip past its answer-by date says it is late, in words', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4, { deadline_date: '2026-10-20' })]]]));

    const task = tasks()[0];
    expect(task.classList.contains('family-task--overdue')).toBe(true);
    expect(task.querySelector('.family-task__overdue').textContent).toBe('family_tasks_overdue');
    page.destroy();
  });

  test('a slip still within its answer-by date is not marked late', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]]));
    expect(tasks()[0].querySelector('.family-task__overdue')).toBeNull();
    page.destroy();
  });

  test('a child\'s file says in words whether each form is filled in, with no emoji', async () => {
    const { page } = await renderDashboard([LEA], new Map(), withForms(['fiche_sante']));

    const form = document.querySelector('[data-child-card="5"] .participant-card__forms a');
    expect(form.querySelector('.form-btn__status').textContent).toBe('family_form_status_done');
    expect(form.textContent).not.toMatch(/[✅❌]/u);
    page.destroy();
  });

  test('a child\'s name above the tasks is shown as text, never as markup', async () => {
    const { page } = await renderDashboard([{ id: 4, first_name: '<img src=x onerror=alert(1)>', last_name: 'X' }], new Map([[4, [slip(91, 4)]]]));

    const heading = document.querySelector('.family-tasks__child');
    expect(heading.querySelector('img')).toBeNull();
    expect(heading.textContent).toContain('<img src=x onerror=alert(1)>');
    page.destroy();
  });

  test('has no WCAG A/AA violations with folded tasks and a late slip', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4, { deadline_date: '2026-10-20' })]]]), withForms(SEVEN_FORMS));
    const results = await axe.run(document.getElementById('app'), {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(results.violations).toEqual([]);
    page.destroy();
  });

  test('when a list failed to load, a child\'s card never says there is nothing to do', async () => {
    const { page } = await renderDashboard([LEA], new Map(), {
      fetchPermissionSlips: jest.fn(function failSlips() { this.taskSourcesFailed = true; }),
    });

    const card = document.querySelector('[data-child-card="5"]');
    expect(card.querySelector('.participant-card__todo-text').textContent).toBe('family_child_todo_incomplete');
    expect(card.querySelector('.js-family-goto-tasks')).not.toBeNull();
    expect(document.getElementById('family-tasks-retry')).not.toBeNull();
    page.destroy();
  });

  test('once the slip is signed, the child\'s card shows it answered and nothing left to do', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4, { status: 'signed', signed_by: 'Marie Tremblay' })]]]));

    const card = document.querySelector('[data-child-card="4"]');
    expect(tasks()).toHaveLength(0);
    expect(card.querySelector('[data-permission-slip-history]').hidden).toBe(false);
    expect(card.querySelector('.permission-slip-title').textContent).toBe('Winter camp');
    expect(card.querySelector('.participant-card__todo-text').textContent).toBe('family_child_todo_none');
    page.destroy();
  });

  test('a slip left unanswered for an activity already past says so, with no way to answer', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [
      slip(93, 4, { activity_title: 'Last week', meeting_date: '2026-10-17' }),
    ]]]));
    const card = document.querySelector('[data-child-card="4"]');

    expect(tasks()).toHaveLength(0);
    expect(card.querySelector('.js-family-goto-tasks')).toBeNull();
    expect(card.querySelector('.permission-slip-actions').textContent.trim()).toBe('permission_slip_past_unanswered');
    expect(card.querySelector('.permission-slip-status').textContent).toContain('permission_slip_past_unanswered');
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

    filterButtons()[1].click();
    await flush();
    expect(filterButtons()[1].getAttribute('aria-pressed')).toBe('false');
  });

  test('every action on the dashboard uses the shared button styles', async () => {
    const { page } = await renderDashboard([ADA], new Map([[4, [slip(91, 4)]]]));

    expect(document.querySelector('.dashboard-button')).toBeNull();
    const actions = [...document.querySelectorAll('.parent-dashboard__actions a, .parent-dashboard__footer a')];
    expect(actions.length).toBeGreaterThan(0);
    actions.forEach((action) => expect(action.classList.contains('button')).toBe(true));
    // Spacing lives in the stylesheet, where the theme's tokens apply.
    expect(document.querySelector('.parent-dashboard [style]')).toBeNull();
    page.destroy();
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
