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

const { sendEmail } = require('../utils');
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
