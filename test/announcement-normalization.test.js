process.env.JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'announcement-normalization-secret';

const { normalizeAnnouncementPayloadForTests } = require('../routes/announcements');

test('rejects non-string content before it reaches the sanitizer', () => {
  const normalized = normalizeAnnouncementPayloadForTests({
    subject: { length: Number.MAX_SAFE_INTEGER, toString: () => 'unsafe' },
    message: ['unexpected'],
    recipient_roles: ['admin']
  });

  expect(normalized.subject).toBe('');
  expect(normalized.message).toBe('');
});

test('caps string and collection bounds before processing them', () => {
  const normalized = normalizeAnnouncementPayloadForTests({
    subject: 's'.repeat(500),
    message: 'm'.repeat(20000),
    recipient_roles: new Array(1000).fill('admin'),
    recipient_group_ids: new Array(1000).fill(1)
  });

  expect(normalized.subject).toHaveLength(255);
  expect(normalized.message).toHaveLength(10000);
  expect(normalized.roles).toEqual([]);
  expect(normalized.groups).toEqual([]);
});
