/**
 * @jest-environment jsdom
 *
 * Medication authorizations signed by a parent.
 *
 * GET /v1/guardians answers with the list itself as `data`, in the guardian
 * table's own column names. The page read `data.guardians` and `first_name`,
 * so the guardian list was always empty: the form's required "guardian" field
 * could never be filled and a parent could not sign either authorization.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));
jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => value,
  getTodayISO: () => '2026-10-09'
}));
jest.mock('../../spa/indexedDB.js', () => ({}));
jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: (element, html) => {
    element.innerHTML = html;
  }
}));
jest.mock('../../spa/utils/OptimisticUpdateManager.js', () => ({
  OptimisticUpdateManager: jest.fn()
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({
  getGuardiansForParticipant: jest.fn(),
  getLeaders: jest.fn(),
  getFirstAidSupplies: jest.fn(),
  getMedicationAuthorizations: jest.fn(),
  saveTreatmentAuthorization: jest.fn(),
  saveAdministrationAuthorization: jest.fn()
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canManageMedication: () => false,
  canViewMedication: () => false
}));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildApiCacheKey: jest.fn() }));
jest.mock('../../spa/modules/OfflineManager.js', () => ({ offlineManager: {} }));

const endpoints = require('../../spa/api/api-endpoints.js');
const { MedicationManagement } = require('../../spa/medication_management.js');

const CHILD_ID = 7;
const GUARDIAN = {
  id: 12, guardian_id: 12, participant_id: CHILD_ID,
  prenom: 'Marie', nom: 'Parent', telephone_cellulaire: '819-555-0101'
};
const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } }
};

/**
 * The authorizations view for one child, loaded through the real loader.
 *
 * @returns {Promise<{page: MedicationManagement, app: Object}>} Page and app stub
 */
async function openAuthorizations() {
  endpoints.getGuardiansForParticipant.mockResolvedValue({ success: true, data: [GUARDIAN] });
  endpoints.getLeaders.mockResolvedValue({ success: true, data: { users: [{ id: 'u-1', full_name: 'Baloo Leader' }] } });
  endpoints.getFirstAidSupplies.mockResolvedValue({ success: true, data: { supplies: [] } });
  endpoints.getMedicationAuthorizations.mockResolvedValue({ success: true, data: {} });

  const app = { showMessage: jest.fn() };
  const page = new MedicationManagement(app, { view: 'authorizations', participantId: CHILD_ID });
  page.participants = [{ id: CHILD_ID, first_name: 'Léa', last_name: 'Parent' }];
  page.requirements = [];
  page.render = jest.fn();
  page.attachEventListeners = jest.fn();
  await page.loadAuthorizationData();

  document.body.innerHTML = `<main>${page.renderAuthorizationsSection()}</main>`;
  return { page, app };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('medication authorizations for a parent', () => {
  test('both forms offer the child\'s guardians by name', async () => {
    await openAuthorizations();

    for (const formId of ['treatmentAuthForm', 'adminAuthForm']) {
      const options = [...document.querySelectorAll(`#${formId} select[name="guardian_id"] option`)]
        .filter((option) => option.value);
      expect(options.map((option) => option.value)).toEqual(['12']);
      expect(options[0].textContent).toMatch(/Marie Parent — 819-555-0101/);
    }
  });

  test('a guardian without a phone number has no dangling separator', async () => {
    const { page } = await openAuthorizations();
    page.authGuardians = [{ ...GUARDIAN, telephone_cellulaire: null }];
    document.body.innerHTML = page.renderAuthorizationsSection();

    const option = document.querySelector('#treatmentAuthForm option[value="12"]');
    expect(option.textContent.trim()).toBe('Marie Parent');
  });

  test('the consent group legend is translated', async () => {
    await openAuthorizations();
    const legends = [...document.querySelectorAll('#treatmentAuthForm legend')].map((legend) => legend.textContent);
    expect(legends).toContain('medication_auth_consents');
    expect(legends).not.toContain('Consentements');
  });

  test('a refused signature is explained in the page language', async () => {
    const { page, app } = await openAuthorizations();
    const form = document.getElementById('treatmentAuthForm');
    form.querySelector('select[name="guardian_id"]').value = '12';
    endpoints.saveTreatmentAuthorization.mockRejectedValue(
      Object.assign(new Error('API request failed: Insufficient permissions'), { status: 403 })
    );

    await page.handleTreatmentAuthSubmit({ target: form });

    expect(endpoints.saveTreatmentAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ participant_id: CHILD_ID, guardian_id: '12' })
    );
    expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  });

  test('the authorization forms have no WCAG A/AA violations', async () => {
    await openAuthorizations();
    const results = await axe.run(document.querySelector('main'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
