/** @jest-environment jsdom */
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/modules/dashboard/Dashboard.js', () => ({ Dashboard: jest.fn() }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), isDebugMode: () => false,
}));
jest.mock('../../spa/utils/ScrollMemory.js', () => ({ initScrollMemory: jest.fn() }));

import { initRouter, Router } from '../../spa/router.js';

let route;
let pushState;

beforeAll(() => {
  route = jest.spyOn(Router.prototype, 'route').mockResolvedValue();
  pushState = jest.spyOn(history, 'pushState').mockImplementation(() => {});
  initRouter({ isLoggedIn: false });
});

beforeEach(() => {
  jest.clearAllMocks();
  document.body.replaceChildren();
});

afterAll(() => jest.restoreAllMocks());

/** Capture the router's decision, then suppress jsdom's browser navigation. */
function clickLink(href, attributes = {}, modifiers = {}) {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  for (const [key, value] of Object.entries(attributes)) {anchor.setAttribute(key, value);}
  const child = document.createElement('span');
  anchor.append(child);
  document.body.append(anchor);
  let prevented;
  const stopNavigation = (event) => {
    prevented = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('click', stopNavigation, { once: true });
  child.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers }));
  return prevented;
}

test.each([
  'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\nscript:alert(1)',
  'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd',
])('an unsafe link is blocked before browser navigation: %s', (href) => {
  expect(clickLink(href)).toBe(true);
  expect(route).not.toHaveBeenCalled();
  expect(pushState).not.toHaveBeenCalled();
});

test.each([
  [{ target: '_blank' }, {}], [{ download: '' }, {}], [{}, { ctrlKey: true }],
])('an unsafe link stays blocked with browser options %j %j', (attributes, modifiers) => {
  expect(clickLink('javascript:alert(1)', attributes, modifiers)).toBe(true);
  expect(route).not.toHaveBeenCalled();
});

test.each([
  ['https://example.com/path', {}, {}], ['mailto:leader@example.com', {}, {}],
  ['tel:+15145550123', {}, {}], ['blob:http://localhost/photo', {}, {}],
  ['#details', {}, {}], ['/attendance', { target: '_blank' }, {}],
  ['/attendance', { download: '' }, {}], ['/attendance', {}, { ctrlKey: true }],
])('a supported browser link keeps its default behavior: %s', (href, attributes, modifiers) => {
  expect(clickLink(href, attributes, modifiers)).toBe(false);
  expect(route).not.toHaveBeenCalled();
  expect(pushState).not.toHaveBeenCalled();
});

test('an internal link preserves its query and fragment when routing', () => {
  expect(clickLink('/finance?tab=reports#totals')).toBe(true);
  expect(pushState).toHaveBeenCalledWith(null, '', '/finance?tab=reports#totals');
  expect(route).toHaveBeenCalledWith('/finance?tab=reports');
});
