/**
 * @jest-environment jsdom
 */

/**
 * Formatted texts that also exist as plain text (spa/utils/RichTextUtils.js):
 * what pages show and what the editor starts from.
 *
 * @module test/spa/RichTextUtils
 */

// DebugUtils reads import.meta, which Jest's CommonJS transform cannot parse.
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));

import {
  plainTextToRichText,
  richTextOrPlain,
  richTextToPlainText,
} from '../../spa/utils/RichTextUtils.js';

describe('richTextOrPlain', () => {
  test('shows the formatted text, sanitized', () => {
    expect(richTextOrPlain('<p>Hi <strong>all</strong><img src=x onerror="alert(1)"></p><script>alert(1)</script>', 'Hi all'))
      .toBe('<p>Hi <strong>all</strong></p>');
  });

  test('falls back to the plain text, escaped, with its line breaks', () => {
    expect(richTextOrPlain(null, 'One\nTwo <b>\n\nThree')).toBe('<p>One<br>Two &lt;b&gt;</p><p>Three</p>');
    expect(richTextOrPlain('<p><br></p>', 'Plain')).toBe('<p>Plain</p>');
    expect(richTextOrPlain(null, null)).toBe('');
  });
});

describe('richTextToPlainText', () => {
  test('keeps paragraphs, line breaks and list markers', () => {
    expect(richTextToPlainText('<p>Hello<br>families</p><ul><li>Boots</li><li>Hat</li></ul><ol><li>A<ol><li>B</li></ol></li></ol><p>End</p>'))
      .toBe('Hello\nfamilies\n\n- Boots\n- Hat\n\n1. A\n  1. B\n\nEnd');
  });

  test('is empty for text with nothing visible', () => {
    expect(richTextToPlainText('<p><br></p>')).toBe('');
    expect(richTextToPlainText('')).toBe('');
  });
});

test('plainTextToRichText escapes and makes paragraphs', () => {
  expect(plainTextToRichText('a\n<b>')).toBe('<p>a<br>&lt;b&gt;</p>');
});
