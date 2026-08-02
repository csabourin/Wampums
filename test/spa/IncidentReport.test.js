/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn()
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: jest.fn(),
  insertHTML: jest.fn()
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: jest.fn((value) => value),
  getTodayISO: jest.fn(() => '2026-08-02')
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(),
  confirmDestructive: jest.fn()
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  hasPermission: jest.fn(() => true)
}));

jest.mock('../../spa/JSONFormRenderer.js', () => ({
  JSONFormRenderer: jest.fn()
}));

jest.mock('../../spa/api/api-core.js', () => ({
  API: { get: jest.fn() }
}));

jest.mock('../../spa/api/api-incidents.js', () => ({
  getIncidentReports: jest.fn(),
  getIncidentReport: jest.fn(),
  createIncidentReport: jest.fn(),
  updateIncidentReport: jest.fn(),
  deleteIncidentReport: jest.fn(),
  submitIncidentReport: jest.fn(),
  getIncidentPrefillParticipant: jest.fn(),
  getIncidentPrefillUser: jest.fn(),
  getIncidentPrefillActivity: jest.fn(),
  getEscalationContacts: jest.fn(),
  addEscalationContact: jest.fn(),
  deleteEscalationContact: jest.fn()
}));

jest.mock('../../spa/api/api-endpoints.js', () => ({
  getParticipants: jest.fn(),
  getUsers: jest.fn()
}));

jest.mock('../../spa/api/api-activities.js', () => ({
  getActivities: jest.fn()
}));

import { setContent } from '../../spa/utils/DOMUtils.js';
import {
  IncidentReport,
  getIncidentFormStructure
} from '../../spa/modules/incident-report/incident-report.js';

describe('incident report list navigation', () => {
  test('provides a return link to the dashboard', () => {
    const report = new IncidentReport({ router: {}, showMessage: jest.fn() });
    report.renderList();

    expect(setContent).toHaveBeenCalledWith(
      null,
      expect.stringContaining('href="/dashboard"')
    );
  });
});

describe('incident report translations', () => {
  const translationBundles = [
    ['English', require('../../lang/en.json')],
    ['French', require('../../lang/fr.json')]
  ];

  test.each(translationBundles)('%s includes the complete incident interface and form vocabulary', (_language, bundle) => {
    const incidentKeys = Object.keys(bundle).filter((key) => key.startsWith('incident_'));

    // 37 interface strings plus the 108 labels in the standard incident form.
    expect(incidentKeys).toHaveLength(145);
    expect(incidentKeys.every((key) => bundle[key] && bundle[key] !== key)).toBe(true);
  });
});

describe('getIncidentFormStructure', () => {
  const structure = {
    fields: [{ name: 'incident_date', type: 'date' }]
  };

  test('reads the current standardized REST response envelope', () => {
    expect(getIncidentFormStructure({ success: true, data: structure })).toBe(structure);
  });

  test.each([
    { data: { form_structure: structure } },
    { form_structure: structure },
    { form_structure: JSON.stringify(structure) }
  ])('keeps compatibility with legacy wrapped responses', (response) => {
    expect(getIncidentFormStructure(response)).toEqual(structure);
  });

  test.each([
    null,
    {},
    { data: 'not-an-object' },
    { data: '{not-valid-json' },
    { data: {} },
    { data: { fields: 'not-an-array' } }
  ])('rejects malformed structures safely', (response) => {
    expect(getIncidentFormStructure(response)).toBeNull();
  });
});
