/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: {
    DEFAULT_LANG: 'fr',
    SUPPORTED_LANGS: ['en', 'fr']
  }
}));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  escapeHTML: (value) => String(value ?? ''),
  sanitizeHTML: (value) => String(value ?? ''),
  sanitizeURL: (value) => String(value ?? '')
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn()
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, content) => {
    if (element) element.innerHTML = String(content ?? '');
    return element;
  },
  loadStylesheet: jest.fn(() => Promise.resolve())
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: () => true
}));

jest.mock('../../spa/api/api-yearly-planner.js', () => ({
  getYearPlans: jest.fn(),
  batchPlaceActivity: jest.fn(),
  createPlanMeeting: jest.fn(),
  deletePlanMeeting: jest.fn(),
  unlinkActivityEvent: jest.fn(),
  getYearPlan: jest.fn(),
  createYearPlan: jest.fn(),
  deleteYearPlan: jest.fn(),
  createPeriod: jest.fn(),
  deletePeriod: jest.fn(),
  createObjective: jest.fn(),
  deleteObjective: jest.fn(),
  updateYearPlanMeeting: jest.fn(),
  getActivityLibrary: jest.fn(),
  createLibraryActivity: jest.fn(),
  deleteLibraryActivity: jest.fn(),
  deleteSeries: jest.fn(),
  updateSeries: jest.fn(),
  getDistributionRules: jest.fn(),
  deleteDistributionRule: jest.fn(),
  updateYearPlan: jest.fn()
}));

import { YearlyPlanner } from '../../spa/modules/yearly-planner/YearlyPlanner.js';
import { PlanCalendarEditor } from '../../spa/modules/yearly-planner/PlanCalendarEditor.js';

function makeApp() {
  return {
    lang: 'fr',
    showMessage: jest.fn(),
    router: { navigate: jest.fn() }
  };
}

describe('yearly planner view lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main id="app"></main>';
    localStorage.clear();
  });

  test('the desktop grid class belongs only to the detail header', () => {
    const planner = new YearlyPlanner(makeApp());

    const loadingHost = document.createElement('div');
    loadingHost.innerHTML = planner.renderLoading();
    expect(loadingHost.querySelector('.yp-plan-detail-header')).toBeNull();

    planner.plans = [];
    const listHost = document.createElement('div');
    listHost.innerHTML = planner.renderPlanList();
    expect(listHost.querySelector('.yp-plan-detail-header')).toBeNull();

    planner.currentPlan = {
      id: 1,
      title: '2026-2027',
      start_date: '2026-09-01',
      end_date: '2027-06-02',
      recurrence_pattern: 'weekly',
      periods: [],
      meetings: [],
      objectives: [],
      distribution_rules: []
    };
    const detailHost = document.createElement('div');
    detailHost.innerHTML = planner.renderPlanDetail();
    expect(detailHost.querySelectorAll('.yp-plan-detail-header')).toHaveLength(1);

    planner.destroy();
  });

  test('rebinding a rendered view aborts its previous handlers', () => {
    const planner = new YearlyPlanner(makeApp());
    planner.showCreatePlanModal = jest.fn();
    document.getElementById('app').innerHTML = '<button id="yp-create-btn">Create</button>';

    planner.attachEventListeners();
    planner.attachEventListeners();
    document.getElementById('yp-create-btn').click();

    expect(planner.showCreatePlanModal).toHaveBeenCalledTimes(1);
    planner.destroy();
  });
});

describe('persistent modal controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('calendar rerenders do not stack save listeners on the footer button', () => {
    const editor = new PlanCalendarEditor(makeApp(), {
      plan: { id: 1, blackout_dates: [], anchors: [] },
      onSaved: jest.fn()
    });
    editor.save = jest.fn();
    editor.open();

    editor.render();
    editor.render();
    document.getElementById('yp-calendar-rules-save').click();

    expect(editor.save).toHaveBeenCalledTimes(1);
    editor.modal.close();
  });
});
