/**
 * @jest-environment jsdom
 *
 * Every screen names the browser tab after its heading, the skip link lands
 * on that heading, and focus follows the heading while a screen redraws it.
 */

import fs from 'fs';
import path from 'path';
import axe from 'axe-core';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const INDEX_HTML = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

/** Wait for MutationObserver callbacks, which run as microtasks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The body index.html ships, without its scripts. */
function loadShell() {
  const body = INDEX_HTML.match(/<body>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');
  document.documentElement.lang = 'en';
  document.title = 'Wampums';
  document.body.innerHTML = body;
}

let utils;

beforeEach(() => {
  jest.resetModules();
  loadShell();
  utils = require('../../spa/utils/PageFocusUtils.js');
});

afterEach(() => {
  utils.stopFollowingHeading();
});

function app() {
  return document.getElementById('app');
}

describe('page shell', () => {
  test('the skip link is the first thing in the Tab order and points at the page content', () => {
    const first = document.body.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    expect(first.classList.contains('skip-link')).toBe(true);
    expect(first.getAttribute('href')).toBe('#app');
    expect(app().getAttribute('tabindex')).toBe('-1');
  });

  test('the shell, with a screen drawn in it, has no WCAG A/AA violation', async () => {
    app().innerHTML = '<a href="/dashboard">Back</a><h1>Attendance</h1><p>Tonight</p>';
    const results = await axe.run(document.body, AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('the skip link speaks the page language', () => {
    const { localizeStaticChrome } = require('../../spa/utils/StaticChromeUtils.js');
    localizeStaticChrome((key) => `fr:${key}`);
    expect(document.querySelector('.skip-link').textContent).toBe('fr:skip_to_content');
  });
});

describe('document title', () => {
  test('names the tab after the screen heading', () => {
    app().innerHTML = '<h1>  Attendance\n  tonight </h1>';
    expect(utils.updateDocumentTitle('Scouts at your fingertips')).toBe('Attendance tonight - Wampums');
    expect(document.title).toBe('Attendance tonight - Wampums');
  });

  test('falls back to the app title when a screen has no heading', () => {
    app().innerHTML = '<p>Loading</p>';
    utils.updateDocumentTitle('Scouts at your fingertips');
    expect(document.title).toBe('Scouts at your fingertips - Wampums');
  });

  test('follows the heading when a screen draws it late', async () => {
    utils.initPageTitleSync(() => 'Scouts at your fingertips');
    expect(document.title).toBe('Scouts at your fingertips - Wampums');

    app().innerHTML = '<h1>Badges</h1>';
    await flush();
    expect(document.title).toBe('Badges - Wampums');

    app().querySelector('h1').textContent = 'Honours';
    await flush();
    expect(document.title).toBe('Honours - Wampums');
  });

  test('a name with markup in a heading stays text in the title', async () => {
    utils.initPageTitleSync(() => 'Wampums');
    const heading = document.createElement('h1');
    heading.textContent = '<img src=x onerror=alert(1)>';
    app().replaceChildren(heading);
    await flush();
    expect(document.title).toBe('<img src=x onerror=alert(1)> - Wampums');
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('focus at the start of a screen', () => {
  test('moves to the heading without adding it to the Tab order', () => {
    app().innerHTML = '<h1>Attendance</h1><button type="button">Save</button>';
    expect(utils.focusPageStart()).toBe(true);
    const heading = app().querySelector('h1');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  test('moves to the page root when the screen has no heading', () => {
    app().innerHTML = '<p>Nothing here</p>';
    utils.focusPageStart();
    expect(document.activeElement).toBe(app());
  });

  test('leaves focus on a field the new screen focused itself', () => {
    app().innerHTML = '<h1>Sign in</h1><label for="email">Email</label><input id="email">';
    const field = document.getElementById('email');
    field.focus();
    expect(utils.focusPageStart()).toBe(false);
    expect(document.activeElement).toBe(field);
  });

  test('does not mistake the link that was pressed for the screen\'s choice', () => {
    app().innerHTML = '<a href="/badges" id="tile">Badges</a><h1>Badges</h1>';
    const pressed = document.getElementById('tile');
    pressed.focus();
    utils.focusPageStart({ previousFocus: pressed });
    expect(document.activeElement).toBe(app().querySelector('h1'));
  });

  test('follows the heading when the screen replaces its loading state', async () => {
    app().innerHTML = '<h1>Badges</h1><p role="status">Loading</p>';
    utils.focusPageStart();

    app().innerHTML = '<h1>Badges</h1><ul><li>Fire</li></ul>';
    await flush();
    expect(document.activeElement).toBe(app().querySelector('h1'));
  });

  test('stops following once the person presses a key', async () => {
    app().innerHTML = '<h1>Badges</h1>';
    utils.focusPageStart();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

    app().innerHTML = '<h1>Badges</h1><ul><li>Fire</li></ul>';
    await flush();
    expect(document.activeElement).toBe(document.body);
  });
});

describe('skip link', () => {
  test('activating it puts focus on the screen heading, with Enter as with a click', () => {
    utils.initSkipLink();
    app().innerHTML = '<a href="/">Back</a><h1>Attendance</h1>';
    const link = document.querySelector('.skip-link');
    link.focus();

    // Enter on a link fires click in browsers; jsdom does not synthesise it.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(app().querySelector('h1'));
  });

  test('is wired once, however often start-up runs', () => {
    const link = document.querySelector('.skip-link');
    const spy = jest.spyOn(link, 'addEventListener');
    utils.initSkipLink();
    utils.initSkipLink();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
