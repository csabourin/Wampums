jest.mock('../utils/index', () => ({ ...jest.requireActual('../utils/index'), sendEmail: jest.fn() }));
const { deliver } = require('../services/activityAuthorizations');
const { sendEmail } = require('../utils/index');

const SLIP = { id: 21, access_token: '00000000-0000-4000-8000-000000000021' };
const CONTENT = { subject: 'Camp', textBody: 'Details', htmlBody: '<p>Details</p>' };
let pool;
beforeEach(() => {
  jest.clearAllMocks();
  pool = { query: jest.fn().mockResolvedValue({ rows: [{ id: 11 }] }) };
  sendEmail.mockResolvedValue(true);
});

test('a concurrent or already accepted address is not sent again', async () => {
  pool.query.mockResolvedValueOnce({ rows: [] });
  expect(await deliver(pool, 3, SLIP, ' Parent@Example.test ', {}, CONTENT)).toBe('skipped');
  expect(sendEmail).not.toHaveBeenCalled();
});

test('the address is claimed before sending and accepted delivery is recorded separately', async () => {
  expect(await deliver(pool, 3, SLIP, ' Parent@Example.test ', {}, CONTENT)).toBe('sent');
  expect(pool.query.mock.calls[0][1]).toEqual([3, 21, 'parent@example.test', SLIP.access_token]);
  expect(pool.query.mock.calls[1][1]).toEqual(['sent', 11, 3]);
  expect(sendEmail).toHaveBeenCalledWith('parent@example.test', 'Camp', 'Details', '<p>Details</p>', {}, { throwOnError: true });
});

test('a definite rejection is recorded as retryable', async () => {
  sendEmail.mockResolvedValue(false);
  expect(await deliver(pool, 3, SLIP, 'parent@example.test', {}, CONTENT)).toBe('failed');
});

test('a provider rejection is retryable but a lost provider response remains uncertain', async () => {
  sendEmail.mockRejectedValueOnce({ statusCode: 400 });
  expect(await deliver(pool, 3, SLIP, 'parent@example.test', {}, CONTENT)).toBe('failed');
  sendEmail.mockRejectedValueOnce(new TypeError('response lost'));
  expect(await deliver(pool, 3, SLIP, 'parent@example.test', {}, CONTENT)).toBe('unknown');
  expect(pool.query.mock.calls.at(-1)[1][0]).toBe('unknown');
});

test('failure to persist an accepted outcome leaves the claim uncertain instead of permitting a resend', async () => {
  pool.query.mockResolvedValueOnce({ rows: [{ id: 11 }] }).mockRejectedValueOnce(new Error('receipt unavailable'));
  expect(await deliver(pool, 3, SLIP, 'parent@example.test', {}, CONTENT)).toBe('unknown');
  expect(sendEmail).toHaveBeenCalledTimes(1);
  expect(pool.query).toHaveBeenCalledTimes(2);
});
