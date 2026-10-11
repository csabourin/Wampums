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

test('keeps any role name for the unit check instead of a fixed list', () => {
  const normalized = normalizeAnnouncementPayloadForTests({
    subject: 'Test',
    message: 'Hello',
    recipient_roles: ['district', 'parent', 'district', 42, '']
  });

  expect(normalized.roles).toEqual(['district', 'parent']);
});

test('derives the plain message from a formatted one and keeps the formatting safe', () => {
  const normalized = normalizeAnnouncementPayloadForTests({
    subject: 'Camp',
    message: 'ignored when a formatted message is sent',
    message_html: '<p>Hello <b>families</b></p><ol><li>Boots</li></ol><p onclick="x">See <a href="https://example.com">the list</a></p>',
    recipient_roles: ['parent']
  });

  expect(normalized.messageHtml).toBe(
    '<p>Hello <strong>families</strong></p><ol><li>Boots</li></ol><p>See <a href="https://example.com">the list</a></p>'
  );
  expect(normalized.message).toBe('Hello families\n\n1. Boots\n\nSee the list (https://example.com)');
});

test('keeps a plain message without formatting', () => {
  const normalized = normalizeAnnouncementPayloadForTests({
    subject: 'Camp',
    message: 'Plain text',
    message_html: '<p> </p>',
    recipient_roles: ['parent']
  });

  expect(normalized.messageHtml).toBeNull();
  expect(normalized.message).toBe('Plain text');
});
