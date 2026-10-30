/**
 * @jest-environment jsdom
 *
 * Moving a camp from the year plan moves its activity first; the server moves the
 * planned date with it, and a refusal is explained without saving the rest.
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
    if (element) {element.innerHTML = String(content ?? '');}
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

jest.mock('../../spa/api/api-activities.js', () => ({ updateActivity: jest.fn() }));

import { YearlyPlanner } from '../../spa/modules/yearly-planner/YearlyPlanner.js';
import { updateActivity } from '../../spa/api/api-activities.js';
import { updateYearPlanMeeting } from '../../spa/api/api-yearly-planner.js';

const CHIP = { meetingId: 9, activityId: 21, date: '2027-02-05', spanEndDate: '2027-02-07' };

function planner() {
  const screen = new YearlyPlanner({ lang: 'fr', showMessage: jest.fn(), router: { navigate: jest.fn() } });
  screen.loadPlanDetail = jest.fn(() => Promise.resolve());
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  updateActivity.mockResolvedValue({ success: true });
  updateYearPlanMeeting.mockResolvedValue({ success: true });
});

test('moved dates are saved on the camp\'s activity, then the rest of the sheet on the date', async () => {
  const screen = planner();

  await screen.handleSheetSave(CHIP, { theme: 'Hiver', dates: { start: '2027-02-12', end: '2027-02-14' } });

  expect(updateActivity).toHaveBeenCalledWith(21, {
    activity_date: '2027-02-12', activity_start_date: '2027-02-12', activity_end_date: '2027-02-14',
  });
  expect(updateYearPlanMeeting).toHaveBeenCalledWith(9, { theme: 'Hiver' });
  expect(updateActivity.mock.invocationCallOrder[0]).toBeLessThan(updateYearPlanMeeting.mock.invocationCallOrder[0]);
});

test('a refused move is explained with its reason and nothing else is saved', async () => {
  const screen = planner();
  updateActivity.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409, message: 'camp_date_taken' }));

  await screen.handleSheetSave(CHIP, { theme: 'Hiver', dates: { start: '2027-02-12', end: '2027-02-14' } });

  expect(updateYearPlanMeeting).not.toHaveBeenCalled();
  expect(screen.app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
});

test('a save without moved dates leaves the activity alone', async () => {
  const screen = planner();
  await screen.handleSheetSave(CHIP, { theme: 'Hiver' });
  expect(updateActivity).not.toHaveBeenCalled();
  expect(updateYearPlanMeeting).toHaveBeenCalledWith(9, { theme: 'Hiver' });
});
