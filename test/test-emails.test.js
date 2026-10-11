/**
 * Test emails: a leader sends themselves the email families will receive.
 *
 * - POST /api/v1/resources/permission-slips/test-email sends the activity's
 *   permission-slip email (or its reminder) for a sample child;
 * - POST /api/v1/announcements/test sends the announcement being written.
 *
 * Both go to the signed-in member only, marked "[TEST]", and save nothing.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = { connect: jest.fn(() => Promise.resolve(mClient)), query: jest.fn(), on: jest.fn() };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});
jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('../services/emailSender', () => ({
  resolveOrganizationEmailSender: jest.fn(() => Promise.resolve(null)),
}));

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
const { sendEmail } = require('../utils/index');
const { markAsTestEmail } = require('../utils/test-email');

const TEST_SECRET = 'testsecret';
const ORG_ID = 3;
const USER_ID = '6f1c0f8e-1d7e-4a8e-9b1c-2f3a4b5c6d7e';
const LEADER_EMAIL = 'akela@unit.test';
let app;

const token = (permissions) => jwt.sign({
  user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], roleNames: ['leader'], permissions,
}, TEST_SECRET);

const ACTIVITY = {
  name: 'Sortie canot', description: 'Apportez des bottes', description_html: '<p>Apportez des <strong>bottes</strong></p>',
  activity_date: '2026-11-07',
};

/**
 * Answer the queries the test routes run; record every statement.
 * @param {Object} [options]
 * @param {Object|null} [options.activity] - Activity row, or null for none
 * @param {string[]} [options.permissions] - The member's current permissions
 * @param {Object|null} [options.slip] - Pending slip's copy of the activity, or null
 * @returns {string[]} Statements run
 */
function mockDatabase({ activity = ACTIVITY, permissions = ['communications.send'], slip = null } = {}) {
  const { __mClient, __mPool } = require('pg');
  const statements = [];
  mockQueryImplementation(__mClient, __mPool, (query) => {
    statements.push(query);
    if (query.includes('p.permission_key')) {
      return { rows: permissions.map((key) => ({ permission_key: key })) };
    }
    if (query.includes('FROM permission_slips') && query.includes('activity_description_html AS description_html')) {
      return { rows: slip ? [slip] : [] };
    }
    if (query.includes('FROM activities') && query.includes('description_html')) {
      return { rows: activity ? [activity] : [] };
    }
    if (query.includes('SELECT email FROM users WHERE id')) {
      return { rows: [{ email: LEADER_EMAIL }] };
    }
    if (query.includes('language_preference')) {
      return { rows: [{ language_preference: 'fr' }] };
    }
    return undefined;
  });
  return statements;
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  sendEmail.mockClear();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('markAsTestEmail', () => {
  test('prefixes the subject and puts an escaped note above the same message', () => {
    const test = markAsTestEmail(
      { subject: 'Camp', textBody: 'Hello', htmlBody: '<p>Hello</p>' },
      { languageCode: 'fr', noteKeys: ['permission_slip_test_link_note'] },
    );
    expect(test.subject).toBe('[TEST] Camp');
    expect(test.textBody).toMatch(/^\*\*\* Courriel test envoyé à vous seulement/);
    expect(test.textBody).toMatch(/Hello$/);
    expect(test.htmlBody).toContain('Dans un test, le bouton de signature ne mène à aucune autorisation.');
    expect(test.htmlBody).toMatch(/<p>Hello<\/p>$/);
  });

  test('marks the subject in the tester\'s language', () => {
    expect(markAsTestEmail({ subject: 'Табір', textBody: '', htmlBody: '' }, { languageCode: 'uk' }).subject)
      .toBe('[ТЕСТ] Табір');
  });

  test('builds HTML from the text when the email has none', () => {
    const test = markAsTestEmail({ subject: 'S', textBody: 'a\n<b>', htmlBody: null }, { languageCode: 'en' });
    expect(test.htmlBody).toMatch(/<div>a<br>&lt;b&gt;<\/div>$/);
  });
});

describe('POST /api/v1/resources/permission-slips/test-email', () => {
  test('sends the leader the parents\' email for a sample child, saving nothing', async () => {
    const statements = mockDatabase();

    const res = await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, deadline_date: '2026-11-01' });

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(LEADER_EMAIL);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [to, subject, text, html] = sendEmail.mock.calls[0];
    expect(to).toBe(LEADER_EMAIL);
    expect(subject).toMatch(/^\[TEST\] Autorisation parentale requise - Sortie canot - Prénom Nom de l’enfant \(exemple\)$/);
    expect(text).toContain('Apportez des bottes');
    expect(html).toContain('<p>Apportez des <strong>bottes</strong></p>');
    expect(html).toContain('/permission-slip/test');
    expect(statements.some((sql) => /INSERT INTO permission_slips|UPDATE permission_slips/.test(sql))).toBe(false);
  });

  test('sends the reminder when asked', async () => {
    mockDatabase();
    await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, reminder: true });

    expect(sendEmail.mock.calls[0][1]).toMatch(/^\[TEST\] Rappel/);
  });

  test('from existing slips, uses a pending slip\'s own copy of the activity', async () => {
    mockDatabase({ slip: {
      name: 'Sortie canot (ancien titre)', description: 'Ancienne description', description_html: null,
      activity_date: '2026-11-14', deadline_date: '2026-11-05',
    } });
    await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, from_slips: true, reminder: true });

    const [, subject, text] = sendEmail.mock.calls[0];
    expect(subject).toContain('Sortie canot (ancien titre)');
    expect(text).not.toContain('Apportez des bottes');
  });

  test('with a slip id, uses that slip\'s copy, and a slip of another activity is not found', async () => {
    const statements = mockDatabase({ slip: {
      name: 'Groupe du 14', description: 'Ancienne', description_html: null,
      activity_date: '2026-11-14', deadline_date: null,
    } });
    await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, slip_id: 41 });
    expect(sendEmail.mock.calls[0][1]).toContain('Groupe du 14');
    expect(statements.some((sql) => sql.includes('WHERE id = $1 AND activity_id = $2 AND organization_id = $3'))).toBe(true);

    sendEmail.mockClear();
    mockDatabase();
    const res = await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, slip_id: 999 });
    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('from existing slips without a pending one, falls back to the activity', async () => {
    mockDatabase();
    await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 12, from_slips: true });

    expect(sendEmail.mock.calls[0][1]).toContain('Sortie canot - ');
  });

  test('an activity outside the unit is not found', async () => {
    mockDatabase({ activity: null });
    const res = await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: 99 });

    expect(res.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test('needs the right to write to families', async () => {
    mockDatabase({ permissions: ['activities.edit'] });
    const res = await request(app)
      .post('/api/v1/resources/permission-slips/test-email')
      .set('Authorization', `Bearer ${token(['activities.edit'])}`)
      .send({ activity_id: 12 });

    expect(res.status).toBe(403);
    expect(res.body.missing).toEqual(['communications.send']);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/announcements/test', () => {
  test('sends the leader the announcement as written, saving nothing', async () => {
    const statements = mockDatabase();

    const res = await request(app)
      .post('/api/v1/announcements/test')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({
        subject: 'Camp d\'hiver',
        message: 'Bonjour\n\n- Bottes',
        message_html: '<p>Bonjour</p><ul><li>Bottes</li></ul><script>x</script>',
      });

    expect(res.status).toBe(200);
    const [to, subject, text, html] = sendEmail.mock.calls[0];
    expect(to).toBe(LEADER_EMAIL);
    expect(subject).toBe('[TEST] Camp d\'hiver');
    expect(text).toMatch(/Bonjour\n\n- Bottes$/);
    expect(html).toMatch(/<div><p>Bonjour<\/p><ul><li>Bottes<\/li><\/ul><\/div>$/);
    expect(statements.some((sql) => /INSERT INTO announcements|announcement_logs/.test(sql))).toBe(false);
  });

  test('an alumni mailing shows its unsubscribe footer with a note', async () => {
    mockDatabase();
    await request(app)
      .post('/api/v1/announcements/test')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ subject: 'Nouvelles', message: 'Bonjour', audience: 'alumni' });

    const html = sendEmail.mock.calls[0][3];
    expect(html).toContain('alumni-unsubscribe?token=test');
    expect(html).toContain('le lien de désabonnement ne fait rien');
  });

  test('needs the right to write to families', async () => {
    mockDatabase({ permissions: [] });
    const res = await request(app)
      .post('/api/v1/announcements/test')
      .set('Authorization', `Bearer ${token([])}`)
      .send({ subject: 'S', message: 'M' });

    expect(res.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
