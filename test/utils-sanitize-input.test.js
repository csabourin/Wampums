/**
 * Unit tests for sanitizeInput in utils/index.js
 *
 * Covers the security-sensitive behaviors introduced in the recent change:
 * - Incomplete tags strip everything from the opening '<' to end-of-string
 * - Nested-tag reconstruction is prevented
 * - Input is hard-truncated at MAX_SANITIZE_INPUT_LENGTH (10,000 chars)
 *
 * @module test/utils-sanitize-input
 */

// Mock heavy external dependencies so the utility module can be loaded in isolation
jest.mock('sib-api-v3-sdk', () => {
  const instance = {
    authentications: { 'api-key': { apiKey: null } }
  };
  return {
    ApiClient: { instance },
    TransactionalEmailsApi: jest.fn(() => ({}))
  };
}, { virtual: true });

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(() => ({ sendMail: jest.fn() }))
}), { virtual: true });

jest.mock('winston', () => {
  const format = { json: jest.fn(() => ({})), combine: jest.fn(() => ({})) };
  const transport = function () {};
  transport.prototype = {};
  const transports = {
    File: jest.fn(() => ({})),
    Console: jest.fn(() => ({}))
  };
  return {
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    })),
    format,
    transports
  };
}, { virtual: true });

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn()
}));

jest.mock('../utils/api-helpers', () => ({
  getDefaultPointSystemRules: jest.fn(() => ({})),
  escapeHtml: jest.fn((s) => s),
  getOrganizationId: jest.fn()
}));

jest.mock('../utils/jwt-config', () => ({
  verifyJWTToken: jest.fn()
}));

const { sanitizeInput } = require('../utils/index');

const MAX_LENGTH = 10000;

describe('sanitizeInput', () => {
  // ──────────────────────────────────────────────────────────────
  // Basic pass-through behaviour
  // ──────────────────────────────────────────────────────────────
  describe('basic sanitization', () => {
    it('returns empty string for null', () => {
      expect(sanitizeInput(null)).toBe('');
    });

    it('returns empty string for undefined', () => {
      expect(sanitizeInput(undefined)).toBe('');
    });

    it('passes plain text through unchanged', () => {
      expect(sanitizeInput('Hello, world!')).toBe('Hello, world!');
    });

    it('trims leading and trailing whitespace', () => {
      expect(sanitizeInput('  hello  ')).toBe('hello');
    });

    it('removes a complete HTML tag and returns inner text', () => {
      expect(sanitizeInput('<b>bold</b>')).toBe('bold');
    });

    it('removes script tags completely', () => {
      expect(sanitizeInput('<script>alert(1)</script>')).toBe('alert(1)');
    });

    it('removes multiple tags and preserves text between them', () => {
      expect(sanitizeInput('<p>Hello</p> <em>world</em>')).toBe('Hello world');
    });

    it('stringifies a number input', () => {
      expect(sanitizeInput(42)).toBe('42');
    });

    it('stringifies a boolean input', () => {
      expect(sanitizeInput(true)).toBe('true');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Incomplete tag → strip to end-of-string
  // ──────────────────────────────────────────────────────────────
  describe('incomplete tag strips to end-of-string', () => {
    it('drops everything from an unclosed "<" to the end of the string', () => {
      expect(sanitizeInput('hello <script')).toBe('hello');
    });

    it('drops trailing text after an unclosed tag with attributes', () => {
      expect(sanitizeInput('safe text <img src=')).toBe('safe text');
    });

    it('handles a string that is entirely an unclosed tag', () => {
      expect(sanitizeInput('<script')).toBe('');
    });

    it('handles a lone "<" at the end', () => {
      expect(sanitizeInput('text<')).toBe('text');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Nested-tag reconstruction prevention
  // ──────────────────────────────────────────────────────────────
  describe('nested-tag reconstruction prevention', () => {
    it('treats "<<script>>" as two nested tags and strips both', () => {
      // First '<' skips up to first '>': skips "<<script"
      // Second part continues from after '>' — the trailing '>' is a plain char
      // but the outer '<' at position 0 consumes up to the first '>' (index 8)
      // so the remaining string starts right after: '>alert(1)</script>'
      // then '>' is a plain char pushed to output; then 'alert(1)' is pushed;
      // then '</script>' tag is stripped.
      const out = sanitizeInput('<<script>alert(1)</script>');
      // The important invariant: no executable '<script' survives
      expect(out).not.toContain('<script');
      expect(out).not.toContain('</script>');
    });

    it('strips a tag-splitting attempt with nested angle brackets', () => {
      const out = sanitizeInput('<<img src=x onerror=alert(1)>>');
      expect(out).not.toContain('<img');
      expect(out).not.toContain('onerror');
    });

    it('handles deeply nested angle brackets without reconstructing a tag', () => {
      const out = sanitizeInput('safe <<<b>>> text');
      expect(out).not.toContain('<b>');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Length cap at MAX_SANITIZE_INPUT_LENGTH (10,000)
  // ──────────────────────────────────────────────────────────────
  describe('length cap', () => {
    it('passes through input that is exactly MAX_LENGTH characters', () => {
      const input = 'a'.repeat(MAX_LENGTH);
      expect(sanitizeInput(input)).toBe(input);
    });

    it('silently truncates input longer than MAX_LENGTH before sanitizing', () => {
      const input = 'a'.repeat(MAX_LENGTH + 500);
      const result = sanitizeInput(input);
      // The truncated-then-sanitized result should not exceed MAX_LENGTH
      expect(result.length).toBeLessThanOrEqual(MAX_LENGTH);
    });

    it('correctly sanitizes tags within the first MAX_LENGTH characters and discards the rest', () => {
      // Build a string where a tag spans the boundary
      const prefix = 'a'.repeat(MAX_LENGTH - 3); // 9997 'a' chars
      const input = `${prefix}<b>extra content beyond limit</b>`;
      const result = sanitizeInput(input);
      // Content before the tag should be preserved
      expect(result.startsWith('a'.repeat(MAX_LENGTH - 3))).toBe(true);
      // The fragment "<b>" is sliced in the middle — the '<' at position 9997
      // starts a tag that extends beyond the 10000-char slice, so it is treated
      // as an incomplete tag and stripped to end-of-string.
      expect(result).not.toContain('<b>');
      expect(result.length).toBeLessThanOrEqual(MAX_LENGTH);
    });

    it('handles input beyond MAX_LENGTH that contains only HTML tags', () => {
      const input = '<b>'.repeat(MAX_LENGTH);
      const result = sanitizeInput(input);
      expect(result).toBe('');
    });
  });
});
