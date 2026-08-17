/**
 * Membership reactivation — service suite
 *
 * The feature exists to reopen a door that used to have no handle on the
 * inside, so the properties worth pinning down are all about *which* door a
 * given click opens:
 *
 * - a family the year transition swept out lets itself back in;
 * - a membership a leader closed by hand does not, and waits for that leader;
 * - an account belonging to another unit joins rather than colliding with the
 *   global unique index on `users.email`;
 * - and the request endpoint's answer never depends on what it found, because
 *   an unauthenticated caller asking "is this address a deactivated member
 *   here?" is describing an enumeration probe.
 *
 * Driven through a fake pool rather than a live database: every one of those is
 * a decision the service makes, and the queries it issues are the evidence.
 *
 * @module test/reactivation
 */

process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'reactivation-test-secret';

/** Every message the fake transport was handed, in order. */
const sentEmails = [];

jest.mock('../utils/index', () => {
  const actual = jest.requireActual('../utils/index');
  return {
    ...actual,
    sendEmail: jest.fn(async (to, subject, message, html) => {
      // eslint-disable-next-line no-undef
      global.__reactivationTestState.sentEmails.push({ to, subject, message, html });
      return true;
    }),
    getUserEmailLanguage: jest.fn(async () => 'en')
  };
});

global.__reactivationTestState = { sentEmails };

const {
  classifyStanding,
  issueReactivationToken,
  verifyReactivationToken,
  requestReactivation,
  describeReactivationLink,
  confirmReactivation
} = require('../services/reactivation');
const { issueAlumniToken, CONSENT_PURPOSE } = require('../services/alumni');

const ORG_ID = 7;
const USER_ID = '11111111-2222-3333-4444-555555555555';
const MEMBERSHIP_ID = 42;
const BASE_URL = 'https://unit.wampums.app';

/** Query fragments, most specific first, mapped to the rows they answer with. */
function makePool(overrides = {}) {
  const queries = [];

  const routes = [
    ['LEFT JOIN user_organizations', overrides.standing || []],
    ['SELECT id AS membership_id, status, deactivated_reason', overrides.membership || []],
    ['SELECT id, email, full_name FROM users', overrides.user || [{
      id: USER_ID, email: 'parent@example.org', full_name: 'Parent Example'
    }]],
    ['SELECT id FROM users', overrides.user || [{ id: USER_ID }]],
    ['SELECT id FROM roles', [{ id: 3 }]],
    ["r.role_name IN ('district', 'unitadmin')", overrides.admins || [{ email: 'admin@example.org' }]],
    ['FROM organizations o', [{ name: '12e Meute' }]]
  ];

  const query = jest.fn(async (sql, params) => {
    queries.push({ sql, params });
    const match = routes.find(([fragment]) => sql.includes(fragment));
    return { rows: match ? match[1] : [], rowCount: match ? match[1].length : 0 };
  });

  const client = { query, release: jest.fn() };
  return { query, connect: async () => client, queries };
}

/** Did the pool issue a statement containing this fragment? */
function issued(pool, fragment) {
  return pool.queries.some(({ sql }) => sql.includes(fragment));
}

beforeEach(() => {
  sentEmails.length = 0;
});

describe('classifyStanding', () => {
  test('no row at all is an address that may register', () => {
    expect(classifyStanding(null)).toBe('no_account');
  });

  test('an account with no membership here is joining, not colliding', () => {
    expect(classifyStanding({ user_id: USER_ID, membership_id: null })).toBe('joining');
  });

  test('an open membership is already active', () => {
    expect(classifyStanding({ membership_id: MEMBERSHIP_ID, status: 'active' })).toBe('already_active');
  });

  test('a closed membership is returning', () => {
    expect(classifyStanding({ membership_id: MEMBERSHIP_ID, status: 'inactive' })).toBe('returning');
    expect(classifyStanding({ membership_id: MEMBERSHIP_ID, status: 'alumni' })).toBe('returning');
  });
});

describe('reactivation tokens', () => {
  test('a token survives a round trip', () => {
    const token = issueReactivationToken({ user_id: USER_ID, organization_id: ORG_ID });
    expect(verifyReactivationToken(token)).toMatchObject({
      user_id: USER_ID,
      organization_id: ORG_ID
    });
  });

  test('an alumni consent token cannot be replayed as a reactivation', () => {
    const token = issueAlumniToken(
      { membership_id: MEMBERSHIP_ID, user_id: USER_ID, organization_id: ORG_ID },
      CONSENT_PURPOSE
    );
    expect(verifyReactivationToken(token)).toBeNull();
  });

  test('absent and malformed tokens are refused', () => {
    expect(verifyReactivationToken('')).toBeNull();
    expect(verifyReactivationToken('not-a-jwt')).toBeNull();
  });
});

describe('requestReactivation', () => {
  const run = (overrides) => requestReactivation(makePool(overrides), {
    email: 'parent@example.org',
    organizationId: ORG_ID,
    baseUrl: BASE_URL
  });

  test('an unknown address is answered without sending anything', async () => {
    await expect(run({ standing: [] })).resolves.toEqual({ requested: true });
    expect(sentEmails).toHaveLength(0);
  });

  test('an already active membership is answered without sending anything', async () => {
    await expect(run({
      standing: [{ user_id: USER_ID, email: 'parent@example.org', membership_id: MEMBERSHIP_ID, status: 'active' }]
    })).resolves.toEqual({ requested: true });
    expect(sentEmails).toHaveLength(0);
  });

  test('a closed membership is emailed a usable link', async () => {
    await run({
      standing: [{
        user_id: USER_ID,
        email: 'parent@example.org',
        membership_id: MEMBERSHIP_ID,
        status: 'inactive',
        deactivated_reason: 'no_enrolled_child'
      }]
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('parent@example.org');

    const [, token] = sentEmails[0].message.match(/reactivate-account\?token=([\w.-]+)/);
    expect(verifyReactivationToken(token)).toMatchObject({
      user_id: USER_ID,
      organization_id: ORG_ID
    });
  });

  test('an account from another unit is told it is joining, not returning', async () => {
    await run({
      standing: [{ user_id: USER_ID, email: 'parent@example.org', membership_id: null }]
    });

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].message).toContain('added to the unit');
  });
});

describe('describeReactivationLink', () => {
  const token = () => issueReactivationToken({ user_id: USER_ID, organization_id: ORG_ID });

  test('a routine deactivation offers immediate restoration', async () => {
    const result = await describeReactivationLink(
      makePool({ membership: [{ membership_id: MEMBERSHIP_ID, status: 'inactive', deactivated_reason: 'no_enrolled_child' }] }),
      token()
    );
    expect(result).toMatchObject({ state: 'ready_reactivate', organization_name: '12e Meute' });
  });

  test('a deliberate deactivation says a leader will decide', async () => {
    const result = await describeReactivationLink(
      makePool({ membership: [{ membership_id: MEMBERSHIP_ID, status: 'inactive', deactivated_reason: 'left the group' }] }),
      token()
    );
    expect(result.state).toBe('ready_review');
  });

  test('no membership here is a join', async () => {
    const result = await describeReactivationLink(makePool({ membership: [] }), token());
    expect(result.state).toBe('ready_join');
  });

  test('a request already filed is reported as pending', async () => {
    const result = await describeReactivationLink(
      makePool({
        membership: [{
          membership_id: MEMBERSHIP_ID,
          status: 'inactive',
          deactivated_reason: 'left the group',
          reactivation_requested_at: '2026-08-01T00:00:00Z'
        }]
      }),
      token()
    );
    expect(result.state).toBe('pending_approval');
  });

  test('an open membership needs nothing', async () => {
    const result = await describeReactivationLink(
      makePool({ membership: [{ membership_id: MEMBERSHIP_ID, status: 'active' }] }),
      token()
    );
    expect(result.state).toBe('already_active');
  });

  test('a bad token is refused without touching the database', async () => {
    const pool = makePool();
    await expect(describeReactivationLink(pool, 'not-a-jwt')).resolves.toEqual({ state: 'invalid' });
    expect(pool.queries).toHaveLength(0);
  });
});

describe('confirmReactivation', () => {
  const token = () => issueReactivationToken({ user_id: USER_ID, organization_id: ORG_ID });

  test('a family the year transition swept out lets itself back in', async () => {
    const pool = makePool({
      membership: [{ membership_id: MEMBERSHIP_ID, status: 'inactive', deactivated_reason: 'no_enrolled_child' }]
    });

    const result = await confirmReactivation(pool, token());

    expect(result.state).toBe('reactivated');
    expect(issued(pool, "SET status = 'active'")).toBe(true);
    // Nothing to decide, so nobody is interrupted.
    expect(sentEmails).toHaveLength(0);
  });

  test('a membership closed by hand waits for a leader, who is told', async () => {
    const pool = makePool({
      membership: [{ membership_id: MEMBERSHIP_ID, status: 'inactive', deactivated_reason: 'removed by leader' }]
    });

    const result = await confirmReactivation(pool, token());

    expect(result.state).toBe('pending_approval');
    expect(issued(pool, 'SET reactivation_requested_at = COALESCE')).toBe(true);
    expect(issued(pool, "SET status = 'active'")).toBe(false);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe('admin@example.org');
  });

  test('clicking the same link twice does not mail the leaders twice', async () => {
    const pool = makePool({
      membership: [{
        membership_id: MEMBERSHIP_ID,
        status: 'inactive',
        deactivated_reason: 'removed by leader',
        reactivation_requested_at: '2026-08-01T00:00:00Z'
      }]
    });

    const result = await confirmReactivation(pool, token());

    expect(result.state).toBe('pending_approval');
    expect(sentEmails).toHaveLength(0);
  });

  test('an account from another unit gains a membership instead of a duplicate user', async () => {
    const pool = makePool({ membership: [] });

    const result = await confirmReactivation(pool, token());

    expect(result.state).toBe('joined');
    expect(issued(pool, 'INSERT INTO user_organizations')).toBe(true);
    expect(issued(pool, 'INSERT INTO users')).toBe(false);
  });

  test('an open membership is left exactly as it is', async () => {
    const pool = makePool({ membership: [{ membership_id: MEMBERSHIP_ID, status: 'active' }] });

    const result = await confirmReactivation(pool, token());

    expect(result.state).toBe('already_active');
    expect(issued(pool, 'UPDATE user_organizations')).toBe(false);
    expect(issued(pool, 'INSERT INTO user_organizations')).toBe(false);
  });

  test('a token whose user has since been erased is refused', async () => {
    const pool = makePool({ user: [] });
    await expect(confirmReactivation(pool, token())).resolves.toEqual({ state: 'invalid' });
    expect(issued(pool, 'INSERT INTO user_organizations')).toBe(false);
  });

  test('a bad token is refused without opening a transaction', async () => {
    const pool = makePool();
    await expect(confirmReactivation(pool, 'not-a-jwt')).resolves.toEqual({ state: 'invalid' });
    expect(pool.queries).toHaveLength(0);
  });
});
