const {
  INVITATION_STATE,
  classifyInvitation,
  isActionableState,
  findInvitationByToken,
  describeInvitation,
} = require('../services/parentInvitations');
const { generateInvitationToken } = require('../utils/invitation-tokens');

const NOW = new Date('2026-09-21T12:00:00.000Z');
const LIVE = new Date('2026-09-28T12:00:00.000Z');
const LAPSED = new Date('2026-09-14T12:00:00.000Z');

/**
 * @param {Object} overrides - Fields to change on the baseline pending row
 * @returns {Object} A `parent_invitations` row
 */
function invitationRow(overrides = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    organization_id: 7,
    email: 'parent@example.org',
    first_name: 'Ada',
    last_name: 'Lovelace',
    telephone_residence: null,
    telephone_cellulaire: null,
    support_contact_name: null,
    support_contact_email: null,
    language: 'fr',
    status: 'pending',
    expires_at: LIVE,
    accepted_user_id: null,
    onboarding_completed_at: null,
    organization_name: '6A St-Paul',
    account_exists: false,
    ...overrides,
  };
}

describe('classifying a link', () => {
  test('a token matching nothing is invalid', () => {
    expect(classifyInvitation(null, { now: NOW })).toBe(INVITATION_STATE.INVALID);
  });

  test('a live invitation asks for a password only when there is no account', () => {
    expect(classifyInvitation(invitationRow(), { now: NOW }))
      .toBe(INVITATION_STATE.READY_NEW_ACCOUNT);
    expect(classifyInvitation(invitationRow(), { accountExists: true, now: NOW }))
      .toBe(INVITATION_STATE.READY_EXISTING_ACCOUNT);
  });

  test('a lapsed invitation is expired', () => {
    expect(classifyInvitation(invitationRow({ expires_at: LAPSED }), { now: NOW }))
      .toBe(INVITATION_STATE.EXPIRED);
  });

  test('revocation outranks expiry, so a withdrawn invite never reads as merely stale', () => {
    const row = invitationRow({ status: 'revoked', expires_at: LAPSED });

    expect(classifyInvitation(row, { now: NOW })).toBe(INVITATION_STATE.REVOKED);
  });

  test('an accepted invitation stays accepted after its expiry passes', () => {
    // The account exists. Telling this person the link expired would send them
    // to ask for a new invitation instead of to the login page.
    const row = invitationRow({ status: 'accepted', expires_at: LAPSED });

    expect(classifyInvitation(row, { now: NOW })).toBe(INVITATION_STATE.ACCEPTED);
  });

  test('a status outside the lifecycle is treated as unusable, not as usable', () => {
    const row = invitationRow({ status: 'something_else' });

    expect(classifyInvitation(row, { now: NOW })).toBe(INVITATION_STATE.INVALID);
  });

  test('only the two ready states may be acted on', () => {
    expect(isActionableState(INVITATION_STATE.READY_NEW_ACCOUNT)).toBe(true);
    expect(isActionableState(INVITATION_STATE.READY_EXISTING_ACCOUNT)).toBe(true);
    expect(isActionableState(INVITATION_STATE.ACCEPTED)).toBe(false);
    expect(isActionableState(INVITATION_STATE.EXPIRED)).toBe(false);
    expect(isActionableState(INVITATION_STATE.REVOKED)).toBe(false);
    expect(isActionableState(INVITATION_STATE.INVALID)).toBe(false);
  });
});

describe('looking a link up', () => {
  test('queries by digest, so the raw token never reaches the database', async () => {
    const { token, digest } = generateInvitationToken();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [invitationRow()] }) };

    await findInvitationByToken(pool, token);

    const [sql, params] = pool.query.mock.calls[0];
    expect(params).toEqual([digest]);
    expect(params).not.toContain(token);
    expect(sql).not.toContain(token);
  });

  test('a malformed token is refused without touching the database', async () => {
    const pool = { query: jest.fn() };

    await expect(findInvitationByToken(pool, '')).resolves.toBeNull();
    await expect(findInvitationByToken(pool, null)).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('describing a link', () => {
  test('hands the page everything it renders, including the locked address', async () => {
    const row = invitationRow({ telephone_cellulaire: '819-555-0100' });
    const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) };

    const described = await describeInvitation(pool, generateInvitationToken().token, { now: NOW });

    expect(described).toMatchObject({
      state: INVITATION_STATE.READY_NEW_ACCOUNT,
      organization_name: '6A St-Paul',
      email: 'parent@example.org',
      first_name: 'Ada',
      telephone_cellulaire: '819-555-0100',
      language: 'fr',
    });
  });

  test('changes nothing — a link scanner opening the mail must not spend the invite', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [invitationRow()] }) };

    await describeInvitation(pool, generateInvitationToken().token, { now: NOW });

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toMatch(/^\s*SELECT/);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  test('an unmatched token reveals nothing beyond the fact that it did not work', async () => {
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const logger = { info: jest.fn() };

    const described = await describeInvitation(pool, generateInvitationToken().token, { now: NOW, logger });

    expect(described).toEqual({ state: INVITATION_STATE.INVALID });
  });

  test('never writes the token to the log', async () => {
    const { token } = generateInvitationToken();
    const pool = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const logger = { info: jest.fn() };

    await describeInvitation(pool, token, { now: NOW, logger });

    const logged = JSON.stringify(logger.info.mock.calls);
    expect(logged).not.toContain(token);
    expect(logger.info).toHaveBeenCalledWith(
      'Parent invitation link rejected',
      expect.objectContaining({ reason: 'no_match', tokenLength: token.length })
    );
  });

  test('a revoked link says so instead of pretending to be broken', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [invitationRow({ status: 'revoked' })] }),
    };

    const described = await describeInvitation(pool, generateInvitationToken().token, { now: NOW });

    expect(described.state).toBe(INVITATION_STATE.REVOKED);
    expect(described.organization_name).toBe('6A St-Paul');
  });
});
