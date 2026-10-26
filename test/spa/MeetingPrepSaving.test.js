/**
 * @jest-environment jsdom
 */

/**
 * Saving a meeting's preparation.
 *
 * Held here: a meeting with no leader in charge or place yet still reaches
 * the server, since the server needs neither; a change the server cannot take
 * yet (no date) is kept on the device and the status names what is missing,
 * so it never reads as saved for the team; and an activity's unit material
 * is sent with the meeting.
 *
 * @module test/spa/MeetingPrepSaving
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { UI: { MEETING_DRAFT_WRITE_DELAY: 0, MEETING_AUTOSAVE_DELAY: 0, MEETING_DRAFT_EXPIRATION: 60000 } },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/indexedDB.js', () => ({
  deleteCachedData: jest.fn(() => Promise.resolve()),
  getCachedData: jest.fn(() => Promise.resolve(null)),
  setCachedData: jest.fn(() => Promise.resolve()),
  clearYearlyPlannerCaches: jest.fn(() => Promise.resolve()),
}));
jest.mock('../../spa/utils/meetingSections.js', () => ({
  getSectionActivityTemplates: jest.fn(() => []),
  getTemplateStarterKey: jest.fn(() => null),
  getActiveSectionConfig: jest.fn(() => ({ sectionConfig: { honorField: { required: false } }, mergedConfig: {} })),
  getHonorLabel: jest.fn(() => 'youth_of_honor'),
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/api/api-ai.js', () => ({ aiGenerateText: jest.fn() }));
jest.mock('../../spa/api/api-equipment-catalog.js', () => ({
  getMaterialOptions: jest.fn(() => Promise.resolve({ data: { articles: [], equipment: [{ id: 9, name: 'Ballon', category: 'sports', unit_of_measure: 'each' }] } })),
}));
jest.mock('../../spa/api/api-yearly-planner.js', () => ({
  createReminder: jest.fn(),
  getMeetingReminders: jest.fn(() => Promise.resolve({ data: null })),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getMeetingActivities: jest.fn(() => Promise.resolve({ data: [] })),
  getAnimateurs: jest.fn(() => Promise.resolve({ data: [{ id: 'u1', full_name: 'Akela' }] })),
  getHonorsHistory: jest.fn(() => Promise.resolve({ data: { honors: [] } })),
  getParticipants: jest.fn(() => Promise.resolve({ data: [] })),
  getBadgeSystemSettings: jest.fn(() => Promise.resolve({ data: { templates: [] } })),
  getReunionPreparation: jest.fn(),
  saveReunionPreparation: jest.fn(),
  getReunionDates: jest.fn(() => Promise.resolve({ data: [{ date: '2026-11-04' }] })),
  getReminder: jest.fn(() => Promise.resolve({ data: null })),
  saveReminder: jest.fn(),
}));

const endpoints = require('../../spa/api/api-endpoints.js');
const { MeetingPrep } = require('../../spa/modules/meetings/MeetingPrep.js');

const DATE = '2026-11-04';
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** @returns {Promise<void>} Let the debounced autosave run */
async function letAutosaveRun() {
  for (let round = 0; round < 10; round += 1) {
    // eslint-disable-next-line no-await-in-loop -- each round lets one timer and its promises finish
    await settle();
  }
}

let screen;

beforeEach(async () => {
  jest.clearAllMocks();
  document.body.innerHTML = '<main id="app"></main>';
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  endpoints.getReunionPreparation.mockResolvedValue({
    data: {
      meeting: {
        id: 5, date: DATE, meeting_date: DATE, endroit: '', animateur_responsable: '', notes: '',
        youth_of_honor: [], activities: [{ id: 41, activity: 'Jeu', time: '19:00', duration: '00:20', materiel: '', material_items: [] }],
      },
      meetingSections: {},
    },
  });
  endpoints.saveReunionPreparation.mockImplementation((formData) => Promise.resolve({ success: true, data: { ...formData, id: 5 } }));
  const app = { lang: 'fr', showMessage: jest.fn(), waitForOrganizationSettings: () => Promise.resolve({}) };
  screen = new MeetingPrep(app);
  await screen.init(DATE);
  await letAutosaveRun();
});

afterEach(() => screen?.destroy());

/** @returns {string} What the status says */
function status() {
  return document.querySelector('#meeting-save-status .meeting-save-status__label').textContent;
}

test('a meeting with no leader in charge or place yet still reaches the server', async () => {
  const notes = document.getElementById('notes');
  notes.value = 'Apporter des dossards';
  notes.dispatchEvent(new Event('input', { bubbles: true }));
  await letAutosaveRun();

  expect(document.getElementById('animateur-responsable').required).toBe(false);
  expect(document.getElementById('endroit').required).toBe(false);
  expect(endpoints.saveReunionPreparation).toHaveBeenCalledWith(expect.objectContaining({
    date: DATE, notes: 'Apporter des dossards', animateur_responsable: null, endroit: '',
  }));
  expect(document.getElementById('meeting-save-status').dataset.state).toBe('saved');
});

test('a change the server cannot take yet says what is missing instead of reading as a draft', async () => {
  const date = document.getElementById('date');
  date.value = '';
  date.dispatchEvent(new Event('input', { bubbles: true }));
  await letAutosaveRun();

  expect(endpoints.saveReunionPreparation).not.toHaveBeenCalled();
  expect(document.getElementById('meeting-save-status').dataset.state).toBe('local');
  expect(status()).toBe('meeting_autosave_incomplete'.replace('{fields}', 'date'));
  expect(status()).not.toBe('meeting_autosave_local');
});

test('an activity\'s unit material is sent with the meeting', async () => {
  document.querySelector('.material-items-btn').click();
  const dialog = document.getElementById('activity-material-items');
  dialog.querySelector('[data-item-select]').value = 'e9';
  dialog.querySelector('[data-add-item]').click();
  document.getElementById('activity-material-form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await letAutosaveRun();

  const [sent] = endpoints.saveReunionPreparation.mock.calls.at(-1);
  expect(sent.activities[0].material_items).toEqual([
    expect.objectContaining({ equipment_item_id: 9, catalog_item_id: null, quantity: 1, name: 'Ballon' }),
  ]);
});
