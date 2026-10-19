/**
 * @jest-environment jsdom
 */

/**
 * The points bar fixed at the bottom of "Manage points".
 *
 * Held here: each button awards what it says, once per press, even when
 * pressed twice while the first award is being saved; the other values sit in
 * a menu driven by the arrow keys, Escape and outside clicks, returning focus
 * to its toggle; the game result opens a dialog whose choice awards its
 * points and returns focus; each award is announced; and nothing answers
 * after the bar is destroyed.
 *
 * @module test/spa/PointActionBar
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { UI: { POINT_FEEDBACK_DURATION: 1500 } },
}));

const { PointActionBar } = require('../../spa/modules/points/PointActionBar.js');
const { closeAllModals } = require('../../spa/utils/ModalUtils.js');
const { setContent } = require('../../spa/utils/DOMUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * @param {HTMLElement} target - Where the key is pressed
 * @param {string} key - Key name
 * @returns {KeyboardEvent} The dispatched event
 */
function press(target, key) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

let bar;
let onAction;

/** @returns {HTMLElement} The bar's root */
function root() {
  return document.getElementById('points-action-bar');
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"><h1>Points</h1></main>';
  onAction = jest.fn(() => Promise.resolve());
  bar = new PointActionBar({ onAction });
  const app = document.getElementById('app');
  setContent(app, `<h1>Points</h1>${bar.render()}`);
  bar.mount(root(), app);
});

afterEach(() => {
  bar.destroy();
  closeAllModals();
  jest.useRealTimers();
});

describe('awarding points', () => {
  test('the main buttons award one point and take one back', async () => {
    const [reward, correction] = root().querySelectorAll('.point-split-action__main');

    reward.click();
    await flush();
    correction.click();
    await flush();

    expect(onAction.mock.calls.map(([points]) => points)).toEqual([1, -1]);
  });

  test('a second press while the first award is saving does not award twice', async () => {
    let finish;
    onAction.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const reward = root().querySelector('.point-split-action__main');

    reward.click();
    reward.click();
    await flush();

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(reward.disabled).toBe(true);
    expect(reward.getAttribute('aria-busy')).toBe('true');

    finish();
    await flush();
    expect(reward.disabled).toBe(false);
    expect(reward.hasAttribute('aria-busy')).toBe(false);
  });

  test('each award is announced in a live region', () => {
    bar.showFeedback(3, '3 points for Léa');

    const feedback = root().querySelector('#points-action-feedback');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.querySelector('.points-action-feedback__announcement').textContent).toBe('3 points for Léa');
    expect(feedback.querySelector('.points-action-feedback__visual').getAttribute('aria-hidden')).toBe('true');
  });

  test('the selection summary is spoken when it changes', () => {
    bar.updateSelection('2 selected');

    const summary = root().querySelector('#points-selection-summary');
    expect(summary.getAttribute('aria-live')).toBe('polite');
    expect(summary.textContent).toBe('2 selected');
  });
});

describe('the other values menu', () => {
  test('opening it moves focus in; arrows, Home and End move between values and wrap', () => {
    const toggle = root().querySelector('[data-point-menu-toggle="reward"]');
    const menu = document.getElementById('reward-values-menu');

    toggle.click();

    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);

    press(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(document.activeElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press(items[0], 'End');
    expect(document.activeElement).toBe(items[items.length - 1]);
    press(document.activeElement, 'Home');
    expect(document.activeElement).toBe(items[0]);
  });

  test('Escape closes it and returns focus to its toggle, awarding nothing', () => {
    const toggle = root().querySelector('[data-point-menu-toggle="correction"]');
    toggle.click();

    press(document.activeElement, 'Escape');

    expect(document.getElementById('correction-values-menu').hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
    expect(onAction).not.toHaveBeenCalled();
  });

  test('choosing a value awards it, closes the menu and returns focus to the toggle', async () => {
    const toggle = root().querySelector('[data-point-menu-toggle="correction"]');
    toggle.click();

    document.querySelector('#correction-values-menu [data-points="-3"]').click();
    await flush();

    expect(onAction).toHaveBeenCalledWith(-3, expect.any(HTMLElement));
    expect(document.getElementById('correction-values-menu').hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  test('a press outside closes it', () => {
    root().querySelector('[data-point-menu-toggle="reward"]').click();

    document.querySelector('h1').dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(document.getElementById('reward-values-menu').hidden).toBe(true);
  });

  test('the bar with its menu open meets WCAG A/AA', async () => {
    root().querySelector('[data-point-menu-toggle="reward"]').click();

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

describe('the game result dialog', () => {
  test('opens on its first place, awards the chosen place and returns focus', async () => {
    const trigger = document.getElementById('points-game-result-trigger');

    trigger.click();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(dialog.querySelector('[data-game-result]'));

    dialog.querySelector('[data-game-result][data-points="4"]').click();
    await flush();

    expect(onAction).toHaveBeenCalledWith(4, expect.any(HTMLElement));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  test('the dialog meets WCAG A/AA', async () => {
    document.getElementById('points-game-result-trigger').click();

    const results = await axe.run(document.querySelector('.modal-overlay'), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});

test('after the bar is destroyed, its buttons award nothing', async () => {
  const reward = root().querySelector('.point-split-action__main');

  bar.destroy();
  reward.click();
  await flush();

  expect(onAction).not.toHaveBeenCalled();
});
