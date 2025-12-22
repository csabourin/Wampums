/**
 * Two-Factor Authentication (2FA) Utility Functions
 * Handles code generation, validation, trusted devices, and email sending
 */

const crypto = require('crypto');
const winston = require('winston');
const { sendEmail, getUserEmailLanguage, getTranslationsByCode } = require('./index');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

/**
 * Generate a random 6-digit verification code
 * @returns {string} 6-digit code
 */
function generate2FACode() {
  // Generate a random number between 100000 and 999999
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  return code;
}

/**
 * Hash a verification code using SHA256
 * @param {string} code - The verification code
 * @returns {string} Hashed code
 */
function hash2FACode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/**
 * Generate a unique device token
 * @returns {string} 64-character hex token
 */
function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a device fingerprint from user agent
 * @param {string} userAgent - User agent string
 * @param {string} userId - User ID for additional uniqueness
 * @returns {string} Hashed fingerprint
 */
function createDeviceFingerprint(userAgent, userId) {
  const combined = `${userAgent}:${userId}`;
  return crypto.createHash('sha256').update(combined).digest('hex');
}

/**
 * Parse user agent to extract device name
 * @param {string} userAgent - User agent string
 * @returns {string} Human-readable device name
 */
function parseDeviceName(userAgent) {
  if (!userAgent) return 'Unknown Device';

  // Extract browser
  let browser = 'Unknown Browser';
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
  else if (userAgent.includes('Firefox')) browser = 'Firefox';
  else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';
  else if (userAgent.includes('Edg')) browser = 'Edge';
  else if (userAgent.includes('Opera') || userAgent.includes('OPR')) browser = 'Opera';

  // Extract OS
  let os = 'Unknown OS';
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac OS X') || userAgent.includes('Macintosh')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  return `${browser} on ${os}`;
}

/**
 * Store 2FA code in database
 * @param {object} pool - Database pool
 * @param {string} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {string} code - Verification code
 * @param {string} ipAddress - User's IP address
 * @param {string} userAgent - User agent string
 * @returns {Promise<object>} Created record
 */
async function store2FACode(pool, userId, organizationId, code, ipAddress, userAgent) {
  const codeHash = hash2FACode(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  try {
    const result = await pool.query(
      `INSERT INTO two_factor_codes
        (user_id, organization_id, code, code_hash, expires_at, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, expires_at`,
      [userId, organizationId, code, codeHash, expiresAt, ipAddress, userAgent]
    );

    logger.info('2FA code stored successfully', { userId, organizationId });
    return result.rows[0];
  } catch (error) {
    logger.error('Error storing 2FA code:', error);
    throw error;
  }
}

/**
 * Verify 2FA code
 * @param {object} pool - Database pool
 * @param {string} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {string} code - Code to verify
 * @returns {Promise<boolean>} Whether code is valid
 */
async function verify2FACode(pool, userId, organizationId, code) {
  const codeHash = hash2FACode(code);

  try {
    // Find the most recent unverified code for this user
    const result = await pool.query(
      `SELECT id, attempts, expires_at, verified
      FROM two_factor_codes
      WHERE user_id = $1
        AND organization_id = $2
        AND code_hash = $3
        AND verified = false
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1`,
      [userId, organizationId, codeHash]
    );

    if (result.rows.length === 0) {
      logger.warn('2FA code not found or expired', { userId, organizationId });
      return false;
    }

    const codeRecord = result.rows[0];

    // Check if too many attempts
    if (codeRecord.attempts >= 5) {
      logger.warn('Too many 2FA verification attempts', { userId, organizationId });
      return false;
    }

    // Mark as verified
    await pool.query(
      `UPDATE two_factor_codes
      SET verified = true, attempts = attempts + 1
      WHERE id = $1`,
      [codeRecord.id]
    );

    logger.info('2FA code verified successfully', { userId, organizationId });
    return true;
  } catch (error) {
    logger.error('Error verifying 2FA code:', error);

    // Increment attempt counter even on error
    try {
      await pool.query(
        `UPDATE two_factor_codes
        SET attempts = attempts + 1
        WHERE user_id = $1
          AND organization_id = $2
          AND code_hash = $3
          AND verified = false`,
        [userId, organizationId, codeHash]
      );
    } catch (updateError) {
      logger.error('Error incrementing attempt counter:', updateError);
    }

    return false;
  }
}

/**
 * Create a trusted device record
 * @param {object} pool - Database pool
 * @param {string} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {string} userAgent - User agent string
 * @returns {Promise<string>} Device token
 */
async function createTrustedDevice(pool, userId, organizationId, userAgent) {
  const deviceToken = generateDeviceToken();
  const deviceFingerprint = createDeviceFingerprint(userAgent, userId);
  const deviceName = parseDeviceName(userAgent);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  try {
    await pool.query(
      `INSERT INTO trusted_devices
        (user_id, organization_id, device_token, device_name, device_fingerprint, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, organizationId, deviceToken, deviceName, deviceFingerprint, expiresAt]
    );

    logger.info('Trusted device created', { userId, organizationId, deviceName });
    return deviceToken;
  } catch (error) {
    logger.error('Error creating trusted device:', error);
    throw error;
  }
}

/**
 * Verify if a device is trusted
 * @param {object} pool - Database pool
 * @param {string} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {string} deviceToken - Device token from client
 * @returns {Promise<boolean>} Whether device is trusted
 */
async function verifyTrustedDevice(pool, userId, organizationId, deviceToken) {
  if (!deviceToken) return false;

  try {
    const result = await pool.query(
      `SELECT id, expires_at
      FROM trusted_devices
      WHERE user_id = $1
        AND organization_id = $2
        AND device_token = $3
        AND is_active = true
        AND expires_at > NOW()`,
      [userId, organizationId, deviceToken]
    );

    if (result.rows.length > 0) {
      // Update last_used_at
      await pool.query(
        `UPDATE trusted_devices
        SET last_used_at = NOW()
        WHERE id = $1`,
        [result.rows[0].id]
      );

      logger.info('Trusted device verified', { userId, organizationId });
      return true;
    }

    logger.info('Device not trusted', { userId, organizationId });
    return false;
  } catch (error) {
    logger.error('Error verifying trusted device:', error);
    return false;
  }
}

/**
 * Send 2FA verification code via email
 * @param {string} email - Recipient email
 * @param {string} code - Verification code
 * @param {string} userName - User's full name
 * @param {number|null} organizationId - Organization ID for language fallback
 * @param {object|null} pool - Database pool to resolve user preferences
 * @returns {Promise<boolean>} Success status
 */
async function send2FAEmail(email, code, userName = '', organizationId = null, pool = null) {
  const safeUserName = (userName || '').trim();
  const preferredLanguage = organizationId && pool
    ? await getUserEmailLanguage(pool, email, organizationId)
    : 'en';
  const translations = getTranslationsByCode(preferredLanguage);
  const fallbackTranslations = getTranslationsByCode('en');

  const subject = translations.two_factor_email_subject || fallbackTranslations.two_factor_email_subject || 'Your Wampums verification code';
  const greetingTemplate = translations.two_factor_email_greeting || fallbackTranslations.two_factor_email_greeting || 'Hello {name},';
  const intro = translations.two_factor_email_intro || fallbackTranslations.two_factor_email_intro || 'Please use the following code to complete your login:';
  const expires = translations.two_factor_email_expiry || fallbackTranslations.two_factor_email_expiry || 'This code will expire in 10 minutes.';
  const ignore = translations.two_factor_email_ignore || fallbackTranslations.two_factor_email_ignore || "If you didn't request this code, please ignore this email and ensure your account is secure.";
  const footer = translations.two_factor_email_footer || fallbackTranslations.two_factor_email_footer || 'This is an automated message from Wampums. Please do not reply to this email.';
  const greeting = greetingTemplate.replace('{name}', safeUserName || translations.two_factor_email_generic_name || fallbackTranslations.two_factor_email_generic_name || '');

  const textMessage = `
${greeting}

${intro}

${translations.two_factor_email_code_label || fallbackTranslations.two_factor_email_code_label || 'Verification code'}: ${code}

${expires}

${ignore}

${footer}
  `.trim();

  const htmlMessage = `
<!DOCTYPE html>
<html lang="${preferredLanguage}">
<head>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      text-align: center;
      padding: 20px 0;
    }
    .code-container {
      background: #f5f5f5;
      border: 2px dashed #007bff;
      border-radius: 8px;
      padding: 30px;
      text-align: center;
      margin: 30px 0;
    }
    .code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 8px;
      color: #007bff;
      font-family: 'Courier New', monospace;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #666;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>${translations.two_factor_email_heading || fallbackTranslations.two_factor_email_heading || 'Wampums Verification Code'}</h2>
  </div>

  <p>${greeting}</p>

  <p>${intro}</p>

  <div class="code-container">
    <div class="code">${code}</div>
  </div>

  <p><strong>${expires}</strong></p>

  <p>${ignore}</p>

  <div class="footer">
    <p>${footer}</p>
  </div>
</body>
</html>
  `.trim();

  try {
    const success = await sendEmail(email, subject, textMessage, htmlMessage);
    if (success) {
      logger.info('2FA email sent successfully', { email });
    } else {
      logger.error('Failed to send 2FA email', { email });
    }
    return success;
  } catch (error) {
    logger.error('Error sending 2FA email:', error);
    return false;
  }
}

/**
 * Clean up expired codes and devices (should be run periodically)
 * @param {object} pool - Database pool
 * @returns {Promise<object>} Cleanup statistics
 */
async function cleanupExpired2FAData(pool) {
  try {
    const codesResult = await pool.query(
      `DELETE FROM two_factor_codes
      WHERE expires_at < NOW()
      RETURNING id`
    );

    const devicesResult = await pool.query(
      `DELETE FROM trusted_devices
      WHERE expires_at < NOW()
      RETURNING id`
    );

    logger.info('2FA cleanup completed', {
      codesDeleted: codesResult.rowCount,
      devicesDeleted: devicesResult.rowCount,
    });

    return {
      codesDeleted: codesResult.rowCount,
      devicesDeleted: devicesResult.rowCount,
    };
  } catch (error) {
    logger.error('Error cleaning up 2FA data:', error);
    throw error;
  }
}

module.exports = {
  generate2FACode,
  hash2FACode,
  generateDeviceToken,
  createDeviceFingerprint,
  parseDeviceName,
  store2FACode,
  verify2FACode,
  createTrustedDevice,
  verifyTrustedDevice,
  send2FAEmail,
  cleanupExpired2FAData,
};
