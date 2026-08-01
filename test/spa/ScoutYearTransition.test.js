/**
 * @jest-environment jsdom
 */

/**
 * Scout year transition wizard.
 *
 * Covers the behaviour that protects the leader: exceptions are honoured, the
 * affected parent list is recomputed from the choices actually made, and the
 * payload sent to the server matches what was shown on the confirmation screen.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true)
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => String(value)
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    // eslint-disable-next-line no-param-reassign
    element.innerHTML = html;
  },
  loadStylesheet: jest.fn(() => Promise.resolve())
}));

const mockConfirmDialog = jest.fn(() => Promise.resolve(true));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: (...args) => mockConfirmDialog(...args)
}));

const mockGetScoutYears = jest.fn();
const mockGetTransitionPreview = jest.fn();
const mockExecuteTransition = jest.fn();
const mockSetMembershipStatus = jest.fn();
const mockGetTransitions = jest.fn();
const mockRollbackTransition = jest.fn();
jest.mock('../../spa/api/api-scout-years.js', () => ({
  getScoutYears: (...args) => mockGetScoutYears(...args),
  getTransitionPreview: (...args) => mockGetTransitionPreview(...args),
  executeTransition: (...args) => mockExecuteTransition(...args),
  setMembershipStatus: (...args) => mockSetMembershipStatus(...args),
  getTransitions: (...args) => mockGetTransitions(...args),
  rollbackTransition: (...args) => mockRollbackTransition(...args)
}));

const mockSendAlumniInvitations = jest.fn(() => Promise.resolve({ invited: 0 }));
jest.mock('../../spa/api/api-alumni.js', () => ({
  sendAlumniInvitations: (...args) => mockSendAlumniInvitations(...args)
}));

import { ScoutYearTransition } from '../../spa/modules/scout-year/ScoutYearTransition.js';

const YEARS = [
  { id: 3, label: '2025-2026', status: 'active', active_participants: 2 },
  { id: 2, label: '2024-2025', status: 'closed', active_participants: 3 }
];

/** Alice reaches the age limit, Bruno does not, Chloé has no birth date. */
function buildPreview(memberships = []) {
  return {
    current_year: { id: 3, label: '2025-2026' },
    next_year: { label: '2026-2027' },
    age_rule: { max_age: 12, reference_date: '2026-12-31' },
    participants: [
      {
        id: 1, first_name: 'Alice', last_name: 'Tremblay', group_name: 'Rouge',
        age_at_reference: 12, points_this_year: 40, disposition: 'graduating', needs_review: false
      },
      {
        id: 2, first_name: 'Bruno', last_name: 'Gagnon', group_name: 'Rouge',
        age_at_reference: 10, points_this_year: 9, disposition: 'returning', needs_review: false
      },
      {
        id: 3, first_name: 'Chloé', last_name: 'Roy', group_name: null,
        age_at_reference: null, points_this_year: 0, disposition: 'returning', needs_review: true
      }
    ],
    memberships_to_deactivate: memberships,
    counts: { returning: 2, graduating: 1, needs_review: 1, memberships_to_deactivate: memberships.length }
  };
}

const PARENT_OF_ALICE = {
  membership_id: 55, user_id: 'uuid-a', email: 'a@example.com',
  full_name: 'Sylvie Tremblay', role_names: ['parent']
};

let app;

beforeEach(() => {
  document.body.innerHTML = '<div id="app"></div>';
  jest.clearAllMocks();
  mockConfirmDialog.mockResolvedValue(true);
  mockGetScoutYears.mockResolvedValue(YEARS);
  mockGetTransitions.mockResolvedValue([]);
  // A test that drops the manage permission must not decide it for the next one.
  require('../../spa/utils/PermissionUtils.js').hasPermission.mockReturnValue(true);
  app = { lang: 'fr', showMessage: jest.fn() };
});

/** A transition that is still undoable. */
const UNDOABLE_TRANSITION = {
  id: 7,
  from_scout_year_id: 3,
  to_scout_year_id: 4,
  from_label: '2025-2026',
  to_label: '2026-2027',
  executed_at: '2026-08-25T18:00:00.000Z',
  executed_by_name: 'Sylvie Tremblay',
  summary: { graduated: 1, carried_over: 2, memberships_deactivated: 1 },
  rolled_back_at: null,
  can_rollback: true,
  rollback_blockers: []
};

/**
 * @returns {Promise<ScoutYearTransition>} An initialised module
 */
async function mount(preview = buildPreview([PARENT_OF_ALICE])) {
  mockGetTransitionPreview.mockResolvedValue(preview);
  const module = new ScoutYearTransition(app);
  await module.init();
  return module;
}

describe('roster step', () => {
  test('pre-selects the age rule and lists leavers first', async () => {
    await mount();

    // Everything needing a decision floats to the top: leavers, then the
    // participants the age rule could not judge, then the untouched majority.
    const names = [...document.querySelectorAll('.scout-year-list__name')].map(n => n.textContent);
    expect(names).toEqual(['Alice Tremblay', 'Chloé Roy', 'Bruno Gagnon']);

    expect(document.querySelector('#disposition-1').checked).toBe(true);
    expect(document.querySelector('#disposition-2').checked).toBe(false);
  });

  test('flags a participant with no birth date instead of graduating them', async () => {
    await mount();

    const chloe = document.querySelector('[data-participant-id="3"]');
    expect(chloe.classList.contains('needs-review')).toBe(true);
    expect(document.querySelector('#disposition-3').checked).toBe(false);
  });

  test('keeping a leaver as an exception reveals a note field', async () => {
    const module = await mount();

    const toggle = document.querySelector('#disposition-1');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(module.dispositions.get(1)).toBe('returning');
    const note = document.querySelector('#exception-note-1');
    expect(note).not.toBeNull();

    note.value = 'reprend une année';
    note.dispatchEvent(new Event('input', { bubbles: true }));
    expect(module.exceptionNotes.get(1)).toBe('reprend une année');
  });

  test('reset restores the proposed dispositions and clears notes', async () => {
    const module = await mount();

    const toggle = document.querySelector('#disposition-1');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    module.exceptionNotes.set(1, 'note');

    document.querySelector('#accept-all-btn').dispatchEvent(new Event('click', { bubbles: true }));

    expect(module.dispositions.get(1)).toBe('graduating');
    expect(module.exceptionNotes.size).toBe(0);
  });
});

describe('consequences step', () => {
  test('recomputes affected parents from the choices actually made', async () => {
    const module = await mount();

    // Leader keeps Alice, so her parent must no longer be proposed.
    const toggle = document.querySelector('#disposition-1');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    mockGetTransitionPreview.mockResolvedValue(buildPreview([]));
    await module.handleNext();

    expect(mockGetTransitionPreview).toHaveBeenLastCalledWith([]);
    expect(module.selectedMemberships.size).toBe(0);
    expect(document.querySelector('.scout-year-list__item.is-empty')).not.toBeNull();
  });

  test('stays on the roster step when the refreshed list cannot be fetched', async () => {
    const module = await mount();

    const toggle = document.querySelector('#disposition-1');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    mockGetTransitionPreview.mockRejectedValue(new Error('network'));
    await module.handleNext();

    // Advancing here would offer to deactivate the parent of a child the leader
    // just decided to keep.
    expect(module.step).toBe(1);
    expect(app.showMessage).toHaveBeenCalledWith('scout_year_refresh_failed', 'error');
    expect(module.selectedMemberships.has(PARENT_OF_ALICE.membership_id)).toBe(true);
  });

  test('parents are pre-checked but can be spared individually', async () => {
    const module = await mount();

    mockGetTransitionPreview.mockResolvedValue(buildPreview([PARENT_OF_ALICE]));
    await module.handleNext();

    const checkbox = document.querySelector('#membership-55');
    expect(checkbox.checked).toBe(true);

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(module.selectedMemberships.has(55)).toBe(false);
  });
});

describe('event listeners', () => {
  test('a click on Next advances exactly one step, however many re-renders happened', async () => {
    const module = await mount();

    // Each toggle re-renders; listeners must not stack.
    for (const id of [1, 2, 3]) {
      const toggle = document.querySelector(`#disposition-${id}`);
      toggle.checked = !toggle.checked;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    mockGetTransitionPreview.mockResolvedValue(buildPreview([PARENT_OF_ALICE]));
    document.querySelector('#next-step-btn').click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(module.step).toBe(2);
    // A duplicated listener would have run the confirmation step's action too.
    expect(mockExecuteTransition).not.toHaveBeenCalled();
  });

  test('a click on Next never reaches execution before the confirmation step', async () => {
    const module = await mount();

    mockGetTransitionPreview.mockResolvedValue(buildPreview([PARENT_OF_ALICE]));
    document.querySelector('#next-step-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(module.step).toBe(2);

    document.querySelector('#next-step-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(module.step).toBe(3);
    expect(mockExecuteTransition).not.toHaveBeenCalled();
    expect(mockConfirmDialog).not.toHaveBeenCalled();
  });
});

describe('execution', () => {
  /**
   * @param {ScoutYearTransition} module - Module under test
   */
  async function advanceToConfirm(module) {
    mockGetTransitionPreview.mockResolvedValue(buildPreview([PARENT_OF_ALICE]));
    await module.handleNext(); // -> consequences
    await module.handleNext(); // -> confirm
  }

  test('sends exactly what the confirmation screen showed', async () => {
    const module = await mount();
    await advanceToConfirm(module);

    expect(document.querySelector('.scout-year-recap').textContent).toContain('1');

    mockExecuteTransition.mockResolvedValue({
      previous_year: { label: '2025-2026' },
      new_year: { label: '2026-2027' },
      summary: { graduated: 1, carried_over: 2, memberships_deactivated: 1 }
    });

    await module.handleNext();

    expect(mockExecuteTransition).toHaveBeenCalledWith({
      graduating_participant_ids: [1],
      deactivate_membership_ids: [55],
      exceptions: []
    });
    expect(document.querySelector('.scout-year-report')).not.toBeNull();
  });

  test('forwards exception notes with the payload', async () => {
    const module = await mount();

    const toggle = document.querySelector('#disposition-1');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const note = document.querySelector('#exception-note-1');
    note.value = 'reprend une année';
    note.dispatchEvent(new Event('input', { bubbles: true }));

    mockGetTransitionPreview.mockResolvedValue(buildPreview([]));
    await module.handleNext();
    await module.handleNext();

    mockExecuteTransition.mockResolvedValue({
      previous_year: { label: '2025-2026' },
      new_year: { label: '2026-2027' },
      summary: { graduated: 0, carried_over: 3, memberships_deactivated: 0 }
    });
    await module.handleNext();

    expect(mockExecuteTransition).toHaveBeenCalledWith({
      graduating_participant_ids: [],
      deactivate_membership_ids: [],
      exceptions: [{ participant_id: 1, note: 'reprend une année' }]
    });
  });

  test('a failing history refresh does not present a committed transition as failed', async () => {
    const module = await mount();
    await advanceToConfirm(module);

    mockExecuteTransition.mockResolvedValue({
      previous_year: { label: '2025-2026' },
      new_year: { label: '2026-2027' },
      summary: { graduated: 1, carried_over: 2, memberships_deactivated: 1 }
    });
    // The transition committed; only the follow-up history GET fails.
    mockGetScoutYears.mockRejectedValue(new Error('network'));

    await module.handleNext();

    // Reporting failure here would leave Execute enabled, and a retry would run
    // the non-idempotent endpoint again — closing the year just opened.
    expect(module.step).toBe(4);
    expect(document.querySelector('.scout-year-report')).not.toBeNull();
    expect(app.showMessage).toHaveBeenCalledWith('scout_year_execute_success', 'success');
    expect(app.showMessage).not.toHaveBeenCalledWith('scout_year_execute_failed', 'error');
    expect(mockExecuteTransition).toHaveBeenCalledTimes(1);
  });

  test('does nothing when the confirmation dialog is dismissed', async () => {
    const module = await mount();
    await advanceToConfirm(module);

    mockConfirmDialog.mockResolvedValue(false);
    await module.handleNext();

    expect(mockExecuteTransition).not.toHaveBeenCalled();
    expect(module.step).toBe(3);
  });

  test('keeps the leader on the confirmation step when the server refuses', async () => {
    const module = await mount();
    await advanceToConfirm(module);

    mockExecuteTransition.mockRejectedValue(new Error('boom'));
    await module.handleNext();

    expect(app.showMessage).toHaveBeenCalledWith('boom', 'error');
    expect(module.step).toBe(3);
    expect(document.querySelector('.scout-year-report')).toBeNull();
  });
});

describe('read-only access', () => {
  test('shows the year history without the wizard', async () => {
    const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
    hasPermission.mockReturnValue(false);

    const module = new ScoutYearTransition(app);
    await module.init();

    expect(mockGetTransitionPreview).not.toHaveBeenCalled();
    expect(document.querySelector('.scout-year-wizard')).toBeNull();
    expect(document.querySelector('.scout-year-history')).not.toBeNull();
    expect(document.body.textContent).toContain('2024-2025');
  });
});

describe('undoing the last transition', () => {
  test('offers the undo button while the new year is still empty', async () => {
    mockGetTransitions.mockResolvedValue([UNDOABLE_TRANSITION]);
    await mount();

    const button = document.querySelector('#rollback-btn');
    expect(button).not.toBeNull();
    expect(button.dataset.transitionId).toBe('7');
    expect(document.body.textContent).toContain('scout_year_rollback_title');
  });

  test('names what is in the way instead of offering a button that would fail', async () => {
    mockGetTransitions.mockResolvedValue([{
      ...UNDOABLE_TRANSITION,
      can_rollback: false,
      rollback_blockers: [
        { reason: 'points_awarded', count: 12 },
        { reason: 'attendance_recorded', count: 3 }
      ]
    }]);
    await mount();

    expect(document.querySelector('#rollback-btn')).toBeNull();
    const blockers = [...document.querySelectorAll('.scout-year-rollback__blockers li')]
      .map(item => item.textContent.trim());
    expect(blockers).toEqual([
      'scout_year_rollback_blocker_points_awarded',
      'scout_year_rollback_blocker_attendance_recorded'
    ]);
  });

  test('a leader without the manage permission is not offered the undo', async () => {
    const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
    hasPermission.mockReturnValue(false);
    mockGetTransitions.mockResolvedValue([UNDOABLE_TRANSITION]);

    const module = new ScoutYearTransition(app);
    await module.init();

    expect(document.body.textContent).toContain('scout_year_rollback_title');
    expect(document.querySelector('#rollback-btn')).toBeNull();
  });

  test('undoing reloads the roster and returns the wizard to the first step', async () => {
    mockGetTransitions.mockResolvedValue([UNDOABLE_TRANSITION]);
    const module = await mount();
    module.step = 4;
    module.result = { previous_year: { label: '2025-2026' }, new_year: { label: '2026-2027' }, summary: {} };

    mockRollbackTransition.mockResolvedValue({ summary: { enrollments_reopened: 1 } });
    mockGetTransitions.mockResolvedValue([
      { ...UNDOABLE_TRANSITION, rolled_back_at: '2026-08-26T09:00:00.000Z', can_rollback: false }
    ]);

    document.querySelector('#rollback-btn').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(mockRollbackTransition).toHaveBeenCalledWith(7);
    expect(module.step).toBe(1);
    expect(module.result).toBeNull();
    expect(app.showMessage).toHaveBeenCalledWith('scout_year_rollback_success', 'success');
    expect(document.querySelector('#rollback-btn')).toBeNull();
    expect(document.body.textContent).toContain('scout_year_rollback_done');
  });

  test('a dismissed confirmation leaves the transition alone', async () => {
    mockGetTransitions.mockResolvedValue([UNDOABLE_TRANSITION]);
    const module = await mount();

    mockConfirmDialog.mockResolvedValue(false);
    await module.handleRollback(7);

    expect(mockRollbackTransition).not.toHaveBeenCalled();
  });

  test('a server refusal reloads the reason rather than leaving a stale button', async () => {
    mockGetTransitions.mockResolvedValue([UNDOABLE_TRANSITION]);
    const module = await mount();

    // Something was entered between the page load and the click.
    mockRollbackTransition.mockRejectedValue(new Error('The new year already holds data'));
    mockGetTransitions.mockResolvedValue([{
      ...UNDOABLE_TRANSITION,
      can_rollback: false,
      rollback_blockers: [{ reason: 'points_awarded', count: 1 }]
    }]);

    await module.handleRollback(7);

    expect(app.showMessage).toHaveBeenCalledWith('The new year already holds data', 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('scout_year_rollback_success', 'success');
    expect(document.querySelector('#rollback-btn')).toBeNull();
    expect(document.querySelector('.scout-year-rollback__blockers')).not.toBeNull();
  });
});
