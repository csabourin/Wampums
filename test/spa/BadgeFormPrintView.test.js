/**
 * @jest-environment jsdom
 */

/**
 * The printed badge application form shows what the child typed and the
 * badge's name as text. A badge name comes from the unit's templates and the
 * other fields from the form, so markup in either must print literally.
 */

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/ajax-functions.js', () => ({
  getBadgeProgress: jest.fn(),
  saveBadgeProgress: jest.fn(),
  getCurrentStars: jest.fn(),
  fetchParticipant: jest.fn(),
  getBadgeSystemSettings: jest.fn()
}));

jest.mock('../../spa/utils/PrintUtils.js', () => ({
  openPrintWindow: jest.fn(),
  setPrintContent: jest.fn()
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  alert: jest.fn()
}));

jest.mock('../../spa/utils/DOMUtils.js', () => ({
  setContent: jest.fn()
}));

jest.mock('../../spa/utils/DateUtils.js', () => ({
  formatDate: (value) => String(value ?? '')
}));

import { BadgeForm } from '../../spa/badge_form.js';
import { openPrintWindow, setPrintContent } from '../../spa/utils/PrintUtils.js';

const CRAFTED_NAME = '<img src=x onerror=alert(1)>Kaa';

test('print view escapes the badge name, the typed fields and the child name', () => {
  openPrintWindow.mockReturnValue({ document: { close: jest.fn() }, print: jest.fn() });

  const form = new BadgeForm({ showMessage: jest.fn() });
  form.participant = { first_name: '<b>Max</b>', last_name: 'S' };
  form.formData = {
    badge_template_label: CRAFTED_NAME,
    objectif: '<style>body{display:none}</style>',
    description: 'a & b',
    raison: '<i>r</i>',
    date_obtention: '2026-01-27',
    fierte: false
  };

  form.renderPrintView();

  const html = setPrintContent.mock.calls[0][1];
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Kaa');
  expect(html).not.toContain(CRAFTED_NAME);
  expect(html).toContain('&lt;style&gt;body{display:none}&lt;/style&gt;');
  expect(html).toContain('&lt;b&gt;Max&lt;/b&gt; S');
  expect(html).toContain('a &amp; b');
  expect(html).toContain('&lt;i&gt;r&lt;/i&gt;');
});
