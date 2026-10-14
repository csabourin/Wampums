/**
 * Permission slips and the unit's leaders.
 *
 * Leaders receive, for information, the request the families received, with
 * no signing link: only a child's own family answers its slip. A leader who
 * is the parent of an invited child receives the parent's email instead, and
 * signs for that child like any parent.
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
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
jest.mock('../utils/public-url', () => ({
  ...jest.requireActual('../utils/public-url'),
  resolveOrganizationBaseUrl: jest.fn(() => Promise.resolve('https://meute.wampums.app')),
}));

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
const { sendEmail } = require('../utils/index');
const { buildPermissionSlipLeaderCopyContent } = require('../utils/permission-slip-email');

const TEST_SECRET = 'testsecret';
const ORG_ID = 3;
const USER_ID = '6f1c0f8e-1d7e-4a8e-9b1c-2f3a4b5c6d7e';
const LEADER_PARENT_ID = '7a2d1f9e-2e8f-4b9f-8c2d-3a4b5c6d7e8f';
const SLIP_ID = 41;
const ACTIVITY_ID = 9;
// Made per run: a slip's signing token is a bearer credential
const ACCESS_TOKEN = randomUUID();
let app;

const token = (permissions) => jwt.sign({
  user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], roleNames: ['leader'], permissions,
}, TEST_SECRET);

const SLIP = {
  id: SLIP_ID,
  participant_id: 5,
  first_name: 'Maxime',
  last_name: 'Tremblay',
  activity_id: ACTIVITY_ID,
  activity_title: 'Sortie canot',
  activity_description: 'Apportez des bottes',
  activity_description_html: null,
  meeting_date: '2026-11-07',
  deadline_date: null,
  access_token: ACCESS_TOKEN,
  status: 'pending',
  guardians_emailed: [],
};

/**
 * Answer the permission slip queries; record every statement.
 * @param {Object} [options]
 * @param {string[]} [options.permissions] - The member's current permissions
 * @param {boolean} [options.ownChild] - Whether the slip's child is linked to the member
 * @param {boolean} [options.alreadyCopied] - Whether the leaders' copies were already claimed
 * @returns {string[]} Statements run
 */
function mockDatabase({ permissions = ['permission_slips.sign'], ownChild = false, alreadyCopied = false, allSent = false } = {}) {
  const { __mClient, __mPool } = require('pg');
  const statements = [];
  mockQueryImplementation(__mClient, __mPool, (query) => {
    statements.push(query);
    if (query.includes('HAVING COUNT(DISTINCT p.permission_key)')) {
      return { rows: [
        { id: USER_ID, full_name: 'Akela', email: 'akela@unit.test' },
        { id: LEADER_PARENT_ID, full_name: 'Baloo', email: 'baloo@unit.test' },
      ] };
    }
    if (query.includes('p.permission_key')) {
      return { rows: permissions.map((key) => ({ permission_key: key })) };
    }
    if (query.includes('SELECT DISTINCT r.data_scope')) {
      return { rows: [{ data_scope: 'organization' }] };
    }
    if (query.includes('SELECT organization_id, participant_id, status FROM permission_slips')
      || query.includes('SELECT participant_id, status')) {
      return { rows: [{ organization_id: ORG_ID, participant_id: SLIP.participant_id, status: 'pending' }] };
    }
    if (query.includes('FROM user_participants up') && query.includes('participant_organizations po')) {
      return { rows: ownChild ? [{ '?column?': 1 }] : [] };
    }
    if (query.includes('UPDATE permission_slips') && query.includes("status = 'signed'")) {
      return { rows: [{ id: SLIP_ID, status: 'signed' }] };
    }
    if (query.includes('UPDATE permission_slips') && query.includes("status = 'declined'")) {
      return { rows: [{ id: SLIP_ID, status: 'declined' }] };
    }
    if (query.includes('COUNT(*) FILTER (WHERE ps.email_sent = false)')) {
      return { rows: [allSent ? { unsent_count: '0', sent_count: '1' } : { unsent_count: '1', sent_count: '0' }] };
    }
    if (query.includes('DISTINCT ON (ps.activity_id') && query.includes('ps.email_sent = true')) {
      return { rows: [SLIP] };
    }
    if (query.includes('AND ps.email_sent = false') && query.includes('JOIN participants p')) {
      return { rows: [SLIP] };
    }
    if (query.includes('FROM participant_guardians pg')) {
      return { rows: [{ id: 2, prenom: 'Julie', nom: 'Tremblay', courriel: 'julie@famille.test' }] };
    }
    if (query.includes('JOIN users u ON u.id = up.user_id')) {
      return { rows: [] };
    }
    if (query.includes('JOIN user_participants up ON up.participant_id = ps.participant_id')) {
      // Baloo is the parent of an invited child
      return { rows: [{ user_id: LEADER_PARENT_ID }] };
    }
    if (query.includes('INSERT INTO permission_slip_leader_copies')) {
      return { rows: alreadyCopied ? [] : [{ id: 1 }] };
    }
    if (query.includes('language_preference')) {
      return { rows: [{ language_preference: 'fr' }] };
    }
    if (query.includes('UPDATE permission_slips') || query.includes('DELETE FROM permission_slip_leader_copies')) {
      return { rows: [] };
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

describe('signing a permission slip in the app', () => {
  test('a leader cannot sign the slip of a child who is not theirs', async () => {
    const statements = mockDatabase({ ownChild: false });

    const res = await request(app)
      .patch(`/api/v1/resources/permission-slips/${SLIP_ID}/sign`)
      .set('Authorization', `Bearer ${token(['permission_slips.sign'])}`)
      .send({ signed_by: 'Akela' });

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('permission_slip_sign_own_children_only');
    expect(res.body.required).toEqual(['permission_slips.sign']);
    expect(res.body.missing).toEqual([]);
    expect(statements.some((sql) => sql.includes('UPDATE permission_slips'))).toBe(false);
  });

  test('a leader who is the child\'s parent signs for their own child', async () => {
    mockDatabase({ ownChild: true });

    const res = await request(app)
      .patch(`/api/v1/resources/permission-slips/${SLIP_ID}/sign`)
      .set('Authorization', `Bearer ${token(['permission_slips.sign'])}`)
      .send({ signed_by: 'Baloo' });

    expect(res.status).toBe(200);
    expect(res.body.data.permission_slip.status).toBe('signed');
  });

  test('a leader cannot decline the slip of a child who is not theirs', async () => {
    const statements = mockDatabase({ ownChild: false });

    const res = await request(app)
      .patch(`/api/v1/resources/permission-slips/${SLIP_ID}`)
      .set('Authorization', `Bearer ${token(['permission_slips.sign'])}`)
      .send({ status: 'declined', declined_by: 'Akela' });

    expect(res.status).toBe(403);
    expect(res.body.required).toEqual(['permission_slips.sign']);
    expect(statements.some((sql) => sql.includes('UPDATE permission_slips'))).toBe(false);
  });

  test('the slip list says which slips are the viewer\'s own children\'s', async () => {
    const statements = mockDatabase({ permissions: ['participants.view'] });

    const res = await request(app)
      .get('/api/v1/resources/permission-slips')
      .query({ activity_id: ACTIVITY_ID })
      .set('Authorization', `Bearer ${token(['participants.view'])}`);

    expect(res.status).toBe(200);
    expect(statements.find((sql) => sql.includes('AS is_own_child'))).toBeDefined();
  });
});

describe('emailing an activity\'s permission slips', () => {
  const send = () => request(app)
    .post('/api/v1/resources/permission-slips/send-emails')
    .set('Authorization', `Bearer ${token(['communications.send'])}`)
    .send({ activity_id: ACTIVITY_ID, slip_ids: [SLIP_ID] });

  test('leaders receive a copy for information, without the signing link', async () => {
    mockDatabase({ permissions: ['communications.send'] });

    const res = await send();

    expect(res.status).toBe(200);
    expect(res.body.data.sent).toBe(1);
    expect(res.body.data.leader_copies_sent).toBe(1);

    const recipients = sendEmail.mock.calls.map(([to]) => to);
    expect(recipients).toEqual(expect.arrayContaining(['julie@famille.test', 'akela@unit.test']));

    const [, subject, textBody, htmlBody] = sendEmail.mock.calls.find(([to]) => to === 'akela@unit.test');
    expect(subject).toContain('Pour information');
    expect(subject).toContain('Sortie canot');
    expect(textBody).not.toContain(ACCESS_TOKEN);
    expect(htmlBody).not.toContain(ACCESS_TOKEN);
    expect(textBody).toContain(`https://meute.wampums.app/permission-slips/${ACTIVITY_ID}`);

    const parentEmail = sendEmail.mock.calls.find(([to]) => to === 'julie@famille.test');
    expect(parentEmail[2]).toContain(ACCESS_TOKEN);
  });

  test('a leader who is the parent of an invited child gets no copy', async () => {
    mockDatabase({ permissions: ['communications.send'] });

    await send();

    expect(sendEmail.mock.calls.map(([to]) => to)).not.toContain('baloo@unit.test');
  });

  test('a leader already sent a copy for the activity is not sent another', async () => {
    mockDatabase({ permissions: ['communications.send'], alreadyCopied: true });

    const res = await send();

    expect(res.body.data.leader_copies_sent).toBe(0);
    expect(sendEmail.mock.calls.map(([to]) => to)).toEqual(['julie@famille.test']);
  });
});

describe('a leader copy the email service refused', () => {
  test('is sent when the slips are sent again, though every family already has theirs', async () => {
    mockDatabase({ permissions: ['communications.send'], allSent: true });

    const res = await request(app)
      .post('/api/v1/resources/permission-slips/send-emails')
      .set('Authorization', `Bearer ${token(['communications.send'])}`)
      .send({ activity_id: ACTIVITY_ID });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ sent: 0, leader_copies_sent: 1 });
    expect(sendEmail.mock.calls.map(([to]) => to)).toEqual(['akela@unit.test']);
  });
});

describe('the leader\'s copy', () => {
  test('says only the family signs, and escapes the activity', () => {
    const copy = buildPermissionSlipLeaderCopyContent({
      activityTitle: 'Camp <script>',
      activityDescription: 'Bring <b>boots</b>',
      meetingDate: '2026-11-07T12:00:00',
      followLink: 'https://meute.wampums.app/permission-slips/9',
      languageCode: 'en',
    });

    expect(copy.textBody).toContain("Only a child's own family can sign their permission slip.");
    expect(copy.htmlBody).not.toContain('<script>');
    expect(copy.htmlBody).not.toContain('<b>boots</b>');
    expect(copy.htmlBody).toContain('href="https://meute.wampums.app/permission-slips/9"');
  });
});
