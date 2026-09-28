/**
 * @jest-environment jsdom
 */

/**
 * Phone and email links are touch targets.
 *
 * They are tapped to call or write a family, often on a phone and in a hurry
 * (the emergency contact list, the health record). Each must be at least the
 * app's touch-target minimum (44px, WCAG 2.5.8 and the project rule) in both
 * directions. jsdom does not lay out, so this reads the rule itself; the
 * rendered size was measured in a browser when the rule was written.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

import { createPhoneLink } from '../../spa/utils/PhoneUtils.js';
import { createEmailLink } from '../../spa/utils/EmailUtils.js';

// Comments stripped, so one sitting above a rule does not stick to its selector.
const STYLES = readFileSync(path.join(__dirname, '../../css/styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Declarations of every top-level rule whose selector list contains the class.
 *
 * @param {string} className - Class without the dot
 * @returns {string} The declarations, concatenated
 */
function declarationsFor(className) {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let found = '';
  let match;
  while ((match = rule.exec(STYLES)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (selectors.includes(`.${className}`)) {
      found += match[2];
    }
  }
  return found;
}

describe.each(['phone-link', 'email-link'])('.%s', (className) => {
  test('is at least the touch-target minimum in both directions', () => {
    const declarations = declarationsFor(className);

    expect(declarations).toMatch(/min-block-size:\s*var\(--touch-target-min\)/);
    expect(declarations).toMatch(/min-inline-size:\s*var\(--touch-target-min\)/);
    expect(declarations).toMatch(/display:\s*inline-(flex|block)/);
  });
});

test('the touch-target minimum is 44px', () => {
  expect(STYLES).toMatch(/--touch-target-min:\s*44px/);
});

test('the phone and email helpers produce links carrying those classes', () => {
  const container = document.createElement('div');
  container.insertAdjacentHTML('beforeend', createPhoneLink('819-555-0101'));
  container.insertAdjacentHTML('beforeend', createEmailLink('parent@example.test'));

  const phone = container.querySelector('a.phone-link');
  const email = container.querySelector('a.email-link');
  expect(phone.getAttribute('href')).toMatch(/^tel:/);
  expect(email.getAttribute('href')).toBe('mailto:parent@example.test');
  expect(phone.textContent.trim()).not.toBe('');
  expect(email.textContent.trim()).not.toBe('');
});
