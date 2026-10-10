/**
 * @jest-environment jsdom
 */

/**
 * The shared modal every screen uses: one markup, one keyboard and focus
 * behaviour. Screens rely on it for dialog semantics, so these are its
 * accessibility guarantees.
 *
 * @module test/spa/ModalUtils
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({
  translate: (key) => ({ close: 'Fermer' }[key] || key),
}));

const { openModal, closeModal, closeAllModals } = require('../../spa/utils/ModalUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/**
 * Press a key where focus is.
 * @param {string} key
 * @param {Object} [options]
 */
function press(key, options = {}) {
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
}

function openForm(options = {}) {
  return openModal({
    id: 'test-modal',
    title: 'Edit camp',
    body: '<form id="camp-form"><label for="camp-name">Name</label><input id="camp-name"></form>',
    footer: '<button type="button" data-modal-close>Cancel</button><button type="submit" form="camp-form" id="save">Save</button>',
    ...options,
  });
}

beforeEach(() => {
  closeAllModals();
  document.body.innerHTML = '<main><button id="opener">Open</button></main>';
  document.getElementById('opener').focus();
});

describe('openModal', () => {
  test('is a modal dialog named by its title, with a named close button', () => {
    const { dialog } = openForm();

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Edit camp');
    expect(dialog.querySelector('.modal-close').getAttribute('aria-label')).toBe('Fermer');
  });

  test('moves focus to the first enabled control, or to the one asked for', () => {
    openForm();
    expect(document.activeElement.id).toBe('camp-name');

    openForm({ initialFocus: '#save' });
    expect(document.activeElement.id).toBe('save');
  });

  test('skips disabled controls when choosing where focus starts', () => {
    openModal({ id: 'locked', title: 'Roles', body: '<input type="checkbox" id="a" disabled><input type="checkbox" id="b">' });
    expect(document.activeElement.id).toBe('b');
  });

  test('keeps Tab and Shift+Tab inside the dialog', () => {
    const { dialog } = openForm();
    const save = document.getElementById('save');
    save.focus();

    press('Tab');
    expect(document.activeElement).toBe(dialog.querySelector('.modal-close'));

    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(save);
  });

  test('Escape closes it and focus returns to the control that opened it', () => {
    const onClose = jest.fn();
    openForm({ onClose });

    press('Escape');

    expect(document.getElementById('test-modal')).toBeNull();
    expect(document.activeElement.id).toBe('opener');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the close and cancel buttons and the backdrop close it', () => {
    ['.modal-close', '[data-modal-close]:not(.modal-close)'].forEach((selector) => {
      const { overlay } = openForm();
      overlay.querySelector(selector).click();
      expect(document.getElementById('test-modal')).toBeNull();
    });

    const { overlay } = openForm();
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('test-modal')).toBeNull();
  });

  test('a backdrop click can be turned off for forms that would lose work', () => {
    const { overlay } = openForm({ closeOnBackdrop: false });
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('test-modal')).not.toBeNull();
  });

  test('canClose keeps it open while saving, but the code can still close it', () => {
    let saving = true;
    openForm({ canClose: () => !saving });

    press('Escape');
    expect(document.getElementById('test-modal')).not.toBeNull();

    closeModal('test-modal');
    expect(document.getElementById('test-modal')).toBeNull();
    saving = false;
  });

  test('with nested dialogs, Escape closes only the topmost', () => {
    openForm();
    openModal({ id: 'inner', title: 'Pick', body: '<button type="button" id="pick">Pick</button>' });

    press('Escape');

    expect(document.getElementById('inner')).toBeNull();
    expect(document.getElementById('test-modal')).not.toBeNull();
    expect(document.getElementById('test-modal').contains(document.activeElement)).toBe(true);
  });

  test('locks the page behind it until the last dialog closes', () => {
    openForm();
    expect(document.body.classList.contains('modal-open')).toBe(true);
    press('Escape');
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  test('closeAllModals, called when leaving a screen, closes every dialog', () => {
    openForm();
    openModal({ id: 'inner', title: 'Pick', body: '' });

    closeAllModals();

    expect(document.querySelector('.modal-overlay')).toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  test('has no WCAG A/AA violations', async () => {
    const { overlay } = openForm();
    const results = await axe.run(overlay, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
