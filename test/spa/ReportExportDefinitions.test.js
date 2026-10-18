/**
 * What each report writes in its CSV: the fields the API really returns
 * (`routes/reports.js`), written the way the report shows them.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

import {
  EXPORT_ERROR,
  buildReportExport,
  isAffirmativeAnswer,
} from '../../spa/modules/reports/reportExportDefinitions.js';
import { buildCSV } from '../../spa/utils/ExportUtils.js';

const helpers = {
  translate: (key) => key,
  lang: 'fr',
  formatDateShort: (date) => `D(${date})`,
  isoToDateString: (value) => String(value).slice(0, 10),
};

/**
 * @param {{columns: Array<Object>}} definition - Export definition
 * @param {Object} row - One report row
 * @returns {Array} The row's cells, as the export formats them
 */
function cells(definition, row) {
  return definition.columns.map((column) => (
    column.format ? column.format(row[column.key], row) : row[column.key]
  ));
}

/**
 * @param {string} type - Report type
 * @param {*} data - What the report loaded
 * @returns {{rows: Array<Object>, columns: Array<Object>}} The export, which must be possible
 */
function exportOf(type, data) {
  const definition = buildReportExport(type, data, helpers);
  expect(definition.error).toBeUndefined();
  return definition;
}

describe('yes and no answers', () => {
  test.each([true, 1, 'on', 'oui', 'Oui', '1', 'true', 'yes'])('%p reads as yes', (answer) => {
    expect(isAffirmativeAnswer(answer)).toBe(true);
  });

  test.each([false, 0, 'non', '0', '', null, undefined, 'off'])('%p reads as no', (answer) => {
    expect(isAffirmativeAnswer(answer)).toBe(false);
  });
});

describe('leave-alone and media reports', () => {
  test('the leave-alone export reads the answer the API sends, not a field that never exists', () => {
    const definition = exportOf('leave-alone', [
      { first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', can_leave_alone: 'oui' },
      { first_name: 'Sam', last_name: 'Roy', group_name: 'Rouge', can_leave_alone: null },
    ]);

    expect(cells(definition, definition.rows[0]).slice(3)).toEqual(['yes']);
    expect(cells(definition, definition.rows[1]).slice(3)).toEqual(['no']);
  });

  test('the media export reads the authorization the API sends', () => {
    const definition = exportOf('media-authorization', [
      { first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', media_authorized: 'on' },
    ]);

    expect(cells(definition, definition.rows[0])).toEqual(['Léa', 'Roy', 'Rouge', 'yes']);
  });
});

describe('attendance report', () => {
  const data = {
    success: true,
    data: [{
      first_name: 'Léa',
      last_name: 'Roy',
      group_name: 'Rouge',
      summary: { present: 3, absent: 1, late: 1, excused: 2 },
      attendance: [
        { date: '2026-09-10', status: 'present' },
        { date: '2026-09-17', status: 'late' },
      ],
    }],
  };

  test('totals come from the summary the API sends', () => {
    const definition = exportOf('attendance', data);
    const row = definition.rows[0];

    const labelled = Object.fromEntries(definition.columns.map((column, index) => [
      column.label,
      cells(definition, row)[index],
    ]));

    expect(labelled.total_days).toBe(7);
    expect(labelled.days_absent).toBe(1);
    expect(labelled.excused).toBe(2);
    expect(labelled.days_late).toBe(1);
  });

  test('there is one column per date, with the status of that day', () => {
    const definition = exportOf('attendance', data);
    const dateColumns = definition.columns.filter((column) => column.key.startsWith('date_'));

    expect(dateColumns.map((column) => column.label)).toEqual(['D(2026-09-10)', 'D(2026-09-17)']);
    expect(dateColumns.map((column) => column.format(null, definition.rows[0]))).toEqual(['present', 'late']);
  });

  test('an attendance report without participants cannot be exported', () => {
    expect(buildReportExport('attendance', { success: true, data: [] }, helpers).error)
      .toBe(EXPORT_ERROR.NO_DATA);
  });
});

describe('reports that used to be guessed', () => {
  test('the missing-documents export lists the forms that are missing', () => {
    const definition = exportOf('missing-documents', [
      { id: 1, first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', missing_forms: ['fiche_sante', 'acceptation_risque'] },
      { id: 2, first_name: 'Sam', last_name: 'Roy', group_name: 'Rouge', missing_forms: [] },
    ]);

    expect(cells(definition, definition.rows[0]).slice(3)).toEqual(['fiche_sante, acceptation_risque']);
    expect(cells(definition, definition.rows[1]).slice(3)).toEqual(['no_missing_documents']);
  });

  test('the points export names its columns and leaves out the internal id', () => {
    const definition = exportOf('points', [
      { id: 7, first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', total_points: 12, honors_count: 2 },
    ]);

    expect(definition.columns.map((column) => column.key)).toEqual([
      'first_name', 'last_name', 'group_name', 'total_points', 'honors_count',
    ]);
    expect(definition.columns.map((column) => column.label)).toContain('points');
  });

  test('the honors export keeps the recipients, which a guessed export dropped', () => {
    const definition = exportOf('honors', [
      { date: '2026-09-10', count: '2', recipients: ['Léa Roy', 'Sam Roy'] },
    ]);

    expect(cells(definition, definition.rows[0])).toEqual(['D(2026-09-10)', '2', 'Léa Roy, Sam Roy']);
  });

  test('a report nobody described is guessed without internal ids', () => {
    const definition = exportOf('something-new', [
      { id: 1, participant_id: 4, label: 'x', nested: { a: 1 }, total: 3 },
    ]);

    expect(definition.columns.map((column) => column.key)).toEqual(['label', 'total']);
  });
});

describe('allergy and health reports', () => {
  test('the allergy export falls back to the limitations when there is no note, as the report does', () => {
    const definition = exportOf('allergies', [
      { first_name: 'Léa', last_name: 'Roy', group_name: 'Rouge', allergies: 'Arachides', epipen: true, limitations: 'Pas de course' },
    ]);
    const row = cells(definition, definition.rows[0]);

    expect(row[definition.columns.findIndex((column) => column.key === 'notes')]).toBe('Pas de course');
    expect(row[definition.columns.findIndex((column) => column.key === 'epipen')]).toBe('yes');
  });

  test('the health export writes the emergency contacts on one line', () => {
    const definition = exportOf('health', [{
      first_name: 'Léa',
      last_name: 'Roy',
      emergency_contacts: [
        { name: 'Marie Roy', relationship: 'mère', phone_mobile: '819-555-0100' },
        { name: 'Paul Roy', phone_home: '819-555-0101' },
      ],
    }]);
    const row = cells(definition, definition.rows[0]);

    expect(row[definition.columns.findIndex((column) => column.key === 'emergency_contacts')])
      .toBe('Marie Roy mère 819-555-0100 | Paul Roy 819-555-0101');
  });

  test('the allergy CSV opens in columns in a French spreadsheet', () => {
    const definition = exportOf('allergies', [{
      first_name: 'Léa',
      last_name: 'Roy',
      group_name: 'Rouge',
      allergies: 'Arachides, noix',
      allergy_severity: 'Sévère',
      allergy_reaction: null,
      allergy_action: 'EpiPen',
      epipen: true,
      emergency_medication: 'EpiPen Jr',
      notes: null,
    }]);
    const [header, row] = buildCSV(definition.rows, definition.columns, { lang: 'fr' })
      .replace('﻿', '')
      .trim()
      .split('\r\n');

    expect(header.split(';')).toHaveLength(10);
    expect(row.split(';')).toEqual([
      'Léa', 'Roy', 'Rouge', 'Arachides, noix', 'Sévère', '', 'EpiPen', 'yes', 'EpiPen Jr', '',
    ]);
  });
});

describe('nothing to export', () => {
  test.each([null, undefined, []])('a report holding %p cannot be exported', (data) => {
    expect(buildReportExport('allergies', data, helpers).error).toBe(EXPORT_ERROR.NO_DATA);
  });

  test('rows that are not records cannot be exported for a report nobody described', () => {
    expect(buildReportExport('something-new', ['a', 'b'], helpers).error).toBe(EXPORT_ERROR.UNSUPPORTED);
  });
});
