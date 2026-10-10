/**
 * @jest-environment jsdom
 */

/**
 * The page a tapped push notification opens. It shows the message as sent,
 * as text (a message cannot inject markup), and says so plainly when the
 * message is not the reader's or the list is empty.
 *
 * @module test/spa/Messages
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/api/api-messages.js', () => ({ getMessage: jest.fn(), getMessages: jest.fn() }));

const { getMessage, getMessages } = require('../../spa/api/api-messages.js');
const { Messages } = require('../../spa/modules/messages/Messages.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

const MESSAGE = {
  id: 7,
  title: 'Sortie <b>samedi</b>',
  body: 'Départ à 9 h\nApportez un lunch <img src=x onerror=alert(1)>',
  created_at: '2026-10-10T18:00:12.000Z',
  sender_name: 'Akela',
};

const app = { lang: 'fr' };

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  jest.clearAllMocks();
});

describe('one message', () => {
  test('shows the title, sender, date and text as sent, without running markup', async () => {
    getMessage.mockResolvedValue({ success: true, data: MESSAGE });

    await new Messages(app, { messageId: 7 }).init();

    expect(getMessage).toHaveBeenCalledWith(7);
    expect(document.querySelector('h1').textContent).toBe('Sortie <b>samedi</b>');
    expect(document.querySelector('.message-detail__body').textContent).toBe(MESSAGE.body);
    expect(document.querySelector('#app img, #app b')).toBeNull();
    expect(document.querySelector('.message-detail__meta').textContent).toContain('Akela');
    expect(document.querySelector('time').getAttribute('datetime')).toBe(MESSAGE.created_at);
    // The time it was sent, not midnight of that day
    expect(document.querySelector('time').textContent).toMatch(/\d{1,2}[:h]\d{2}/);
    expect(document.querySelector('time').textContent).not.toMatch(/00:00/);
    // Focus moves to the message so screen readers start there
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });

  test('a message that is not the reader\'s says it cannot be found', async () => {
    getMessage.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

    await new Messages(app, { messageId: 99 }).init();

    expect(document.querySelector('[role="alert"]').textContent).toBe('message_not_found');
    expect(document.querySelector('a[href="/messages"]')).not.toBeNull();
  });

  test('has no WCAG A/AA violations', async () => {
    getMessage.mockResolvedValue({ success: true, data: MESSAGE });
    await new Messages(app, { messageId: 7 }).init();

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});

describe('message list', () => {
  test('links each message to its page, newest first as the server sends them', async () => {
    getMessages.mockResolvedValue({ success: true, data: [MESSAGE, { ...MESSAGE, id: 3, title: 'Réunion' }] });

    await new Messages(app).init();

    const links = [...document.querySelectorAll('.message-list a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/messages/7', '/messages/3']);
    expect(links[0].querySelector('.message-list__title').textContent).toBe('Sortie <b>samedi</b>');
  });

  test('an empty list says where messages come from', async () => {
    getMessages.mockResolvedValue({ success: true, data: [] });

    await new Messages(app).init();

    expect(document.querySelector('.empty-state').textContent).toBe('messages_empty');
  });

  test('a list that cannot load says so', async () => {
    getMessages.mockRejectedValue(new Error('offline'));

    await new Messages(app).init();

    expect(document.querySelector('[role="alert"]').textContent).toBe('messages_load_error');
  });

  test('has no WCAG A/AA violations', async () => {
    getMessages.mockResolvedValue({ success: true, data: [MESSAGE] });
    await new Messages(app).init();

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
