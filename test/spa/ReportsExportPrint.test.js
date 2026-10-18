/**
 * @jest-environment jsdom
 *
 * The report dialog's two ways out: the CSV download and the printed sheet.
 */

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));

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
  formatDateShort: (date) => `DATE(${date instanceof Date ? 'today' : date})`,
  getTodayISO: () => '2026-10-18',
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
jest.mock('../../spa/config.js', () => ({ CONFIG: { API_BASE_URL: '', FEATURES: { EXPORT_REPORTS: true } } }));

const mockGetAllergiesReport = jest.fn();
const mockGetLeaveAloneReport = jest.fn();

jest.mock('../../spa/ajax-functions.js', () => ({
  getHealthReport: jest.fn(),
  getAllergiesReport: (...args) => mockGetAllergiesReport(...args),
  getMedicationReport: jest.fn(),
  getVaccineReport: jest.fn(),
  getLeaveAloneReport: (...args) => mockGetLeaveAloneReport(...args),
  getMediaAuthorizationReport: jest.fn(),
  getMissingDocumentsReport: jest.fn(),
  getAttendanceReport: jest.fn(),
  getHonorsReport: jest.fn(),
  getPointsReport: jest.fn(),
  getParticipantProgressReport: jest.fn(),
  getParticipantAgeReport: jest.fn(),
  getFormStructure: jest.fn(),
  getFormSubmissions: jest.fn(),
  getFormTypes: jest.fn(),
  getFinanceReport: jest.fn(),
}));

import { Reports } from '../../spa/modules/reports/Reports.js';
import { exportToCSV } from '../../spa/utils/ExportUtils.js';
import { openPrintWindow, setPrintContent } from '../../spa/utils/PrintUtils.js';
import { releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';

const ALLERGY_ROWS = [
  {
    id: 1,
    first_name: 'Léa',
    last_name: 'Roy',
    group_name: 'Rouge',
    allergies: 'Arachides',
    epipen: true,
    emergency_medication: 'EpiPen Jr',
    allergy_severity: null,
    allergy_reaction: null,
    allergy_action: null,
    notes: null,
  },
  {
    id: 2,
    first_name: 'Sam',
    last_name: 'Roy',
    group_name: 'Rouge',
    allergies: 'Lait',
    epipen: false,
    emergency_medication: null,
    allergy_severity: null,
    allergy_reaction: null,
    allergy_action: null,
    notes: null,
  },
];

/**
 * @returns {{reports: Reports, app: Object}} A reports screen in French
 */
function setup() {
  document.body.innerHTML = '<div id="app"></div>';
  const app = { lang: 'fr', router: { navigate: jest.fn() }, showMessage: jest.fn() };
  return { reports: new Reports(app), app };
}

beforeEach(() => {
  releaseAllScrollLocks();
  jest.clearAllMocks();
});

describe('CSV export of the report on screen', () => {
  test('the allergy report is exported with the interface language and a clean, dated name', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({ success: true, data: ALLERGY_ROWS });
    await reports.loadReport('allergies');

    reports.exportCurrentReport();

    expect(exportToCSV).toHaveBeenCalledTimes(1);
    const [rows, columns, filename, options] = exportToCSV.mock.calls[0];
    expect(rows).toEqual(ALLERGY_ROWS);
    expect(columns.map((column) => column.key)).toEqual(expect.arrayContaining(['first_name', 'allergies', 'epipen']));
    expect(filename).toBe('allergies_report_2026-10-18');
    expect(options).toEqual({ lang: 'fr' });
  });

  test('the leave-alone export says yes for the children whose answer is yes', async () => {
    const { reports } = setup();
    mockGetLeaveAloneReport.mockResolvedValue({
      success: true,
      data: [{ id: 1, first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', can_leave_alone: 'oui' }],
    });
    await reports.loadReport('leave-alone');

    reports.exportCurrentReport();

    const [rows, columns, filename] = exportToCSV.mock.calls[0];
    const answer = columns.find((column) => column.key === 'can_leave_alone');
    expect(answer.format(rows[0].can_leave_alone, rows[0])).toBe('yes');
    expect(filename).toBe('leave_alone_report_2026-10-18');
  });

  test('a report with nothing to export says so instead of downloading an empty file', async () => {
    const { reports, app } = setup();
    mockGetAllergiesReport.mockResolvedValue({ success: true, data: [] });
    await reports.loadReport('allergies');

    reports.exportCurrentReport();

    expect(exportToCSV).not.toHaveBeenCalled();
    expect(app.showMessage).toHaveBeenCalledWith('no_data_to_export', 'warning');
  });
});

describe('printing the report on screen', () => {
  let printWindow;

  beforeEach(() => {
    printWindow = { document: { close: jest.fn() }, print: jest.fn() };
    openPrintWindow.mockReturnValue(printWindow);
  });

  test('the sheet carries the report title and the date, and leaves out columns nobody filled', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({ success: true, data: ALLERGY_ROWS });
    await reports.loadReport('allergies');

    reports.printReport();

    expect(setPrintContent).toHaveBeenCalledTimes(1);
    const [, html, title] = setPrintContent.mock.calls[0];
    const printed = new DOMParser().parseFromString(html, 'text/html');

    expect(title).toBe('allergies_report_title');
    expect(printed.querySelector('.report-sheet__header').textContent).toContain('DATE(today)');
    const headers = [...printed.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    expect(headers).toContain('allergies');
    expect(headers).not.toContain('allergy_severity');
    expect(headers).not.toContain('allergy_reaction');
    expect(printed.querySelector('button')).toBeNull();
    expect(printWindow.print).toHaveBeenCalledTimes(1);
  });

  test('the report stays complete on screen after it is printed', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({ success: true, data: ALLERGY_ROWS });
    await reports.loadReport('allergies');

    reports.printReport();

    expect(document.querySelectorAll('#report-content thead th').length).toBeGreaterThan(5);
  });

  test('a blocked pop-up is explained, not silent', async () => {
    const { reports, app } = setup();
    mockGetAllergiesReport.mockResolvedValue({ success: true, data: ALLERGY_ROWS });
    await reports.loadReport('allergies');
    openPrintWindow.mockReturnValue(null);

    reports.printReport();

    expect(app.showMessage).toHaveBeenCalledWith('popup_blocked', 'error');
    expect(setPrintContent).not.toHaveBeenCalled();
  });
});
