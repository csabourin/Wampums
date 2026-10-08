/**
 * Unit email sender identity.
 *
 * A unit may choose its display name and Reply-To freely, but a From address
 * is only legitimate on a domain authenticated with the email provider and
 * registered to that unit. Anything else would fail DMARC and read as spoofing.
 */

process.env.JWT_SECRET_KEY ||= 'email-sender-test-secret';
process.env.BREVO_KEY = 'test-brevo-key';
process.env.EMAIL_FROM = 'info@wampums.app';
process.env.EMAIL_AUTHENTICATED_DOMAINS = 'meute6a.app, other-unit.org';

const mockSendTransacEmail = jest.fn();
jest.mock('sib-api-v3-sdk', () => ({
  ApiClient: { instance: { authentications: { 'api-key': {} } } },
  TransactionalEmailsApi: jest.fn(() => ({ sendTransacEmail: mockSendTransacEmail })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Answer Brevo's GET /v3/senders/domains with the given domains.
 * @param {Array<{domain_name: string, authenticated: boolean}>} domains
 */
function brevoDomains(domains) {
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ domains }) });
}

const {
  clearProviderDomainsCache,
  getUnitSenderDomains,
  resolveOrganizationEmailSender,
  validateEmailSenderSettings,
} = require('../services/emailSender');
const { sendEmail } = require('../utils/index');

const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();

/**
 * Pool answering the queries the sender service makes.
 * @param {Object} options - Stored setting, unit name, the unit's domains, and
 *   bare domains other units also list
 */
function senderPool({ setting = null, name = 'Meute 6A', domains = [], claimedElsewhere = [] }) {
  return {
    query: jest.fn((sql, params) => {
      const text = normalize(sql);
      if (text.startsWith('SELECT domain FROM organization_domains')) {
        return Promise.resolve({ rows: domains.map((domain) => ({ domain })) });
      }
      if (text.includes('organization_id <> $1')) {
        const rows = claimedElsewhere.filter((domain) => params[1].includes(domain)).map((domain) => ({ domain }));
        return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [{ sender: setting, organization_name: name }] });
    }),
  };
}

beforeEach(() => {
  clearProviderDomainsCache();
  mockFetch.mockReset();
  brevoDomains([]);
});

describe('getUnitSenderDomains', () => {
  test('keeps only the unit\'s own authenticated domains, never the platform domain', async () => {
    const pool = senderPool({ domains: ['meute6a.app', 'www.meute6a.app', 'meute6a.wampums.app', 'unverified.ca'] });

    await expect(getUnitSenderDomains(pool, 1)).resolves.toEqual(['meute6a.app']);
  });

  test('withholds a domain that another unit also lists', async () => {
    const pool = senderPool({ domains: ['meute6a.app', 'other-unit.org'], claimedElsewhere: ['meute6a.app'] });

    await expect(getUnitSenderDomains(pool, 1)).resolves.toEqual(['other-unit.org']);
  });
});

describe('domains authenticated in Brevo', () => {
  test('a domain Brevo reports as authenticated is offered without EMAIL_AUTHENTICATED_DOMAINS', async () => {
    brevoDomains([
      { domain_name: 'Brevo-Unit.ca', authenticated: true },
      { domain_name: 'pending-unit.ca', authenticated: false },
    ]);
    const pool = senderPool({ domains: ['www.brevo-unit.ca', 'pending-unit.ca'] });

    await expect(getUnitSenderDomains(pool, 1)).resolves.toEqual(['brevo-unit.ca']);
    expect(mockFetch).toHaveBeenCalledWith('https://api.brevo.com/v3/senders/domains', expect.objectContaining({
      headers: expect.objectContaining({ 'api-key': 'test-brevo-key' }),
    }));
  });

  test('asks Brevo once and reuses the answer', async () => {
    brevoDomains([{ domain_name: 'brevo-unit.ca', authenticated: true }]);
    const pool = senderPool({ domains: ['brevo-unit.ca'] });

    await getUnitSenderDomains(pool, 1);
    await getUnitSenderDomains(pool, 1);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('keeps EMAIL_AUTHENTICATED_DOMAINS when Brevo cannot be reached', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const pool = senderPool({ domains: ['meute6a.app', 'brevo-unit.ca'] });

    await expect(getUnitSenderDomains(pool, 1)).resolves.toEqual(['meute6a.app']);
    warn.mockRestore();
  });

  test('sendEmail accepts a From on a Brevo-authenticated domain', async () => {
    brevoDomains([{ domain_name: 'brevo-unit.ca', authenticated: true }]);
    mockSendTransacEmail.mockReset();
    mockSendTransacEmail.mockResolvedValue({ messageId: 'm1' });

    await sendEmail('parent@example.org', 'Subject', 'Body', null, { name: 'Unit', email: 'info@brevo-unit.ca' });

    expect(mockSendTransacEmail.mock.calls[0][0].sender.email).toBe('info@brevo-unit.ca');
  });
});

describe('validateEmailSenderSettings', () => {
  test('accepts a Gmail reply-to and a From on the unit\'s domain', () => {
    const { value, errors } = validateEmailSenderSettings({
      from_name: ' Meute 6A ',
      from_email: 'Meute6A@Meute6A.app',
      reply_to: ' Meute6A@gmail.com ',
    }, ['meute6a.app']);

    expect(errors).toEqual([]);
    expect(value).toEqual({
      from_name: 'Meute 6A',
      from_email: 'meute6a@meute6a.app',
      reply_to: 'meute6a@gmail.com',
    });
  });

  test('refuses a Gmail From address', () => {
    const { errors } = validateEmailSenderSettings({ from_email: 'meute6a@gmail.com' }, ['meute6a.app']);

    expect(errors.map((e) => e.field)).toEqual(['from_email']);
  });

  test('refuses another unit\'s authenticated domain', () => {
    const { errors } = validateEmailSenderSettings({ from_email: 'chef@other-unit.org' }, ['meute6a.app']);

    expect(errors.map((e) => e.field)).toEqual(['from_email']);
  });

  test('refuses a display name that could inject headers', () => {
    const { errors } = validateEmailSenderSettings({ from_name: 'Meute\r\nBcc: x@y.z' }, []);

    expect(errors.map((e) => e.field)).toEqual(['from_name']);
  });

  test.each([
    'a..b@meute6a.app',
    '.user@meute6a.app',
    'user.@meute6a.app',
    'user@example-.com',
    'user@-example.com',
    'user@example',
    'two@at@example.com',
    'name <user@example.com>',
  ])('refuses the malformed address %s', (address) => {
    const { errors } = validateEmailSenderSettings({ reply_to: address, from_email: address }, ['meute6a.app']);

    expect(errors.map((e) => e.field).sort()).toEqual(['from_email', 'reply_to']);
  });

  test.each(['first.last+scouts@gmail.com', 'o\'brien@example.ca', 'chef@sub.meute6a.app'])(
    'accepts the well-formed reply-to %s',
    (address) => {
      expect(validateEmailSenderSettings({ reply_to: address }, []).errors).toEqual([]);
    }
  );

  test('refuses a malformed reply-to', () => {
    const { errors } = validateEmailSenderSettings({ reply_to: 'not an address' }, []);

    expect(errors.map((e) => e.field)).toEqual(['reply_to']);
  });
});

describe('resolveOrganizationEmailSender', () => {
  test('uses the stored identity', async () => {
    const pool = senderPool({
      setting: { from_name: 'Meute 6A', from_email: 'meute6a@meute6a.app', reply_to: 'meute6a@gmail.com' },
      domains: ['meute6a.app'],
    });

    await expect(resolveOrganizationEmailSender(pool, 1)).resolves.toEqual({
      name: 'Meute 6A',
      email: 'meute6a@meute6a.app',
      replyTo: 'meute6a@gmail.com',
    });
  });

  test('falls back to EMAIL_FROM when the From domain no longer belongs to the unit', async () => {
    const pool = senderPool({
      setting: { from_email: 'meute6a@meute6a.app', reply_to: 'meute6a@gmail.com' },
      domains: [],
    });

    await expect(resolveOrganizationEmailSender(pool, 1)).resolves.toEqual({
      name: 'Meute 6A',
      email: 'info@wampums.app',
      replyTo: 'meute6a@gmail.com',
    });
  });

  test('defaults to the platform mailbox on the unit\'s own domain', async () => {
    const pool = senderPool({ setting: null, domains: ['meute6a.app'] });

    await expect(resolveOrganizationEmailSender(pool, 1)).resolves.toEqual({
      name: 'Meute 6A',
      email: 'info@meute6a.app',
      replyTo: null,
    });
  });

  test('uses EMAIL_FROM for a unit without an authenticated domain', async () => {
    const pool = senderPool({ setting: null, domains: ['meute6a.wampums.app', 'unverified.ca'] });

    await expect(resolveOrganizationEmailSender(pool, 1)).resolves.toMatchObject({
      email: 'info@wampums.app',
    });
  });
});

describe('sendEmail sender argument', () => {
  beforeEach(() => {
    mockSendTransacEmail.mockReset();
    mockSendTransacEmail.mockResolvedValue({ messageId: 'm1' });
  });

  test('sends From the unit address with a Reply-To', async () => {
    await sendEmail('parent@example.org', 'Subject', 'Body', null, {
      name: 'Meute 6A',
      email: 'meute6a@meute6a.app',
      replyTo: 'meute6a@gmail.com',
    });

    const payload = mockSendTransacEmail.mock.calls[0][0];
    expect(payload.sender).toEqual({ email: 'meute6a@meute6a.app', name: 'Meute 6A' });
    expect(payload.replyTo).toEqual({ email: 'meute6a@gmail.com', name: 'Meute 6A' });
  });

  test('never puts an unauthenticated address in From', async () => {
    await sendEmail('parent@example.org', 'Subject', 'Body', null, {
      name: 'Meute 6A',
      email: 'meute6a@gmail.com',
    });

    const payload = mockSendTransacEmail.mock.calls[0][0];
    expect(payload.sender.email).toBe('info@wampums.app');
    expect(payload.replyTo).toBeUndefined();
  });

  test('still accepts a plain display name', async () => {
    await sendEmail('parent@example.org', 'Subject', 'Body', null, 'Meute 6A');

    const payload = mockSendTransacEmail.mock.calls[0][0];
    expect(payload.sender).toEqual({ email: 'info@wampums.app', name: 'Meute 6A' });
  });
});
