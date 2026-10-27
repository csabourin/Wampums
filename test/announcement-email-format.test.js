/**
 * Announcement emails carry the message's formatting.
 *
 * A formatted message (message_html) is sent as HTML, sanitized again at
 * send time; the email's text part, and every other channel, use the plain
 * message. A plain message is sent as text only, as before.
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'announcement-email-format-secret';

jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  sendEmail: jest.fn(() => Promise.resolve(true)),
  sendWhatsApp: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../services/emailSender', () => ({
  resolveOrganizationEmailSender: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(), sendNotification: jest.fn(() => Promise.resolve()),
}));
jest.mock('../utils/web-push', () => ({
  ...jest.requireActual('../utils/web-push'),
  getVapidKeys: () => ({ publicKey: 'test-public-key', privateKey: 'test-private-key' }),
  recordPushOutcomes: jest.fn(() => Promise.resolve()),
}));

const { sendEmail, sendWhatsApp } = require('../utils');
const webpush = require('web-push');
const { dispatchAnnouncementForTests } = require('../routes/announcements');

const quiet = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

/**
 * A pool answering the recipient query with one leader and nothing else.
 * @returns {{query: jest.Mock}}
 */
function fakePool() {
  return {
    query: jest.fn((sql) => Promise.resolve(sql.includes('LOWER(u.email) AS email')
      ? { rows: [{ email: 'leader@unit.test', user_id: 'user-1', whatsapp_phone_number: null }] }
      : { rows: [], rowCount: 0 })),
  };
}

const announcement = (overrides) => ({
  id: 7,
  organization_id: 3,
  subject: 'Camp',
  message: 'Bring:\n\n- boots',
  message_html: null,
  recipient_roles: ['leader'],
  recipient_groups: [],
  audience: 'members',
  ...overrides,
});

describe('announcement email format', () => {
  beforeEach(() => sendEmail.mockClear());

  test('sends a formatted message as HTML with the plain text beside it', async () => {
    await dispatchAnnouncementForTests(fakePool(), quiet, announcement({
      message_html: '<p>Bring:</p><ul><li><strong>boots</strong></li></ul><img src=x onerror=alert(1)>',
    }));

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, text, html] = sendEmail.mock.calls[0];
    expect(to).toBe('leader@unit.test');
    expect(subject).toBe('Camp');
    expect(text).toBe('Bring:\n\n- boots');
    expect(html).toBe('<div><p>Bring:</p><ul><li><strong>boots</strong></li></ul></div>');
  });

  test('sends a plain message as text only', async () => {
    await dispatchAnnouncementForTests(fakePool(), quiet, announcement());

    const [, , text, html] = sendEmail.mock.calls[0];
    expect(text).toBe('Bring:\n\n- boots');
    expect(html).toBeNull();
  });
});

describe('family email recipients', () => {
  beforeEach(() => sendEmail.mockClear());

  test.each([
    { label: 'all families', recipient_roles: ['parent'], recipient_groups: [] },
    { label: 'one den', recipient_roles: [], recipient_groups: [12] },
  ])('$label receives mail only through adult accounts and guardian contacts', async (audience) => {
    const pool = {
      query: jest.fn((sql) => {
        if (sql.includes('LOWER(u.email) AS email')) {
          return Promise.resolve({ rows: [{ email: 'parent@unit.test', user_id: 'parent-1' }] });
        }
        if (sql.includes('FROM parents_guardians')) {
          return Promise.resolve({ rows: [{ email: 'guardian@unit.test' }, { email: 'parent@unit.test' }] });
        }
        if (sql.includes('FROM form_submissions')) {
          return Promise.resolve({ rows: [{ courriel: 'fake-child@unit.test' }] });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await dispatchAnnouncementForTests(pool, quiet, announcement(audience));

    expect(sendEmail.mock.calls.map(([to]) => to).sort()).toEqual([
      'guardian@unit.test', 'parent@unit.test',
    ]);
  });
});

describe('announcement delivery results', () => {
  beforeEach(() => sendEmail.mockReset().mockResolvedValue(true));

  test.each([
    { label: 'accepted', reply: true, status: 'sent', sent: 1, failed: 0 },
    { label: 'refused', reply: false, status: 'failed', sent: 0, failed: 1 },
    { label: 'throwing', error: true, status: 'failed', sent: 0, failed: 1 },
  ])('a $label email send returns and stores its real result', async ({ reply, error, status, sent, failed }) => {
    if (error) {
      sendEmail.mockRejectedValue(new Error('mail transport failed'));
    } else {
      sendEmail.mockResolvedValue(reply);
    }
    const pool = fakePool();

    const result = await dispatchAnnouncementForTests(pool, quiet, announcement());

    expect(result).toMatchObject({ status, delivery: { email: { total: 1, sent, failed } } });
    const update = pool.query.mock.calls.find(([sql]) => sql.includes('UPDATE announcements'));
    expect(update[1]).toEqual([status, 7, sent > 0]);
    const log = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO announcement_logs'));
    expect(log[1][2]).toBe(sent ? 'sent' : 'failed');
  });

  test('an announcement with no recipients is failed rather than reported as sent', async () => {
    const pool = { query: jest.fn(() => Promise.resolve({ rows: [] })) };

    const result = await dispatchAnnouncementForTests(pool, quiet, announcement());

    expect(result).toMatchObject({ status: 'failed', delivery: { email: { total: 0, sent: 0, failed: 0 } } });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('a receipt log failure does not pretend that an accepted email was not sent', async () => {
    const pool = fakePool();
    const query = pool.query.getMockImplementation();
    pool.query.mockImplementation((sql, params) => sql.includes('INSERT INTO announcement_logs')
      ? Promise.reject(new Error('log unavailable')) : query(sql, params));

    const result = await dispatchAnnouncementForTests(pool, quiet, announcement());

    expect(result).toMatchObject({ status: 'sent', delivery: { email: { total: 1, sent: 1, failed: 0 } } });
  });
});

describe('transport outcomes survive history failures', () => {
  beforeEach(() => {
    sendEmail.mockReset().mockResolvedValue(true);
    sendWhatsApp.mockReset().mockResolvedValue(true);
    webpush.setVapidDetails.mockReset();
    webpush.sendNotification.mockReset().mockResolvedValue({});
  });

  /**
   * One account with configurable channels; history writes fail independently.
   * @param {{push?: boolean, whatsapp?: boolean, googleChat?: boolean, historyFails?: boolean}} channels
   * @returns {{query: jest.Mock}}
   */
  function channelPool({ push = false, whatsapp = false, googleChat = false, historyFails = true } = {}) {
    return {
      query: jest.fn((sql) => {
        if (sql.includes('LOWER(u.email) AS email')) {
          return Promise.resolve({ rows: [{ user_id: 'user-1', whatsapp_phone_number: whatsapp ? '+15555550199' : null }] });
        }
        if (sql.includes('FROM subscribers')) {
          return Promise.resolve({ rows: push ? ['one', 'two'].map((name) => ({
            user_id: 'user-1', endpoint: `https://push.example.test/${name}`, p256dh: 'k', auth: 'a',
          })) : [] });
        }
        if (sql.includes('FROM google_chat_config') || sql.includes('FROM google_chat_spaces')) {
          return Promise.resolve({ rows: googleChat ? [{ id: 1, space_id: 'test-space' }] : [] });
        }
        if (historyFails && sql.includes('INSERT INTO announcement_logs')) {
          return Promise.reject(new Error('history unavailable'));
        }
        return Promise.resolve({ rows: [] });
      }),
    };
  }

  test('mixed push results survive failed success and failure receipt writes', async () => {
    webpush.sendNotification.mockRejectedValueOnce(new Error('device refused'));
    const result = await dispatchAnnouncementForTests(channelPool({ push: true }), quiet, announcement());
    expect(result).toMatchObject({ status: 'partial', delivery: { push: { total: 2, sent: 1, failed: 1 } } });
  });

  test('accepted pushes stay sent even when their receipt writes fail', async () => {
    const result = await dispatchAnnouncementForTests(channelPool({ push: true }), quiet, announcement());
    expect(result).toMatchObject({ status: 'sent', delivery: { push: { total: 2, sent: 2, failed: 0 } } });
  });

  test('push setup failure counts every device as failed before any delivery attempt', async () => {
    webpush.setVapidDetails.mockImplementationOnce(() => { throw new Error('setup unavailable'); });
    const result = await dispatchAnnouncementForTests(channelPool({ push: true, historyFails: false }), quiet, announcement());
    expect(result).toMatchObject({ status: 'failed', delivery: { push: { total: 2, sent: 0, failed: 2 } } });
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('accepted WhatsApp messages stay sent when their receipt write fails', async () => {
    const result = await dispatchAnnouncementForTests(channelPool({ whatsapp: true }), quiet, announcement());
    expect(result).toMatchObject({ status: 'sent', delivery: { whatsapp: { total: 1, sent: 1, failed: 0 } } });
  });

  test('an accepted Google Chat broadcast stays sent when its receipt write fails', async () => {
    const service = { sendBroadcast: jest.fn(() => Promise.resolve()) };
    const result = await dispatchAnnouncementForTests(channelPool({ googleChat: true }), quiet, announcement(), null, service);
    expect(result).toMatchObject({ status: 'sent', delivery: { google_chat: { total: 1, sent: 1, failed: 0 } } });
  });
});
