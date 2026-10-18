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
  // The text a browser would show, as the real stripHTML returns.
  stripHTML: (value) => new globalThis.DOMParser().parseFromString(String(value ?? ''), 'text/html').body.textContent,
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
  REPORT_PRINT_STYLES: '.print-styles {}',
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

const mockGetFormSubmissionsByType = jest.fn();
const mockGetFormStructureByType = jest.fn();
jest.mock('../../spa/api/api-reports.js', () => ({
  getFormSubmissionsByType: (...args) => mockGetFormSubmissionsByType(...args),
  getFormStructureByType: (...args) => mockGetFormStructureByType(...args),
  getTimeSinceRegistration: jest.fn(),
}));

import axe from 'axe-core';
import { Reports } from '../../spa/modules/reports/Reports.js';
import { openPrintWindow, setPrintContent } from '../../spa/utils/PrintUtils.js';
import { isBodyScrollLocked, releaseAllScrollLocks } from '../../spa/utils/ScrollLockUtils.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/**
 * Build the DOM the reports screen expects, plus a stub router.
 * @returns {{reports: Reports, navigate: jest.Mock}}
 */
function setup() {
  document.body.innerHTML = `
    <button id="open-report">open</button>
    <div id="app"></div>
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
    const dialog = document.querySelector('#report-modal [role="dialog"]');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Health');
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

  test('each youth is a card naming only what is filled in, readable on a phone', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({
      success: true,
      data: [
        { id: 1, first_name: 'Alex', last_name: 'Tremblay', group_name: 'Roux', allergies: 'Arachides', epipen: true },
        { id: 2, first_name: 'Noa', last_name: 'Roy', group_name: 'Gris', allergies: 'Chat Chien Pollen', epipen: false },
      ],
    });

    await reports.loadReport('allergies');
    const content = document.getElementById('report-content');
    const cards = [...content.querySelectorAll('article.report-record')];

    // No eight-column table, which a phone stacks into unlabelled boxes.
    expect(content.querySelector('table')).toBeNull();
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('h3').textContent).toBe('Alex Tremblay');
    expect(cards[0].querySelector('.badge-epipen').textContent).toBe('epipen');
    expect(cards[1].querySelector('.badge-epipen')).toBeNull();
    // A field left blank is left out, not drawn as a dash.
    expect([...content.querySelectorAll('dd')].map((dd) => dd.textContent)).not.toContain('—');
    expect([...cards[1].querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['allergies']);
    expect(cards[1].querySelector('dd').textContent).toBe('Chat Chien Pollen');

    const results = await axe.run(content, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('printing sends the report with the compact paper styles, named after the report', async () => {
    const { reports } = setup();
    mockGetAllergiesReport.mockResolvedValue({
      success: true,
      data: [{ id: 1, first_name: 'Alex', last_name: 'Tremblay', allergies: 'Arachides', epipen: true }],
    });
    const printWindow = {
      document: { documentElement: {}, close: jest.fn() },
      print: jest.fn(),
    };
    openPrintWindow.mockReturnValue(printWindow);

    await reports.loadReport('allergies');
    reports.printReport();

    const [, html, title, options] = setPrintContent.mock.calls[0];
    expect(title).toBe('allergies_report_title');
    expect(options).toEqual({ styles: '.print-styles {}' });
    expect(html).toContain('printed_on');
    expect(html).toContain('Arachides');
    expect(printWindow.document.documentElement.lang).toBe('fr');
    expect(printWindow.print).toHaveBeenCalled();
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

describe('reports listing youth', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>';

  /**
   * Render report markup into the page and return its root.
   * @param {string} html - Report markup
   * @returns {HTMLElement} Container
   */
  function mount(html) {
    document.body.innerHTML = `<div id="report-content">${html}</div>`;
    return document.getElementById('report-content');
  }

  const row = { first_name: 'Alex', last_name: 'Tremblay', group_name: HOSTILE };

  test.each([
    ['medication', 'renderMedicationReport', { ...row, medication: 'Ventolin' }, 'medication', 'Ventolin'],
    ['vaccines', 'renderVaccineReport', { ...row, vaccines_up_to_date: true }, 'vaccines_up_to_date', 'yes'],
    ['leave alone', 'renderLeaveAloneReport', { ...row, can_leave_alone: 'on' }, 'can_leave_alone', 'yes'],
    ['media', 'renderMediaAuthorizationReport', { ...row, media_authorized: false }, 'media_authorized', 'no'],
    ['missing documents', 'renderMissingDocumentsReport', { ...row, missing_documents: ['fiche_sante'] }, 'missing_documents', 'fiche_sante'],
    ['age', 'renderParticipantAgeReport', { ...row, date_naissance: '2015-01-01', age: 11 }, 'age', '11'],
  ])('the %s report is one labelled card per youth, with names shown as text', async (_name, method, item, label, value) => {
    const { reports } = setup();
    const root = mount(reports[method]([item]));

    expect(root.querySelector('table')).toBeNull();
    const card = root.querySelector('article.report-record');
    expect(card.querySelector('h3').textContent).toBe('Alex Tremblay');
    expect(card.querySelector('.report-record__group').textContent).toBe(HOSTILE);
    expect(root.querySelector('img')).toBeNull();
    const field = [...card.querySelectorAll('.report-record__field')]
      .find((entry) => entry.querySelector('dt').textContent === label);
    expect(field.querySelector('dd').textContent).toBe(value);

    const results = await axe.run(root, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('a report with nothing to list says so in the user\'s language', () => {
    const { reports } = setup();
    expect(reports.renderMedicationReport([])).toContain('no_data_available');
    expect(reports.renderMedicationReport([])).not.toContain('for medication report');
  });

  test('the points report groups cards under each den, with headings one level below', async () => {
    const { reports } = setup();
    const root = mount(`<h2>x</h2>${reports.renderPointsReport([
      { first_name: 'Alex', last_name: 'Roy', group_name: HOSTILE, total_points: 12, honors_count: 2 },
      { first_name: 'Noa', last_name: 'Roy', group_name: 'Gris', total_points: 3, honors_count: 0 },
    ])}`);

    const groups = [...root.querySelectorAll('.report-records-group')];
    expect(groups).toHaveLength(2);
    expect(groups[0].querySelector('h3').textContent).toBe(HOSTILE);
    expect(groups[0].querySelector('article h4').textContent).toBe('Alex Roy');
    expect(groups[0].querySelector('dd').textContent).toBe('12');
    expect(root.querySelector('img')).toBeNull();
    const results = await axe.run(root, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('the honors report is one card per date', () => {
    const { reports } = setup();
    const root = mount(reports.renderHonorsReport([{ date: '2026-10-01', count: 2, recipients: ['Alex', 'Noa'] }]));
    const card = root.querySelector('article.report-record');
    expect(card.querySelector('h3').textContent).toBe('DATE(2026-10-01)');
    expect(card.textContent).toContain('Alex, Noa');
  });

  test('the attendance grid scrolls in a named region a keyboard can reach', () => {
    const { reports } = setup();
    const root = mount(reports.renderAttendanceReport({
      success: true,
      data: [{ first_name: 'Alex', last_name: 'Roy', attendance: [{ date: '2026-10-01', status: 'present' }] }],
    }));
    const region = root.querySelector('.report-table-scroll');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBe('attendance_report');
    expect(region.querySelector('table')).not.toBeNull();
  });

  test('every amount in the financial report is named, not a bare figure', () => {
    const { reports } = setup();
    const root = mount(reports.renderFinancialReport({
      totals: {},
      participants: [{ first_name: 'Alex', last_name: 'Roy', total_billed: 100, total_paid: 40, total_outstanding: 60 }],
      definitions: [],
      payment_methods: [],
    }));
    const card = root.querySelector('article.report-record');
    expect(card.querySelector('h4').textContent).toBe('Alex Roy');
    expect([...card.querySelectorAll('dt')].map((dt) => dt.textContent))
      .toEqual(['total_billed', 'total_paid', 'outstanding_balance']);
    expect(root.textContent).toContain('no_payments');
  });
});

describe('missing fields report', () => {
  const STRUCTURE = {
    success: true,
    data: {
      fields: [
        { name: 'nom_medecin', label: 'nom_medecin_label', required: true },
        { name: 'has_allergies', label: 'has_allergies', required: true },
        { name: 'allergies', label: 'allergies', required: true, dependsOn: { field: 'has_allergies', value: 'yes' } },
        { name: 'commentaires', label: 'notes' },
        { name: 'autre', labelText: { fr: '<b>Autre</b> précision' }, required: true },
      ],
    },
  };

  test('lists, for one form, each youth missing a required answer and which ones', async () => {
    const { reports } = setup();
    mockGetFormStructureByType.mockResolvedValue(STRUCTURE);
    mockGetFormSubmissionsByType.mockResolvedValue({
      success: true,
      data: [
        { participant_id: 1, first_name: 'Alex', last_name: 'Roy', submission_data: { nom_medecin: 'Dre Roy', has_allergies: 'oui', autre: 'x' } },
        { participant_id: 2, first_name: 'Noa', last_name: 'Roy', submission_data: { nom_medecin: '  ', has_allergies: 'no', autre: 'x' } },
        { participant_id: 3, first_name: 'Léa', last_name: 'Roy', submission_data: { nom_medecin: 'Dr X', has_allergies: 'no', autre: 'x' } },
        { participant_id: 4, first_name: 'Max', last_name: 'Roy', submission_data: { nom_medecin: 'Dr X', has_allergies: 'no' } },
      ],
    });

    await reports.loadReport('missing-fields', 'fiche_sante');

    expect(mockGetFormSubmissionsByType).toHaveBeenCalledWith('fiche_sante');
    expect(mockGetFormStructureByType).toHaveBeenCalledWith('fiche_sante');
    const content = document.getElementById('report-content');
    const cards = [...content.querySelectorAll('article.report-record')];
    // Alex answered allergies yes and left them blank; Noa left the doctor
    // blank; Max left the unit's own question blank; Léa answered everything.
    expect(cards.map((card) => card.querySelector('h3').textContent)).toEqual(['Alex Roy', 'Noa Roy', 'Max Roy']);
    expect(cards[0].querySelector('dd').textContent).toBe('allergies');
    expect(cards[1].querySelector('dd').textContent).toBe('nom_medecin_label');
    // A label the unit wrote is shown as plain text in the reader's language.
    expect(cards[2].querySelector('dd').textContent).toBe('Autre précision');
    expect(content.querySelector('b')).toBeNull();
    expect(content.querySelector('.report-meta').textContent).toContain('3 / 4');
    expect(reports.currentReportData.map((row) => row.missing_fields)).toEqual(['allergies', 'nom_medecin_label', 'Autre précision']);

    const results = await axe.run(content, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('in an optional language, a field the unit labelled only in its fallback language shows that label', () => {
    const { reports } = setup();
    reports.app.lang = 'uk';
    reports.app.fallbackLang = 'fr';
    reports.app.translations = { uk: {} };

    expect(reports.formFieldLabel({ name: 'autre', label: 'autre_key', labelText: { fr: 'Autre précision' } }))
      .toBe('Autre précision');
  });

  test('a field waiting on one option of a select is not missing when another option was chosen', () => {
    const { reports } = setup();
    const fields = [
      { name: 'transport', type: 'select', options: [{ value: '1' }, { value: 'yes' }], required: true },
      { name: 'details', required: true, dependsOn: { field: 'transport', value: 'yes' } },
    ];

    expect(reports.getMissingFields({ transport: '1' }, fields)).toEqual([]);
    expect(reports.getMissingFields({ transport: 'yes' }, fields).map((field) => field.name)).toEqual(['details']);
  });

  test('says so when every submission is complete', async () => {
    const { reports } = setup();
    mockGetFormStructureByType.mockResolvedValue(STRUCTURE);
    mockGetFormSubmissionsByType.mockResolvedValue({ success: true, data: [] });

    await reports.loadReport('missing-fields', 'fiche_sante');

    expect(document.getElementById('report-content').textContent).toContain('no_missing_fields');
  });

  test('a failed load is explained with a retry, not shown as a complete form', async () => {
    const { reports } = setup();
    mockGetFormStructureByType.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }));
    mockGetFormSubmissionsByType.mockResolvedValue({ success: true, data: [] });

    await reports.loadReport('missing-fields', 'fiche_sante');

    const content = document.getElementById('report-content');
    expect(content.querySelector('[role="alert"]')).not.toBeNull();
    expect(content.querySelector('#report-retry')).not.toBeNull();
    expect(content.textContent).not.toContain('no_missing_fields');
  });
});

describe('Report menu', () => {
  test('each category is a group of report buttons named after its heading, which axe accepts', async () => {
    const { reports } = setup();
    reports.render();

    const groups = [...document.querySelectorAll('.reports-menu-grid')];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      // A role="menu" of plain buttons promised arrow-key navigation it never had.
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')).toBe(group.closest('.report-category').querySelector('h2').textContent);
      expect(group.querySelectorAll('button.report-btn').length).toBeGreaterThan(0);
    }
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
