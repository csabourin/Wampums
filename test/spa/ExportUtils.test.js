/**
 * @jest-environment jsdom
 *
 * The CSV a leader downloads from a report: it must open in columns in the
 * spreadsheet the leader has, and a text typed by a parent must not run in it.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

import {
  buildCSV,
  csvDelimiterForLanguage,
  exportToCSV,
  safeFilename,
} from '../../spa/utils/ExportUtils.js';

const BOM = '﻿';
const COLUMNS = [
  { key: 'name', label: 'nom' },
  { key: 'note', label: 'note' },
];

/**
 * @param {Blob} blob - A downloaded file
 * @returns {Promise<string>} Its text (a reader drops the byte order mark)
 */
function readBlob(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
}

/**
 * @param {Blob} blob - A downloaded file
 * @returns {Promise<number[]>} Its first three bytes
 */
function firstBytes(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve([...new Uint8Array(reader.result).slice(0, 3)]);
    reader.readAsArrayBuffer(blob);
  });
}

describe('CSV delimiter', () => {
  test('a French file separates its columns with semicolons, so Excel opens it in columns', () => {
    expect(csvDelimiterForLanguage('fr')).toBe(';');
    expect(buildCSV([{ name: 'Léa', note: 'ok' }], COLUMNS, { lang: 'fr' }))
      .toBe(`${BOM}nom;note\r\nLéa;ok\r\n`);
  });

  test('an English file separates its columns with commas', () => {
    expect(csvDelimiterForLanguage('en')).toBe(',');
    expect(buildCSV([{ name: 'Lea', note: 'ok' }], COLUMNS, { lang: 'en' }))
      .toBe(`${BOM}nom,note\r\nLea,ok\r\n`);
  });

  test('the delimiter follows the page language when none is given', () => {
    document.documentElement.lang = 'fr';
    expect(buildCSV([{ name: 'Léa', note: 'ok' }], COLUMNS)).toContain('nom;note');
    document.documentElement.lang = 'en';
    expect(buildCSV([{ name: 'Lea', note: 'ok' }], COLUMNS)).toContain('nom,note');
  });
});

describe('CSV cells', () => {
  test('the file starts with a byte order mark so accents survive in Excel', () => {
    expect(buildCSV([{ name: 'Élise', note: '' }], COLUMNS, { lang: 'fr' }).startsWith(BOM)).toBe(true);
  });

  test('a cell holding the delimiter, a quote or a line break is quoted', () => {
    const csv = buildCSV([
      { name: 'a;b', note: 'dit "oui"' },
      { name: 'ligne 1\nligne 2', note: 'x' },
    ], COLUMNS, { lang: 'fr' });

    expect(csv).toContain('"a;b";"dit ""oui"""');
    expect(csv).toContain('"ligne 1\nligne 2";x');
  });

  test('a comma needs no quotes in a semicolon file, but does in a comma file', () => {
    const rows = [{ name: 'arachides, noix', note: 'x' }];
    expect(buildCSV(rows, COLUMNS, { lang: 'fr' })).toContain('arachides, noix;x');
    expect(buildCSV(rows, COLUMNS, { lang: 'en' })).toContain('"arachides, noix",x');
  });

  test('amounts are written with a decimal comma in a French file', () => {
    const csv = buildCSV([{ name: '12.50', note: '-3.75' }], COLUMNS, { lang: 'fr' });
    expect(csv).toContain('12,50;-3,75');
  });

  test('amounts keep their point in an English file', () => {
    expect(buildCSV([{ name: '12.50', note: '-3.75' }], COLUMNS, { lang: 'en' })).toContain('12.50,-3.75');
  });

  test('a missing value is an empty cell, not "undefined"', () => {
    const csv = buildCSV([{ name: null }], COLUMNS, { lang: 'fr' });
    expect(csv).toContain('\r\n;\r\n');
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
  });

  test('a column format decides what is written', () => {
    const csv = buildCSV(
      [{ name: 'Léa', note: true }],
      [COLUMNS[0], { key: 'note', label: 'note', format: (value) => (value ? 'oui' : 'non') }],
      { lang: 'fr' },
    );
    expect(csv).toContain('Léa;oui');
  });
});

describe('text typed by a parent', () => {
  test.each([
    '=HYPERLINK("http://example.com","clic")',
    '@SUM(1+1)',
    '+cmd|\' /C calc\'!A0',
    '-2+3',
  ])('%s stays text in the spreadsheet', (typed) => {
    const csv = buildCSV([{ name: 'Léa', note: typed }], COLUMNS, { delimiter: '\t' });
    const cell = csv.split('\r\n')[1].split('\t')[1].replace(/^"|"$/g, '').replace(/""/g, '"');
    expect(cell).toBe(`'${typed}`);
  });

  test.each([
    ['a negative amount', '-5'],
    ['a phone number', '+1 819 555-0100'],
    ['an ordinary note', 'allergique aux arachides'],
  ])('%s is written as it is', (_, typed) => {
    const csv = buildCSV([{ name: 'Léa', note: typed }], COLUMNS, { lang: 'en' });
    expect(csv).toContain(`Léa,${typed}`);
  });
});

describe('file name', () => {
  test('a name with spaces, commas and accents becomes a plain file name', () => {
    expect(safeFilename('allergies_report_Oct 18, 2026')).toBe('allergies_report_Oct_18_2026');
    expect(safeFilename('Rapport santé')).toBe('Rapport_sante');
  });

  test('an empty name still gives a file', () => {
    expect(safeFilename('')).toBe('export');
    expect(safeFilename('///')).toBe('export');
  });
});

describe('downloading', () => {
  let downloads;

  beforeEach(() => {
    downloads = [];
    URL.createObjectURL = jest.fn((blob) => {
      downloads.push({ blob });
      return 'blob:test';
    });
    URL.revokeObjectURL = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      downloads[downloads.length - 1].filename = this.getAttribute('download');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the file is named safely and holds the semicolon-separated rows', async () => {
    exportToCSV([{ name: 'Léa', note: 'ok' }], COLUMNS, 'allergies_report_2026-10-18', { lang: 'fr' });

    expect(downloads).toHaveLength(1);
    expect(downloads[0].filename).toBe('allergies_report_2026-10-18.csv');
    expect(await readBlob(downloads[0].blob)).toBe('nom;note\r\nLéa;ok\r\n');
    // EF BB BF: what makes Excel read the file as UTF-8.
    expect(await firstBytes(downloads[0].blob)).toEqual([0xEF, 0xBB, 0xBF]);
  });

  test('a name with spaces and commas is cleaned before the download', () => {
    exportToCSV([{ name: 'Léa', note: 'ok' }], COLUMNS, 'rapport Oct 18, 2026', { lang: 'fr' });
    expect(downloads[0].filename).toBe('rapport_Oct_18_2026.csv');
  });

  test('nothing is downloaded when there is nothing to export', () => {
    exportToCSV([], COLUMNS, 'vide', { lang: 'fr' });
    expect(downloads).toHaveLength(0);
  });
});
