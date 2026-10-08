/**
 * Unit email sender identity.
 *
 * A unit may change how its outgoing email presents itself, but only in ways
 * that receiving servers will accept as legitimate:
 *
 * - `from_name`: the display name (`"Meute 6A" <…>`). Always allowed.
 * - `reply_to`: where replies go. Any address, including a Gmail one: the
 *   Reply-To header is not checked by SPF, DKIM or DMARC.
 * - `from_email`: the From address itself. Allowed only on a domain that is
 *   authenticated with the email provider (Brevo reports it as authenticated,
 *   or the operator lists it in EMAIL_AUTHENTICATED_DOMAINS) AND that is
 *   registered to this unit in organization_domains. A From on any other domain — gmail.com, or another
 *   unit's domain — would fail DMARC alignment and be treated as spoofing.
 *   Left blank, it defaults to the platform mailbox on the unit's own domain
 *   (`info@meute6a.app`), and to EMAIL_FROM only for a unit without one.
 *
 * The setting is stored as `organization_settings.email_sender`.
 *
 * @module services/emailSender
 */

const EMAIL_SENDER_SETTING_KEY = 'email_sender';
const MAX_EMAIL_LENGTH = 254;
const MAX_FROM_NAME_LENGTH = 100;
const DEFAULT_PLATFORM_SENDER = 'info@wampums.app';
// Dot-atom local part (no leading, trailing or doubled dots) and a domain of
// hostname labels that neither start nor end with a hyphen, ending in a TLD.
const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const MAX_LOCAL_PART_LENGTH = 64;
// eslint-disable-next-line no-control-regex -- header injection guard
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Lowercase and trim an email-like value.
 * @param {unknown} value - Raw input
 * @returns {string} Normalized value, or '' when not a string
 */
function normalizeAddress(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * @param {string} address - Normalized email address
 * @returns {boolean} Whether it is a plausible single mailbox
 */
function isValidAddress(address) {
  return address.length <= MAX_EMAIL_LENGTH
    && EMAIL_PATTERN.test(address)
    && address.indexOf('@') <= MAX_LOCAL_PART_LENGTH;
}

/**
 * @param {string} address - Email address
 * @returns {string} Its domain, lowercased
 */
function domainOf(address) {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

/**
 * The platform's own sending address (EMAIL_FROM), used whenever a unit has
 * no authenticated From of its own.
 * @returns {string} Platform sender address
 */
function getPlatformSenderEmail() {
  return normalizeAddress(process.env.EMAIL_FROM) || DEFAULT_PLATFORM_SENDER;
}

const BREVO_DOMAINS_URL = 'https://api.brevo.com/v3/senders/domains';
const PROVIDER_DOMAINS_TTL_MS = 600000; // 10 minutes
const PROVIDER_DOMAINS_RETRY_MS = 60000; // 1 minute
const PROVIDER_REQUEST_TIMEOUT_MS = 5000;

let providerDomainsCache = { domains: new Set(), expiresAt: 0 };
let providerDomainsRequest = null;

/**
 * Ask Brevo which sender domains it has authenticated (DKIM and DMARC set
 * up and verified in the Brevo account).
 * @returns {Promise<Set<string>>} Lowercased domains
 */
async function fetchProviderAuthenticatedDomains() {
  const response = await fetch(BREVO_DOMAINS_URL, {
    headers: { accept: 'application/json', 'api-key': process.env.BREVO_KEY || process.env.BREVO_API_KEY },
    signal: AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Brevo domains request failed with status ${response.status}`);
  }
  const body = await response.json();
  return new Set((body?.domains || [])
    .filter((entry) => entry?.authenticated === true && typeof entry.domain_name === 'string')
    .map((entry) => entry.domain_name.trim().toLowerCase()));
}

/**
 * Domains Brevo has authenticated, cached for ten minutes so that a domain
 * authenticated in Brevo is picked up without a redeploy. When Brevo cannot
 * be reached, the last known list is kept and the request retried a minute
 * later; with no API key, the list is empty.
 * @returns {Promise<Set<string>>} Lowercased domains
 */
async function getProviderAuthenticatedDomains() {
  if (!(process.env.BREVO_KEY || process.env.BREVO_API_KEY)) {
    return new Set();
  }
  if (Date.now() < providerDomainsCache.expiresAt) {
    return providerDomainsCache.domains;
  }
  providerDomainsRequest ||= fetchProviderAuthenticatedDomains()
    .then((domains) => {
      providerDomainsCache = { domains, expiresAt: Date.now() + PROVIDER_DOMAINS_TTL_MS };
    })
    .catch((err) => {
      console.warn('Could not load authenticated sender domains from Brevo:', err.message);
      providerDomainsCache = { ...providerDomainsCache, expiresAt: Date.now() + PROVIDER_DOMAINS_RETRY_MS };
    })
    .finally(() => {
      providerDomainsRequest = null;
    });
  await providerDomainsRequest;
  return providerDomainsCache.domains;
}

/**
 * Forget the cached Brevo domains (tests, or after changing them in Brevo).
 */
function clearProviderDomainsCache() {
  providerDomainsCache = { domains: new Set(), expiresAt: 0 };
}

/**
 * Domains from which a From address is legitimate: those Brevo reports as
 * authenticated, those the operator lists in EMAIL_AUTHENTICATED_DOMAINS, and
 * the platform's own domain.
 * @returns {Promise<Set<string>>} Lowercased domains
 */
async function getAuthenticatedSenderDomains() {
  const configured = (process.env.EMAIL_AUTHENTICATED_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  const provider = await getProviderAuthenticatedDomains();
  return new Set([domainOf(getPlatformSenderEmail()), ...configured, ...provider]);
}

/**
 * Whether an address may appear in the From header of mail we send.
 * @param {string} address - Candidate From address
 * @returns {Promise<boolean>} True when its domain is authenticated with the provider
 */
async function isAuthenticatedSenderAddress(address) {
  const normalized = normalizeAddress(address);
  return isValidAddress(normalized) && (await getAuthenticatedSenderDomains()).has(domainOf(normalized));
}

/**
 * Reduce a stored organization domain to the mail domain it stands for:
 * `www.meute6a.app` and `*.meute6a.app` both stand for `meute6a.app`.
 * @param {string} domain - organization_domains.domain value
 * @returns {string} Bare domain
 */
function bareDomain(domain) {
  return String(domain || '').trim().toLowerCase().replace(/^(\*\.|www\.)/, '');
}

/**
 * Authenticated domains a unit may send From: those registered to the unit
 * in organization_domains, and to no other unit. The platform's own domain is
 * excluded — every unit is reachable under it, so letting one claim it would
 * let it pose as the platform or as another unit. A domain that another unit
 * also lists (`meute6a.app` and `www.meute6a.app` count as the same) is
 * withheld from both, since neither can then be told apart from the other.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit id
 * @returns {Promise<string[]>} Sorted domains
 */
async function getUnitSenderDomains(pool, organizationId) {
  const result = await pool.query(
    'SELECT domain FROM organization_domains WHERE organization_id = $1',
    [organizationId]
  );
  const authenticated = await getAuthenticatedSenderDomains();
  const platformDomain = domainOf(getPlatformSenderEmail());
  const candidates = [...new Set(
    result.rows
      .map((row) => bareDomain(row.domain))
      .filter((domain) => domain !== platformDomain && authenticated.has(domain))
  )];
  if (candidates.length === 0) {
    return [];
  }

  const shared = await pool.query(
    `SELECT DISTINCT LOWER(REGEXP_REPLACE(TRIM(domain), '^(\\*\\.|www\\.)', '', 'i')) AS domain
     FROM organization_domains
     WHERE organization_id <> $1
       AND LOWER(REGEXP_REPLACE(TRIM(domain), '^(\\*\\.|www\\.)', '', 'i')) = ANY($2::text[])`,
    [organizationId, candidates]
  );
  const claimedElsewhere = new Set(shared.rows.map((row) => row.domain));
  return candidates.filter((domain) => !claimedElsewhere.has(domain)).sort();
}

/**
 * The From address a unit gets when it has not chosen one: the platform
 * mailbox name (`info` in `info@wampums.app`) on the unit's own authenticated
 * domain, or the platform address itself when the unit has none. When a unit
 * has several domains, the first in alphabetical order is used.
 *
 * @param {string[]} unitDomains - Result of getUnitSenderDomains()
 * @returns {string} Default From address
 */
function getDefaultSenderEmail(unitDomains) {
  const platformSender = getPlatformSenderEmail();
  if (unitDomains.length === 0) {
    return platformSender;
  }
  return `${platformSender.slice(0, platformSender.lastIndexOf('@'))}@${unitDomains[0]}`;
}

/**
 * Validate an email_sender payload. Ownership of the From domain is checked
 * against `allowedFromDomains`, which the caller loads for the unit.
 *
 * @param {Object} input - Request body
 * @param {string[]} allowedFromDomains - Domains this unit may send From
 * @returns {{ value: Object, errors: Array<{field: string, message: string}> }}
 */
function validateEmailSenderSettings(input, allowedFromDomains) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const errors = [];

  const fromName = typeof source.from_name === 'string' ? source.from_name.trim() : '';
  if (fromName.length > MAX_FROM_NAME_LENGTH || CONTROL_CHARACTERS.test(fromName)) {
    errors.push({ field: 'from_name', message: `Display name must be a single line of at most ${MAX_FROM_NAME_LENGTH} characters` });
  }

  const replyTo = normalizeAddress(source.reply_to);
  if (replyTo && !isValidAddress(replyTo)) {
    errors.push({ field: 'reply_to', message: 'Reply-to must be a valid email address' });
  }

  const fromEmail = normalizeAddress(source.from_email);
  if (fromEmail) {
    if (!isValidAddress(fromEmail)) {
      errors.push({ field: 'from_email', message: 'Sender address must be a valid email address' });
    } else if (!allowedFromDomains.includes(domainOf(fromEmail))) {
      errors.push({
        field: 'from_email',
        message: 'Sender address must use a domain authenticated for this unit. Use reply_to for other addresses, such as Gmail.',
      });
    }
  }

  return {
    value: { from_name: fromName, from_email: fromEmail, reply_to: replyTo },
    errors,
  };
}

/**
 * Parse a stored setting value (jsonb, or a legacy JSON string).
 * @param {unknown} raw - setting_value
 * @returns {Object} Settings object
 */
function parseStoredSetting(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Resolve the identity a unit's email is sent with, for `sendEmail`'s sender
 * argument. The From address is re-checked here, so a domain removed from the
 * unit or from EMAIL_AUTHENTICATED_DOMAINS falls back to the unit's default
 * address instead of sending unauthenticated mail.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit id
 * @returns {Promise<{name: string, email: string, replyTo: (string|null)}>}
 */
async function resolveOrganizationEmailSender(pool, organizationId) {
  const result = await pool.query(
    `SELECT
       (SELECT setting_value FROM organization_settings
         WHERE organization_id = $1 AND setting_key = $2) AS sender,
       COALESCE(
         (SELECT setting_value->>'name' FROM organization_settings
           WHERE organization_id = $1 AND setting_key = 'organization_info'),
         (SELECT name FROM organizations WHERE id = $1)
       ) AS organization_name`,
    [organizationId, EMAIL_SENDER_SETTING_KEY]
  );
  const row = result.rows[0] || {};
  const stored = parseStoredSetting(row.sender);

  const allowed = await getUnitSenderDomains(pool, organizationId);
  const fromEmail = normalizeAddress(stored.from_email);
  const email = fromEmail && allowed.includes(domainOf(fromEmail))
    ? fromEmail
    : getDefaultSenderEmail(allowed);

  const replyTo = normalizeAddress(stored.reply_to);
  return {
    name: (typeof stored.from_name === 'string' && stored.from_name.trim())
      || row.organization_name
      || 'Wampums',
    email,
    replyTo: isValidAddress(replyTo) ? replyTo : null,
  };
}

module.exports = {
  EMAIL_SENDER_SETTING_KEY,
  clearProviderDomainsCache,
  getAuthenticatedSenderDomains,
  getDefaultSenderEmail,
  getPlatformSenderEmail,
  getUnitSenderDomains,
  isAuthenticatedSenderAddress,
  resolveOrganizationEmailSender,
  validateEmailSenderSettings,
};
