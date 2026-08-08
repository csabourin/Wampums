/**
 * @jest-environment jsdom
 *
 * Body scroll locking.
 *
 * Two reported bugs shared one cause: an overlay locked body scrolling and the
 * lock outlived the overlay when the user left by any route other than the
 * modal's own close button. The dashboard could no longer be scrolled after
 * visiting a report, and the seniority report opened unscrollable.
 */

import {
  lockBodyScroll,
  unlockBodyScroll,
  releaseAllScrollLocks,
  isBodyScrollLocked,
} from '../../spa/utils/ScrollLockUtils.js';

beforeEach(() => {
  releaseAllScrollLocks();
  document.body.style.removeProperty('overflow');
  document.body.className = '';
});

test('locking stops the page behind the overlay from scrolling', () => {
  lockBodyScroll('reports:report-modal');

  expect(document.body.style.overflow).toBe('hidden');
  expect(document.body.classList.contains('modal-open')).toBe(true);
  expect(isBodyScrollLocked()).toBe(true);
});

test('unlocking restores scrolling', () => {
  lockBodyScroll('reports:report-modal');
  unlockBodyScroll('reports:report-modal');

  expect(document.body.style.overflow).toBe('');
  expect(document.body.classList.contains('modal-open')).toBe(false);
  expect(isBodyScrollLocked()).toBe(false);
});

test('one overlay closing does not unlock the page for another still open', () => {
  lockBodyScroll('inventory:overlay');
  lockBodyScroll('badge-tracker:modal');

  unlockBodyScroll('badge-tracker:modal');

  expect(isBodyScrollLocked()).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');

  unlockBodyScroll('inventory:overlay');
  expect(document.body.style.overflow).toBe('');
});

test('unlocking an owner that never locked is a no-op', () => {
  lockBodyScroll('reports:report-modal');
  unlockBodyScroll('some-other-screen');

  expect(isBodyScrollLocked()).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
});

test('locking twice for the same owner still needs only one unlock', () => {
  lockBodyScroll('reports:report-modal');
  lockBodyScroll('reports:report-modal');
  unlockBodyScroll('reports:report-modal');

  expect(isBodyScrollLocked()).toBe(false);
  expect(document.body.style.overflow).toBe('');
});

test('releaseAllScrollLocks frees the page whatever was holding it', () => {
  lockBodyScroll('reports:report-modal');
  lockBodyScroll('inventory:overlay');

  releaseAllScrollLocks();

  expect(isBodyScrollLocked()).toBe(false);
  expect(document.body.style.overflow).toBe('');
  expect(document.body.classList.contains('modal-open')).toBe(false);
});

test('an overflow value the page set itself is restored, not overwritten', () => {
  document.body.style.overflow = 'auto';

  lockBodyScroll('reports:report-modal');
  expect(document.body.style.overflow).toBe('hidden');

  unlockBodyScroll('reports:report-modal');
  expect(document.body.style.overflow).toBe('auto');
});
