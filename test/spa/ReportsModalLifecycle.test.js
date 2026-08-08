/**
 * @jest-environment jsdom
 *
 * Report modal lifecycle and the report data paths that were rendering empty.
 *
 * Scenarios covered, mirroring the reported bugs:
 *   * Dashboard → Reports → open a report → navigate back: the dashboard must
 *     be scrollable immediately.
 *   * Opening the seniority report (a full page, not a modal panel) must not
 *     leave the destination page locked.
 *   * The participant age report must list participants that exist.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

// DebugUtils reads import.meta, which jest cannot parse outside an ES module.
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/utils/SecurityUtils.js', () => ({
  sanitizeHTML: (value) => String(value ?? ''),
  escapeHTML: (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;'),
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDateShort: (date) => `DATE(${date})`,
  isoToDateString: (value) => value,
}));

jest.mock('../../spa/utils/PrintUtils.js', () => ({
  openPrintWindow: jest.fn(),
  setPrintContent: jest.fn(),
}));

jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewReports: () => true,
  isParent: () => false,
}));

jest.mock('../../spa/utils/ExportUtils.js', () => ({ exportToCSV: jest.fn() }));
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: '' } }));

const mockGetParticipantAgeReport = jest.fn();
const mockGetAllergiesReport = jest.fn();

jest.mock('../../spa/ajax-functions.js', () => ({
  getHealthReport: jest.fn(),
  getAllergiesReport: (...args) => mockGetAllergiesReport(...args),
  getMedicationReport: jest.fn(),
  getVaccineReport: jest.fn(),
  getLeaveAloneReport: jest.fn(),
  getMediaAuthorizationReport: jest.fn(),
  getMissingDocumentsReport: jest.fn(),
  getAttendanceReport: jest.fn(),
  getHonorsReport: jest.fn(),
  getPointsReport: jest.fn(),
  getParticipantProgressReport: jest.fn(),
  getParticipantAgeReport: (...args) => mockGetParticipantAgeReport(...args),
  getFormStructure: jest.fn(),
  getFormSubmissions: jest.fn(),
  getFormTypes: jest.fn(),
  getFinanceReport: jest.fn(),
}));

import { Reports } from '../../spa/reports.js';
import { isBodyScrollLocked, releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';

/**
 * Build the DOM the reports screen expects, plus a stub router.
 * @returns {{reports: Reports, navigate: jest.Mock}}
 */
function setup() {
  document.body.innerHTML = `
    <button id="open-report">open</button>
    <div id="app">
      <div id="report-modal" class="hidden" aria-hidden="true">
        <button class="modal-close">close</button>
        <div id="report-modal-title"></div>
        <div id="report-content"></div>
      </div>
    </div>
  `;

  const navigate = jest.fn();
  const app = { lang: 'fr', router: { navigate }, showMessage: jest.fn() };
  return { reports: new Reports(app), navigate };
}

beforeEach(() => {
  releaseAllScrollLocks();
  document.body.style.removeProperty('overflow');
  jest.clearAllMocks();
});

describe('report modal scroll lock', () => {
  test('opening a report locks the page behind the modal', () => {
    const { reports } = setup();

    reports.openReportModal('Health');

    expect(isBodyScrollLocked()).toBe(true);
    expect(document.getElementById('report-modal').classList.contains('hidden')).toBe(false);
  });

  test('navigating away with the modal open restores scrolling', () => {
    const { reports } = setup();
    reports.openReportModal('Health');
    expect(isBodyScrollLocked()).toBe(true);

    // The router calls destroy() on the outgoing module.
    reports.destroy();

    expect(isBodyScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  test('destroy still restores scrolling when the modal DOM is already gone', () => {
    const { reports } = setup();
    reports.openReportModal('Health');

    // The SPA container is re-rendered by the incoming screen before cleanup.
    document.getElementById('app').innerHTML = '';

    expect(() => reports.destroy()).not.toThrow();
    expect(isBodyScrollLocked()).toBe(false);
  });

  test('closing the modal returns focus to whatever opened it', () => {
    const { reports } = setup();
    const trigger = document.getElementById('open-report');
    trigger.focus();

    reports.openReportModal('Health');
    reports.closeReportModal();

    expect(document.activeElement).toBe(trigger);
  });

  test('the seniority report navigates without leaving the page locked', async () => {
    const { reports, navigate } = setup();

    await reports.loadReport('time-since-registration');

    expect(navigate).toHaveBeenCalledWith('/time-since-registration');
    expect(isBodyScrollLocked()).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('participant age report', () => {
  test('lists participants returned in the standard data envelope', async () => {
    const { reports } = setup();
    mockGetParticipantAgeReport.mockResolvedValue({
      success: true,
      data: [
        { id: 1, first_name: 'Alex', last_name: 'Tremblay', date_naissance: '2012-05-04', age: 14, group_name: 'Loups' },
        { id: 2, first_name: 'Sam', last_name: 'Roy', date_naissance: '2014-01-20', age: 12, group_name: null },
      ],
    });

    await reports.loadReport('participant-age');
    const html = document.getElementById('report-content').innerHTML;

    expect(html).not.toContain('no_data_available');
    expect(html).toContain('Alex Tremblay');
    expect(html).toContain('Sam Roy');
    expect(html).toContain('14');
    expect(reports.currentReportData).toHaveLength(2);
  });

  test('keeps participants without a birth date, marked as unknown', () => {
    const { reports } = setup();

    const html = reports.renderParticipantAgeReport([
      { id: 1, first_name: 'Alex', last_name: 'Tremblay', date_naissance: '2012-05-04', age: 14 },
      { id: 2, first_name: 'Noa', last_name: 'Dupont', date_naissance: null, age: null },
    ]);

    expect(html).toContain('Noa Dupont');
    expect(html).toContain('unknown');
    expect(html).not.toContain('undefined');
  });

  test('reports no data only when there really is none', () => {
    const { reports } = setup();
    expect(reports.renderParticipantAgeReport([])).toContain('no_data_available');
  });
});

describe('allergy report', () => {
  test('shows the information needed to respond to an allergy', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({
      success: true,
      data: [{
        id: 1,
        first_name: 'Alex',
        last_name: 'Tremblay',
        group_name: 'Loups',
        allergies: 'Arachides',
        allergy_severity: 'Sévère',
        allergy_reaction: 'Choc anaphylactique',
        allergy_action: 'Administrer EpiPen, appeler le 911',
        epipen: true,
        emergency_medication: 'EpiPen Jr',
        notes: 'Toujours garder deux auto-injecteurs',
      }],
    });

    await reports.loadReport('allergies');
    const html = document.getElementById('report-content').innerHTML;

    expect(html).toContain('Arachides');
    expect(html).toContain('Sévère');
    expect(html).toContain('Choc anaphylactique');
    expect(html).toContain('Administrer EpiPen');
    expect(html).toContain('EpiPen Jr');
    expect(html).toContain('Toujours garder deux auto-injecteurs');
  });

  test('does not leak unrelated medical data into the allergy report', () => {
    const { reports } = setup();

    const html = reports.renderAllergiesReport([{
      id: 1,
      first_name: 'Alex',
      last_name: 'Tremblay',
      allergies: 'Arachides',
      epipen: false,
    }]);

    // Swimming level and vaccination status belong to the health record report.
    expect(html).not.toContain('swimming_level');
    expect(html).not.toContain('vaccines_up_to_date');
  });
});

describe('complete health record report', () => {
  test('renders every part of the record, including emergency contacts', () => {
    const { reports } = setup();

    const html = reports.renderHealthReport([{
      id: 1,
      first_name: 'Alex',
      last_name: 'Tremblay',
      group_name: 'Loups',
      date_naissance: '2012-05-04',
      allergies: 'Arachides',
      epipen: true,
      medications: 'Ventolin',
      probleme_sante: 'Asthme',
      limitations: 'Pas de course prolongée',
      blessures_operations: 'Fracture 2024',
      niveau_natation: 'eau_peu_profonde',
      doit_porter_vfi: true,
      vaccins_a_jour: true,
      nom_medecin: 'Dre Roy',
      has_health_form: true,
      emergency_contacts: [
        { name: 'Marie Tremblay', relationship: 'mère', phone_mobile: '555-0100', email: 'marie@example.com' },
      ],
    }]);

    expect(html).toContain('Alex Tremblay');
    expect(html).toContain('Arachides');
    expect(html).toContain('Ventolin');
    expect(html).toContain('Asthme');
    expect(html).toContain('Pas de course prolongée');
    expect(html).toContain('Fracture 2024');
    expect(html).toContain('Dre Roy');
    expect(html).toContain('Marie Tremblay');
    expect(html).toContain('555-0100');
    // The EpiPen marker is a text label, not colour alone.
    expect(html).toContain('epipen');
  });

  test('omits fields with no value rather than printing blanks', () => {
    const { reports } = setup();

    const html = reports.renderHealthReport([{
      id: 1,
      first_name: 'Noa',
      last_name: 'Dupont',
      has_health_form: true,
      emergency_contacts: [],
    }]);

    expect(html).toContain('Noa Dupont');
    expect(html).toContain('no_emergency_contacts');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  test('escapes participant supplied text', () => {
    const { reports } = setup();

    const html = reports.renderHealthReport([{
      id: 1,
      first_name: '<script>alert(1)</script>',
      last_name: 'X',
      has_health_form: true,
      allergies: '<img src=x onerror=alert(1)>',
      emergency_contacts: [],
    }]);

    // The payload survives as inert text, never as markup the browser executes.
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
