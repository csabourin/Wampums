/**
 * @jest-environment jsdom
 *
 * The "Mon compte" section that gives a person a private calendar link: shown
 * once when made, then summarised; replaced or turned off on confirmation.
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', TIME_FORMAT: { DEFAULT: '24h' }, STORAGE_KEYS: {} },
  getStorageKey: (key) => key,
}));
jest.mock('../../spa/api/api-calendar-feed.js', () => ({
  getCalendarFeedStatus: jest.fn(),
  createCalendarFeed: jest.fn(),
  revokeCalendarFeed: jest.fn(),
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirm: jest.fn(() => Promise.resolve(true)),
  confirmDestructive: jest.fn(() => Promise.resolve(true)),
}));
let mockDemo = false;
const mockSession = { userId: 'user-1', organizationId: 3 };
jest.mock('../../spa/jwt-helper.js', () => ({
  getUserInfoFromJWT: () => ({ userId: mockSession.userId }),
  getOrganizationIdFromJWT: () => mockSession.organizationId,
}));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ isDemoUser: () => mockDemo }));

const api = require('../../spa/api/api-calendar-feed.js');
const { confirm, confirmDestructive } = require('../../spa/utils/DialogUtils.js');
const { CalendarFeedPanel } = require('../../spa/modules/calendar-feed/CalendarFeedPanel.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};
const LINK = {
  url: 'https://unit.example.org/api/v1/calendar-feeds/AbC_123.ics',
  webcal_url: 'webcal://unit.example.org/api/v1/calendar-feeds/AbC_123.ics',
  created_at: '2026-10-16T10:00:00Z',
};
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let app;

/** @returns {HTMLElement} The section the account page gives the panel */
function section() {
  return document.getElementById('calendar-feed');
}

/**
 * Mount a panel the way the account page does.
 * @param {Object} status - What the server says about the person's link
 * @returns {Promise<CalendarFeedPanel>}
 */
async function mountWith(status) {
  api.getCalendarFeedStatus.mockResolvedValue({ data: status });
  const panel = new CalendarFeedPanel(app);
  await panel.mount(section());
  return panel;
}

/** @param {string} action - data-calendar-feed value */
function button(action) {
  return section().querySelector(`[data-calendar-feed="${action}"]`);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDemo = false;
  mockSession.userId = 'user-1';
  mockSession.organizationId = 3;
  confirm.mockResolvedValue(true);
  confirmDestructive.mockResolvedValue(true);
  app = { lang: 'fr', showMessage: jest.fn() };
  document.body.innerHTML = '<main id="app"><section id="calendar-feed" aria-labelledby="calendar-feed-heading"></section></main>';
  window.history.replaceState(null, '', '/account-info');
});

test('says it is checking, then offers to create a link when there is none', async () => {
  let answer;
  api.getCalendarFeedStatus.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  const panel = new CalendarFeedPanel(app);
  const mounting = panel.mount(section());

  expect(section().querySelector('[role="status"]').textContent).toBe('loading');
  answer({ data: { active: false } });
  await mounting;

  expect(section().querySelector('h2').textContent).toBe('calendar_feed_title');
  expect(button('create').tagName).toBe('BUTTON');
  expect(button('create').textContent.trim()).toBe('calendar_feed_create');
});

test('a new link is shown once, in a labelled field that takes focus, with a way to open it', async () => {
  await mountWith({ active: false });
  api.createCalendarFeed.mockResolvedValue({ data: LINK });

  button('create').click();
  await flush();

  const field = document.getElementById('calendar-feed-url');
  expect(field.value).toBe(LINK.url);
  expect(field.readOnly).toBe(true);
  expect(section().querySelector('label[for="calendar-feed-url"]').textContent).toBe('calendar_feed_url_label');
  expect(field.getAttribute('aria-describedby')).toBe('calendar-feed-once');
  expect(document.activeElement).toBe(field);
  expect(button('open')).not.toBeNull();
  expect(app.showMessage).toHaveBeenCalledWith('calendar_feed_created', 'success');
});

test('the link is copied, and says so; when the browser refuses, it is selected for the person to copy', async () => {
  await mountWith({ active: false });
  api.createCalendarFeed.mockResolvedValue({ data: LINK });
  button('create').click();
  await flush();

  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn(() => Promise.resolve()) } });
  button('copy').click();
  await flush();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINK.url);
  expect(document.getElementById('calendar-feed-copy-status').textContent).toBe('calendar_feed_copied');

  navigator.clipboard.writeText.mockRejectedValueOnce(new Error('denied'));
  button('copy').click();
  await flush();
  expect(document.activeElement).toBe(document.getElementById('calendar-feed-url'));
  expect(document.getElementById('calendar-feed-copy-status').textContent).toBe('calendar_feed_copy_failed');
});

test('an existing link is summarised with its dates, since it is no longer shown', async () => {
  await mountWith({ active: true, created_at: '2026-09-01T12:00:00Z', last_used_at: null });

  const summary = section().textContent;
  expect(summary).toContain('calendar_feed_active');
  expect(document.getElementById('calendar-feed-url')).toBeNull();
  expect(button('create').textContent.trim()).toBe('calendar_feed_recreate');
  expect(button('revoke')).not.toBeNull();
});

test('replacing a link asks first, and declining changes nothing', async () => {
  await mountWith({ active: true, created_at: '2026-09-01T12:00:00Z', last_used_at: '2026-10-15T08:00:00Z' });
  confirm.mockResolvedValueOnce(false);

  button('create').click();
  await flush();

  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'calendar_feed_recreate_confirm_title' }));
  expect(api.createCalendarFeed).not.toHaveBeenCalled();
});

test('turning the link off asks first, then offers to create one again', async () => {
  await mountWith({ active: true, created_at: '2026-09-01T12:00:00Z' });
  confirmDestructive.mockResolvedValueOnce(false);
  button('revoke').click();
  await flush();
  expect(api.revokeCalendarFeed).not.toHaveBeenCalled();

  api.revokeCalendarFeed.mockResolvedValue({ data: { revoked: true } });
  button('revoke').click();
  await flush();

  expect(api.revokeCalendarFeed).toHaveBeenCalledTimes(1);
  expect(button('create').textContent.trim()).toBe('calendar_feed_create');
  expect(document.activeElement).toBe(button('create'));
  expect(app.showMessage).toHaveBeenCalledWith('calendar_feed_revoked', 'success');
});

test('a refused creation reads as a refusal and shows no link', async () => {
  await mountWith({ active: false });
  api.createCalendarFeed.mockRejectedValue(Object.assign(new Error('Insufficient permissions'), { status: 403 }));

  button('create').click();
  await flush();

  expect(app.showMessage).toHaveBeenCalledWith('api_error_forbidden', 'error');
  expect(document.getElementById('calendar-feed-url')).toBeNull();
  expect(document.body.textContent).not.toContain('Insufficient permissions');
});

test('a failed check says so in the page, and retry checks again', async () => {
  api.getCalendarFeedStatus.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 503 }));
  const panel = new CalendarFeedPanel(app);
  await panel.mount(section());
  expect(section().querySelector('[role="alert"]')).not.toBeNull();

  api.getCalendarFeedStatus.mockResolvedValue({ data: { active: false } });
  button('retry').click();
  await flush();

  expect(section().querySelector('[role="alert"]')).toBeNull();
  expect(button('create')).not.toBeNull();
});

test('a demo account is told it cannot create a link, and offered no button', async () => {
  mockDemo = true;
  await mountWith({ active: false });

  expect(section().textContent).toContain('calendar_feed_demo');
  expect(section().querySelector('button')).toBeNull();
});

test('the account page redrawing itself keeps the link on display', async () => {
  const panel = await mountWith({ active: false });
  api.createCalendarFeed.mockResolvedValue({ data: LINK });
  button('create').click();
  await flush();

  document.body.innerHTML = '<main id="app"><section id="calendar-feed"></section></main>';
  await panel.mount(section());

  expect(document.getElementById('calendar-feed-url').value).toBe(LINK.url);
  expect(api.getCalendarFeedStatus).toHaveBeenCalledTimes(1);
});

test('a link made after the person left the page is shown when they come back, and only to them', async () => {
  const panel = await mountWith({ active: false });
  let answer;
  api.createCalendarFeed.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
  button('create').click();
  await flush();

  panel.destroy();
  answer({ data: LINK });
  await flush();

  // Someone else signed in on this tab does not get it.
  mockSession.userId = 'user-2';
  const stranger = await mountWith({ active: false });
  expect(document.getElementById('calendar-feed-url')).toBeNull();
  stranger.destroy();

  mockSession.userId = 'user-1';
  document.body.innerHTML = '<main id="app"><section id="calendar-feed"></section></main>';
  await mountWith({ active: true, created_at: LINK.created_at });
  expect(document.getElementById('calendar-feed-url').value).toBe(LINK.url);

  // Shown once: a later visit summarises it like any earlier link.
  document.body.innerHTML = '<main id="app"><section id="calendar-feed"></section></main>';
  await mountWith({ active: true, created_at: LINK.created_at });
  expect(document.getElementById('calendar-feed-url')).toBeNull();
});

test('a link with markup characters stays a value, not markup', async () => {
  await mountWith({ active: false });
  const hostile = { ...LINK, url: 'https://x.test/"><img src=x onerror=alert(1)>.ics' };
  api.createCalendarFeed.mockResolvedValue({ data: hostile });
  button('create').click();
  await flush();

  expect(document.getElementById('calendar-feed-url').value).toBe(hostile.url);
  expect(section().querySelector('img')).toBeNull();
});

test('opened at #calendar-feed, the section is brought into view and takes focus', async () => {
  window.history.replaceState(null, '', '/account-info#calendar-feed');
  Element.prototype.scrollIntoView = jest.fn();
  await mountWith({ active: false });

  expect(document.activeElement).toBe(section().querySelector('h2'));
});

test.each([
  ['without a link', { active: false }, false],
  ['with a new link', { active: false }, true],
  ['with an earlier link', { active: true, created_at: '2026-09-01T12:00:00Z' }, false],
])('has no WCAG A/AA violations %s', async (_label, status, create) => {
  await mountWith(status);
  if (create) {
    api.createCalendarFeed.mockResolvedValue({ data: LINK });
    button('create').click();
    await flush();
  }
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
