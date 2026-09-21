const { createHash } = require('crypto');

const {
  TOKEN_DIGEST_LENGTH,
  DEFAULT_TOKEN_TTL_DAYS,
  generateInvitationToken,
  digestInvitationToken,
  invitationExpiresAt,
  isInvitationExpired,
} = require('../utils/invitation-tokens');

test('mints URL-safe tokens that do not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i += 1) {
    const { token } = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(seen.has(token)).toBe(false);
    seen.add(token);
  }
});

test('stores a digest that cannot be turned back into the link', () => {
  const { token, digest } = generateInvitationToken();

  expect(digest).toHaveLength(TOKEN_DIGEST_LENGTH);
  expect(digest).toMatch(/^[0-9a-f]+$/);
  expect(digest).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
  expect(digest).not.toContain(token);
});

test('a token presented later digests to the value stored for it', () => {
  const { token, digest } = generateInvitationToken();

  // What the accept endpoint does: hash what arrived, look up that.
  expect(digestInvitationToken(token)).toBe(digest);
  // A mail client that appended a newline must still match.
  expect(digestInvitationToken(`${token}\n`)).toBe(digest);
});

test('refuses to hash anything that is not a token, so no lookup runs on junk', () => {
  expect(digestInvitationToken(undefined)).toBeNull();
  expect(digestInvitationToken(null)).toBeNull();
  expect(digestInvitationToken('')).toBeNull();
  expect(digestInvitationToken('   ')).toBeNull();
  expect(digestInvitationToken(42)).toBeNull();
  expect(digestInvitationToken({})).toBeNull();
  expect(digestInvitationToken(['a'])).toBeNull();
});

test('a truncated link does not match the invitation it came from', () => {
  const { token, digest } = generateInvitationToken();

  expect(digestInvitationToken(token.slice(0, -1))).not.toBe(digest);
});

test('links expire seven days out by default', () => {
  const from = new Date('2026-09-21T12:00:00.000Z');

  expect(DEFAULT_TOKEN_TTL_DAYS).toBe(7);
  expect(invitationExpiresAt({ from }).toISOString()).toBe('2026-09-28T12:00:00.000Z');
  expect(invitationExpiresAt({ from, days: 1 }).toISOString()).toBe('2026-09-22T12:00:00.000Z');
});

test('expiry is decided against the clock, including at the boundary', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  expect(isInvitationExpired(new Date('2026-09-21T12:00:01.000Z'), now)).toBe(false);
  expect(isInvitationExpired(new Date('2026-09-21T11:59:59.000Z'), now)).toBe(true);
  // Exactly at the expiry moment the link is spent, not still good.
  expect(isInvitationExpired(new Date('2026-09-21T12:00:00.000Z'), now)).toBe(true);
});

test('reads expiry from the string form a driver may hand back', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  expect(isInvitationExpired('2026-09-28T12:00:00.000Z', now)).toBe(false);
  expect(isInvitationExpired('2026-09-14T12:00:00.000Z', now)).toBe(true);
});

test('treats a missing or unreadable expiry as expired rather than valid', () => {
  const now = new Date('2026-09-21T12:00:00.000Z');

  expect(isInvitationExpired(null, now)).toBe(true);
  expect(isInvitationExpired(undefined, now)).toBe(true);
  expect(isInvitationExpired('not a date', now)).toBe(true);
});
