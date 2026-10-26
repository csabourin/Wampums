/**
 * @jest-environment jsdom
 */

/**
 * An outing's description written by the assistant.
 *
 * Held here: the material it lists is the unit's own, with quantities and
 * units, as the server chose it; a unit with nothing recorded keeps the
 * assistant's list; the headings are in the reader's language; and names are
 * shown as text.
 *
 * @module test/spa/ActivityPlanMaterial
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn() }));
jest.mock('../../spa/app.js', () => ({ app: {}, translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getApiUrl: (endpoint) => endpoint }));
jest.mock('../../spa/ajax-functions.js', () => ({ fetchParticipants: jest.fn(() => Promise.resolve([])), getCurrentOrganizationId: jest.fn(() => 3) }));
jest.mock('../../spa/api/api-endpoints.js', () => ({ getGroups: jest.fn(() => Promise.resolve({ data: [] })) }));
jest.mock('../../spa/api/api-activities.js', () => ({ createActivity: jest.fn(), updateActivity: jest.fn(), getActivity: jest.fn() }));
jest.mock('../../spa/indexedDB.js', () => ({ clearActivityRelatedCaches: jest.fn(), clearActivityPermissionSlipCaches: jest.fn() }));
jest.mock('../../spa/api/api-ai.js', () => ({ aiGenerateText: jest.fn() }));

const { aiGenerateText } = require('../../spa/api/api-ai.js');
const { openActivityFormModal } = require('../../spa/modules/activities/ActivityFormModal.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const PLAN = {
  title: 'Rallye en forêt',
  overview: 'Un rallye par équipes.',
  timeline: [{ minuteStart: 0, minuteEnd: 30, name: 'Départ', objective: 'Former les équipes' }],
};

/**
 * Open the activity form, ask the assistant, and return the description text.
 * @param {Object} plan - What the server answers
 * @param {string} [lang] - Current page language
 * @returns {Promise<string>} The description, as text
 */
async function generate(plan, lang = 'fr') {
  aiGenerateText.mockResolvedValue({ data: { data: plan } });
  openActivityFormModal({ showMessage: jest.fn(), lang });
  await flush();
  const overlay = document.getElementById('activity-modal');
  overlay.querySelector('#magic-generate-btn').click();
  document.getElementById('magic-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  await flush();
  return overlay.querySelector('#activity-description').textContent;
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => closeAllModals());

test('the material written is the unit\'s own, with quantities and units, under translated headings', async () => {
  const text = await generate({
    ...PLAN,
    material_items: [
      { catalog_item_id: 3, equipment_item_id: null, quantity: 4, name: 'Boussole <b>', unit_of_measure: 'each' },
      { catalog_item_id: null, equipment_item_id: 7, quantity: 20, name: 'Corde', unit_of_measure: 'm' },
    ],
  });

  expect(text).toContain('activity_plan_timeline_heading');
  expect(text).toContain('activity_plan_materials_heading');
  expect(text).not.toMatch(/Timeline:|Materials:/);
  expect(text).toContain('equipment_quantity_with_unit · Boussole <b>');
  expect(text).toContain('· Corde');
  expect(document.querySelector('#activity-description b')).toBeNull();
});

test('a unit with nothing recorded keeps the assistant\'s list', async () => {
  const text = await generate({ ...PLAN, materialsMasterList: ['Foulards', 'Sifflet'] });

  expect(text).toContain('- Foulards');
  expect(text).toContain('- Sifflet');
});

test('an outing that needs none of the unit\'s material lists none', async () => {
  const text = await generate({ ...PLAN, material_items: [] });

  expect(text).not.toContain('activity_plan_materials_heading');
});

// The page language, rather than the badge text or browser language, controls generation.
test.each(['fr', 'en', 'uk', 'it', 'id'])('an activity form on a %s page sends its language to the assistant', async (lang) => {
  await generate(PLAN, lang);
  expect(aiGenerateText).toHaveBeenCalledWith('meeting_plan', expect.objectContaining({ locale: lang }));
});
