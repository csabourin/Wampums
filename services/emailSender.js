/**
 * Unit email sender identity.
 *
 * A unit may change how its outgoing email presents itself, but only in ways
 * that receiving servers will accept as legitimate:
 *
 * - `from_name`: the display name (`"Meute 6A" <…>`). Always allowed.
 * - `reply_to`: where replies go. Any address, including a Gmail one: the
 *   Reply-To header is not checked by SPF, DKIM or DMARC.
 * - `from_email`: the From address itself. Allowed only on a domain that the
 *   platform operator has authenticated with the email provider (listed in
 *   EMAIL_AUTHENTICATED_DOMAINS) AND that is registered to this unit in
 *   organization_domains. A From on any other domain — gmail.com, or another
 *   unit's domain — would fail DMARC alignment and be treated as spoofing.
 *
 * The setting is stored as `organization_settings.email_sender`.
 *
 * @module services/emailSender
 */

const EMAIL_SENDER_SETTING_KEY = 'email_sender';
const MAX_EMAIL_LENGTH = 254;
const MAX_FROM_NAME_LENGTH = 100;
const DEFAULT_PLATFORM_SENDER = 'info@wampums.app';
const EMAIL_PATTERN = /^[^\s@<>"(),;:\\[\]]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
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
  return address.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(address);
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

/**
 * Domains the email provider has authenticated (DKIM-signed for), and from
 * which a From address is therefore legitimate. The platform's own domain is
 * always included.
 * @returns {Set<string>} Lowercased domains
 */
function getAuthenticatedSenderDomains() {
  const configured = (process.env.EMAIL_AUTHENTICATED_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return new Set([domainOf(getPlatformSenderEmail()), ...configured]);
}

/**
 * Whether an address may appear in the From header of mail we send.
 * @param {string} address - Candidate From address
 * @returns {boolean} True when its domain is authenticated with the provider
 */
function isAuthenticatedSenderAddress(address) {
  const normalized = normalizeAddress(address);
  return isValidAddress(normalized) && getAuthenticatedSenderDomains().has(domainOf(normalized));
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
 * in organization_domains. The platform's own domain is excluded — every unit
 * is reachable under it, so letting one claim it would let it pose as the
 * platform or as another unit.
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
  const authenticated = getAuthenticatedSenderDomains();
  const platformDomain = domainOf(getPlatformSenderEmail());
  const domains = new Set(
    result.rows
      .map((row) => bareDomain(row.domain))
      .filter((domain) => domain !== platformDomain && authenticated.has(domain))
  );
  return [...domains].sort();
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
 * unit or from EMAIL_AUTHENTICATED_DOMAINS falls back to the platform address
 * instead of sending unauthenticated mail.
 *
 * @param {Object} pool - Database pool
 * @param {number} organizationId - Unit id
 * @returns {Promise<{name: string, email: (string|null), replyTo: (string|null)}>}
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

  let email = null;
  const fromEmail = normalizeAddress(stored.from_email);
  if (fromEmail) {
    const allowed = await getUnitSenderDomains(pool, organizationId);
    email = allowed.includes(domainOf(fromEmail)) ? fromEmail : null;
  }

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
  getAuthenticatedSenderDomains,
  getPlatformSenderEmail,
  getUnitSenderDomains,
  isAuthenticatedSenderAddress,
  resolveOrganizationEmailSender,
  validateEmailSenderSettings,
};
