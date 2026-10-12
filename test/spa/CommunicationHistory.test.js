/**
 * @jest-environment jsdom
 */

/**
 * "Messages and news": the history of sent messages and the unit's news, away
 * from the dashboard, each item archived out of sight and restored again.
 *
 * @module test/spa/CommunicationHistory
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canSendCommunications: jest.fn() }));
jest.mock('../../spa/utils/RoleLabelUtils.js', () => ({ roleLabel: (role) => role }));
jest.mock('../../spa/api/api-communication-history.js', () => ({
  getAnnouncementHistory: jest.fn(),
  getNewsHistory: jest.fn(),
  setAnnouncementArchived: jest.fn(),
  setNewsArchived: jest.fn(),
}));

const { canSendCommunications } = require('../../spa/utils/PermissionUtils.js');
const api = require('../../spa/api/api-communication-history.js');
const { CommunicationHistory } = require('../../spa/modules/communication-history/CommunicationHistory.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const HOSTILE = '<img src=x onerror=alert(1)>Camp';

const ANNOUNCEMENT = {
  id: 4,
  subject: HOSTILE,
  status: 'sent',
  recipient_roles: ['parent'],
  recipient_groups: [2],
  sent_at: '2026-10-10T18:00:00.000Z',
  created_at: '2026-10-10T17:00:00.000Z',
  logs: [
    { channel: 'email', status: 'sent', recipient_email: 'a@example.com' },
    { channel: 'email', status: 'failed', recipient_email: 'b@example.com', error_message: 'bounced' },
    { channel: 'push', status: 'sent', recipient_name: 'Alex' },
  ],
};

const NEWS = {
  id: 9,
  title: '<b>Camp</b> d’automne',
  content: 'Inscrivez-vous <script>alert(1)</script>',
  link: 'javascript:alert(1)',
  created_at: '2026-10-01T12:00:00.000Z',
};

const app = { lang: 'fr', showMessage: jest.fn() };

const click = (element) => element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const archiveButtons = () => Array.from(document.querySelectorAll('[data-archive-kind]'));

/** @returns {Promise<CommunicationHistory>} The screen, loaded */
async function open() {
  const screen = new CommunicationHistory(app);
  await screen.init();
  return screen;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
  canSendCommunications.mockReturnValue(true);
  api.getAnnouncementHistory.mockResolvedValue({
    success: true, data: [ANNOUNCEMENT], roles: [], groups: [{ id: 2, name: 'Tanière <i>Sud</i>' }],
  });
  api.getNewsHistory.mockResolvedValue({ success: true, data: [NEWS] });
  api.setAnnouncementArchived.mockResolvedValue({ success: true });
  api.setNewsArchived.mockResolvedValue({ success: true });
});

describe('the history', () => {
  test('opens with the back link, above the title', async () => {
    await open();

    const page = document.querySelector('.communication-history');
    expect(page.firstElementChild.getAttribute('href')).toBe('/dashboard');
    expect(page.querySelector('h1').textContent).toBe('communication_history_title');
  });

  test('lists the sent messages with who they went to and how they were delivered', async () => {
    await open();

    const item = document.querySelector('[data-announcement-id="4"]');
    expect(item.textContent).toContain('parent');
    expect(item.textContent).toContain('select_groups');
    expect(item.textContent).toContain('emails: 1');
    expect(item.textContent).toContain('failed: 1');
    expect(item.textContent).toContain('push_notifications: 1');
  });

  test('shows what people wrote as text, never as markup, and drops an unsafe link', async () => {
    await open();

    expect(document.querySelector('#app img')).toBeNull();
    expect(document.querySelector('#app script')).toBeNull();
    expect(document.querySelector('[data-announcement-id="4"] .news-title').textContent).toBe(HOSTILE);
    expect(document.querySelector('[data-news-id="9"] .news-title').textContent).toBe('<b>Camp</b> d’automne');
    expect(document.querySelector('[data-news-id="9"] .news-summary').textContent).toContain('<script>');
    expect(document.querySelector('[data-news-id="9"] a')).toBeNull();
    expect(document.querySelector('.announcement-details').innerHTML).toContain('&lt;i&gt;Sud&lt;/i&gt;');
  });

  test('says what would fill an empty list', async () => {
    api.getAnnouncementHistory.mockResolvedValue({ success: true, data: [] });
    api.getNewsHistory.mockResolvedValue({ success: true, data: [] });
    await open();

    expect(document.querySelector('#app').textContent).toContain('communication_history_no_messages');
    expect(document.querySelector('#app').textContent).toContain('news_empty');
  });

  test('a list that failed to load says so and offers a retry, without hiding the other list', async () => {
    api.getAnnouncementHistory.mockRejectedValueOnce(new Error('offline'));
    await open();

    expect(document.querySelector('[role="alert"]').textContent).toBe('communication_history_messages_error');
    expect(document.querySelector('[data-news-id="9"]')).not.toBeNull();

    click(document.querySelector('[data-communication-retry]'));
    await new Promise(process.nextTick);

    expect(document.querySelector('[data-announcement-id="4"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('long lists', () => {
  const news = (id) => ({ ...NEWS, id, title: `Nouvelle ${id}` });

  test('offer the next page, add it to the list and keep focus on its first item', async () => {
    api.getNewsHistory.mockResolvedValueOnce({ success: true, data: [news(1), news(2)], pagination: { hasNext: true } });
    await open();
    api.getNewsHistory.mockResolvedValueOnce({ success: true, data: [news(3)], pagination: { hasNext: false } });

    click(document.querySelector('[data-load-more="news"]'));
    await new Promise(process.nextTick);

    expect(api.getNewsHistory).toHaveBeenLastCalledWith({ archived: false, page: 2 });
    expect(Array.from(document.querySelectorAll('[data-news-id]')).map((item) => item.dataset.newsId)).toEqual(['1', '2', '3']);
    expect(document.querySelector('[data-load-more="news"]')).toBeNull();
    expect(document.activeElement.dataset.newsId).toBe('3');
  });

  test('are not extended twice by a double tap', async () => {
    api.getNewsHistory.mockResolvedValueOnce({ success: true, data: [news(1)], pagination: { hasNext: true } });
    await open();
    let release;
    api.getNewsHistory.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    const button = document.querySelector('[data-load-more="news"]');
    click(button);
    click(button);
    expect(button.disabled).toBe(true);
    release({ success: true, data: [news(2)], pagination: { hasNext: false } });
    await new Promise(process.nextTick);

    expect(api.getNewsHistory).toHaveBeenCalledTimes(2);
    expect(Array.from(document.querySelectorAll('[data-news-id]')).map((item) => item.dataset.newsId)).toEqual(['1', '2']);
  });

  test('say so when the next page cannot be loaded, and keep what is shown', async () => {
    api.getNewsHistory.mockResolvedValueOnce({ success: true, data: [news(1)], pagination: { hasNext: true } });
    await open();
    api.getNewsHistory.mockRejectedValueOnce(new Error('offline'));

    click(document.querySelector('[data-load-more="news"]'));
    await new Promise(process.nextTick);

    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(document.querySelector('[data-news-id="1"]')).not.toBeNull();
    expect(document.querySelector('[data-load-more="news"]')).not.toBeNull();
  });

  test('show no button when everything fits on one page', async () => {
    await open();

    expect(document.querySelector('[data-load-more]')).toBeNull();
  });
});

describe('archiving', () => {
  test('archives a message, tells the person, and puts focus back in its section', async () => {
    await open();
    api.getAnnouncementHistory.mockResolvedValue({ success: true, data: [] });

    click(document.querySelector('[data-announcement-id="4"] [data-archive-kind]'));
    await new Promise(process.nextTick);

    expect(api.setAnnouncementArchived).toHaveBeenCalledWith(4, true);
    expect(app.showMessage).toHaveBeenCalledWith('communication_history_archived', 'success');
    expect(document.querySelector('[data-announcement-id="4"]')).toBeNull();
    expect(document.activeElement.id).toBe('communication-history-messages');
  });

  test.each(['scheduled', 'sending'])('offers no archive for a message that is still %s', async (status) => {
    api.getAnnouncementHistory.mockResolvedValue({
      success: true, data: [{ ...ANNOUNCEMENT, status }], roles: [], groups: [],
    });
    await open();

    expect(document.querySelector('[data-announcement-id="4"]')).not.toBeNull();
    expect(document.querySelector('[data-announcement-id="4"] [data-archive-kind]')).toBeNull();
  });

  test('archives a news item', async () => {
    await open();

    click(document.querySelector('[data-news-id="9"] [data-archive-kind]'));
    await new Promise(process.nextTick);

    expect(api.setNewsArchived).toHaveBeenCalledWith(9, true);
  });

  test('names the item on its button, so a screen reader can tell the buttons apart', async () => {
    await open();

    expect(archiveButtons().map((button) => button.getAttribute('aria-label'))).toEqual([
      `communication_history_archive_named`.replace('{title}', HOSTILE),
      `communication_history_archive_named`.replace('{title}', '<b>Camp</b> d’automne'),
    ]);
  });

  test('a refused archive keeps the item, re-enables the button and explains', async () => {
    await open();
    api.setAnnouncementArchived.mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));

    const button = document.querySelector('[data-announcement-id="4"] [data-archive-kind]');
    click(button);
    await new Promise(process.nextTick);

    expect(app.showMessage).toHaveBeenCalledWith(expect.any(String), 'error');
    expect(app.showMessage).not.toHaveBeenCalledWith('communication_history_archived', 'success');
    expect(document.querySelector('[data-announcement-id="4"]')).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  test('the archive is browsed from a checkbox, which keeps focus', async () => {
    await open();
    api.getAnnouncementHistory.mockResolvedValue({
      success: true, data: [{ ...ANNOUNCEMENT, archived_at: '2026-10-11T00:00:00.000Z' }],
    });

    const toggle = document.getElementById('communication-history-archived');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(process.nextTick);

    expect(api.getAnnouncementHistory).toHaveBeenLastCalledWith({ archived: true });
    expect(api.getNewsHistory).toHaveBeenLastCalledWith({ archived: true });
    expect(document.activeElement.id).toBe('communication-history-archived');
    expect(document.getElementById('communication-history-archived').checked).toBe(true);
    expect(document.getElementById('communication-history-archived').hasAttribute('data-archive-safe')).toBe(true);
  });

  test('an archive that was only queued offline is not reported as done', async () => {
    await open();
    api.setAnnouncementArchived.mockResolvedValue({ success: true, queued: true });
    api.getAnnouncementHistory.mockClear();

    const button = document.querySelector('[data-announcement-id="4"] [data-archive-kind]');
    click(button);
    await new Promise(process.nextTick);

    expect(app.showMessage).toHaveBeenCalledWith('communication_history_queued', 'info');
    expect(app.showMessage).not.toHaveBeenCalledWith('communication_history_archived', 'success');
    expect(api.getAnnouncementHistory).not.toHaveBeenCalled();
    expect(document.querySelector('[data-announcement-id="4"]')).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  test('a slow answer for the archive does not overwrite the list the person went back to', async () => {
    await open();
    let releaseArchived;
    api.getAnnouncementHistory.mockReturnValueOnce(new Promise((resolve) => { releaseArchived = resolve; }));
    const toggle = document.getElementById('communication-history-archived');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(process.nextTick);
    releaseArchived({ success: true, data: [{ ...ANNOUNCEMENT, id: 99, subject: 'Archivé' }] });
    await new Promise(process.nextTick);

    expect(document.getElementById('communication-history-archived').checked).toBe(false);
    expect(document.querySelector('[data-announcement-id="99"]')).toBeNull();
    expect(document.querySelector('[data-announcement-id="4"]')).not.toBeNull();
    expect(document.getElementById('communication-history-messages').textContent).toBe('announcement_history');
  });

  test('restores an archived message', async () => {
    await open();
    document.getElementById('communication-history-archived').checked = true;
    document.getElementById('communication-history-archived').dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(process.nextTick);

    click(document.querySelector('[data-announcement-id="4"] [data-archive-kind]'));
    await new Promise(process.nextTick);

    expect(api.setAnnouncementArchived).toHaveBeenCalledWith(4, false);
    expect(app.showMessage).toHaveBeenCalledWith('communication_history_restored', 'success');
  });
});

describe('without the right to send communications', () => {
  beforeEach(() => canSendCommunications.mockReturnValue(false));

  test('shows only the news, with nothing to archive', async () => {
    await open();

    expect(api.getAnnouncementHistory).not.toHaveBeenCalled();
    expect(document.querySelector('[data-announcement-id]')).toBeNull();
    expect(document.querySelector('[data-news-id="9"]')).not.toBeNull();
    expect(archiveButtons()).toHaveLength(0);
  });

  test('does not offer the archive, which they could not read', async () => {
    await open();

    expect(document.getElementById('communication-history-archived')).toBeNull();
    expect(api.getNewsHistory).toHaveBeenCalledTimes(1);
    expect(api.getNewsHistory).toHaveBeenCalledWith({ archived: false });
  });
});

describe('late answers', () => {
  test('do not draw over the next screen', async () => {
    let release;
    api.getNewsHistory.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const screen = new CommunicationHistory(app);
    const loading = screen.init();

    screen.destroy();
    document.getElementById('app').innerHTML = '<p id="next">next screen</p>';
    release({ success: true, data: [NEWS] });
    await loading;

    expect(document.getElementById('next')).not.toBeNull();
    expect(document.querySelector('[data-news-id]')).toBeNull();
  });
});

describe('accessibility', () => {
  test.each([
    ['the history', async () => {}],
    ['the archive', async () => {
      document.getElementById('communication-history-archived').checked = true;
      document.getElementById('communication-history-archived').dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(process.nextTick);
    }],
  ])('%s has no WCAG 2.2 AA violations', async (_state, act) => {
    await open();
    await act();

    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('a failed list has no violations either', async () => {
    api.getNewsHistory.mockRejectedValue(new Error('offline'));
    await open();

    const results = await axe.run(document.body, AXE_OPTIONS);

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('every control is a native button or input, reachable in reading order', async () => {
    await open();

    const controls = Array.from(document.querySelectorAll('#app button, #app input, #app a[href]'));
    expect(controls.every((control) => control.tabIndex >= 0)).toBe(true);
    expect(archiveButtons().every((button) => button.tagName === 'BUTTON' && button.type === 'button')).toBe(true);
    expect(document.getElementById('communication-history-archived').labels).toHaveLength(1);
  });
});
