/**
 * Utility functions for Wampums application
 * Replaces PHP functions.php with Node.js equivalents
 */

const jwt = require('jsonwebtoken');
const Brevo = require('sib-api-v3-sdk');
const nodemailer = require('nodemailer');
const winston = require('winston');

// Configure logger for utilities
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

const brevoClient = Brevo.ApiClient.instance;
let brevoTransactionalApi = null;
let brevoSmtpTransport = null;

// Normalize Brevo API key and sender configuration
const brevoApiKey = process.env.BREVO_KEY || process.env.BREVO_API_KEY;
const senderEmail = process.env.EMAIL_FROM || 'info@meute6a.app';
const senderName = process.env.EMAIL_FROM_NAME || 'Wampums';
const brevoSmtpKey = process.env.BREVO_SMTP_KEY;
const brevoSmtpUser = process.env.BREVO_SMTP_USER || '9d142c001@smtp-brevo.com';

// Initialize Brevo
if (brevoApiKey) {
  const apiKey = brevoClient.authentications['api-key'];
  apiKey.apiKey = brevoApiKey;
  brevoTransactionalApi = new Brevo.TransactionalEmailsApi();
}

/**
 * Calculate age from date of birth
 * @param {string|Date} dateOfBirth - Date of birth
 * @returns {number} Age in years
 */
function calculateAge(dateOfBirth) {
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }

  return age;
}

/**
 * Sanitize input by removing HTML tags and trimming
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
  if (!input) return '';
  return String(input)
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .trim();
}

/**
 * Convert various boolean representations to PostgreSQL boolean ('t' or 'f')
 * @param {any} value - Value to convert
 * @returns {string} 't' or 'f'
 */
function toBool(value) {
  if (typeof value === 'boolean') {
    return value ? 't' : 'f';
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on' || lower === 't') {
      return 't';
    }
  }
  if (typeof value === 'number') {
    return value ? 't' : 'f';
  }
  return 'f';
}

/**
 * Convert PostgreSQL boolean to JavaScript boolean
 * @param {string|boolean} value - PostgreSQL boolean value
 * @returns {boolean}
 */
function fromBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value === 't' || value === 'true' || value === '1';
  }
  return Boolean(value);
}

/**
 * Check if user has access to a participant
 * @param {object} pool - Database pool
 * @param {number} userId - User ID
 * @param {number} participantId - Participant ID
 * @returns {Promise<boolean>}
 */
async function userHasAccessToParticipant(pool, userId, participantId) {
  // Check if user is a guardian of the participant
  const guardianCheck = await pool.query(
    `SELECT 1 FROM user_participants
     WHERE user_id = $1 AND participant_id = $2`,
    [userId, participantId]
  );

  if (guardianCheck.rows.length > 0) {
    return true;
  }

  // Check if user has animation or admin role in same organization
  const roleCheck = await pool.query(
    `SELECT 1
     FROM user_organizations uo
     JOIN participant_organizations po ON uo.organization_id = po.organization_id
     WHERE uo.user_id = $1
       AND po.participant_id = $2
       AND uo.role IN ('animation', 'admin')`,
    [userId, participantId]
  );

  return roleCheck.rows.length > 0;
}

/**
 * Send email using Brevo
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} message - Email message (plain text)
 * @param {string} html - Optional HTML content
 * @returns {Promise<boolean>} Success status
 */
async function sendEmail(to, subject, message, html = null) {
  try {
    // Prefer Brevo transactional API when available
    if (brevoApiKey) {
      if (!brevoTransactionalApi) {
        const apiKey = brevoClient.authentications['api-key'];
        apiKey.apiKey = brevoApiKey;
        brevoTransactionalApi = new Brevo.TransactionalEmailsApi();
      }

      logger.info('Sending email via Brevo API', { to, from: senderEmail });
      const apiPayload = {
        sender: { email: senderEmail, name: senderName },
        to: [{ email: to }],
        subject,
        textContent: message,
        ...(html ? { htmlContent: html } : {})
      };
      const result = await brevoTransactionalApi.sendTransacEmail(apiPayload);
      logger.info('Email sent successfully via Brevo API', { messageId: result?.messageId, to });
      return true;
    }

    if (brevoSmtpKey) {
      if (!brevoSmtpTransport) {
        brevoSmtpTransport = nodemailer.createTransport({
          host: 'smtp-relay.brevo.com',
          port: 587,
          secure: false,
          auth: {
            user: brevoSmtpUser,
            pass: brevoSmtpKey
          }
        });
      }

      logger.info('Sending email via Brevo SMTP relay', { to, from: senderEmail, user: brevoSmtpUser });
      const smtpResult = await brevoSmtpTransport.sendMail({
        from: `${senderName} <${senderEmail}>`,
        to,
        subject,
        text: message,
        ...(html ? { html } : {})
      });
      logger.info('Email sent successfully via SMTP', { messageId: smtpResult?.messageId, to });
      return true;
    }

    logger.error('Brevo API key not found and no SMTP key provided (BREVO_SMTP_KEY)');
    return false;
  } catch (error) {
    logger.error('Error sending email:', error.message || error);
    if (error.response?.body) {
      logger.error('Brevo API error details:', JSON.stringify(error.response.body));
    }
    return false;
  }
}

/**
 * Send password reset email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} message - Email message
 * @returns {Promise<boolean>} Success status
 */
async function sendResetEmail(to, subject, message) {
  return sendEmail(to, subject, message);
}

/**
 * Send admin verification email for new animator registration
 * @param {object} pool - Database pool
 * @param {number} organizationId - Organization ID
 * @param {string} animatorName - Animator name
 * @param {string} animatorEmail - Animator email
 * @param {object} translations - Translation object
 */
async function sendAdminVerificationEmail(pool, organizationId, animatorName, animatorEmail, translations = {}) {
  try {
    // Fetch admin emails for the organization
    const adminResult = await pool.query(
      `SELECT u.email
       FROM users u
       JOIN user_organizations uo ON u.id = uo.user_id
       WHERE uo.organization_id = $1 AND uo.role = 'admin'`,
      [organizationId]
    );

    const adminEmails = adminResult.rows.map(row => row.email);

    if (adminEmails.length === 0) {
      logger.error(`No admin emails found for organization ID: ${organizationId}`);
      return;
    }

    // Fetch organization name
    const orgResult = await pool.query(
      `SELECT setting_value->>'name' as org_name
       FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'organization_info'`,
      [organizationId]
    );

    const orgName = orgResult.rows[0]?.org_name || 'Wampums.app';

    const subject = (translations.new_animator_registration_subject || 'New Animator Registration for {orgName}')
      .replace('{orgName}', orgName);

    const message = (translations.new_animator_registration_body ||
      'A new animator has registered for {orgName}:\n\nName: {animatorName}\nEmail: {animatorEmail}\n\nPlease review and approve their account.')
      .replace('{orgName}', orgName)
      .replace('{animatorName}', animatorName)
      .replace('{animatorEmail}', animatorEmail);

    // Send email to all admins
    for (const adminEmail of adminEmails) {
      const result = await sendEmail(adminEmail, subject, message);
      if (!result) {
        logger.error(`Failed to send admin verification email to: ${adminEmail}`);
      }
    }
  } catch (error) {
    logger.error('Error in sendAdminVerificationEmail:', error);
  }
}

/**
 * Determine organization ID from domain
 * @param {object} pool - Database pool
 * @param {string} domain - Current domain
 * @returns {Promise<number|null>} Organization ID or null
 */
async function determineOrganizationId(pool, domain) {
  try {
    const result = await pool.query(
      `SELECT organization_id
       FROM organization_domains
       WHERE domain = $1
          OR $2 LIKE REPLACE(domain, '*', '%')
       LIMIT 1`,
      [domain, domain]
    );

    return result.rows[0]?.organization_id || null;
  } catch (error) {
    logger.error('Error determining organization ID:', error);
    return null;
  }
}

/**
 * Get JWT payload from request
 * @param {object} req - Express request object
 * @returns {object|null} Decoded JWT payload or null
 */
function getJWTPayload(req) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.decode(token);
    return decoded;
  } catch (error) {
    logger.error('Error decoding JWT:', error);
    return null;
  }
}

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {object|null} Decoded token or null
 */
function verifyJWT(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET_KEY);
  } catch (error) {
    return null;
  }
}

/**
 * Get user ID from JWT token
 * @param {string} token - JWT token
 * @returns {number|null} User ID or null
 */
function getUserIdFromToken(token) {
  const decoded = verifyJWT(token);
  return decoded?.userId || null;
}

/**
 * Get user role from JWT token
 * @param {string} token - JWT token
 * @returns {string|null} User role or null
 */
function getUserRoleFromToken(token) {
  const decoded = verifyJWT(token);
  return decoded?.userRole || null;
}

/**
 * Get organization ID from JWT token
 * @param {string} token - JWT token
 * @returns {number|null} Organization ID or null
 */
function getOrganizationIdFromToken(token) {
  const decoded = verifyJWT(token);
  return decoded?.organizationId || null;
}

/**
 * Format date for PostgreSQL
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string
 */
function formatDateForDB(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.toISOString();
}

/**
 * Parse JSON safely
 * @param {string} jsonString - JSON string to parse
 * @param {any} defaultValue - Default value if parsing fails
 * @returns {any} Parsed object or default value
 */
function safeJSONParse(jsonString, defaultValue = null) {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    return defaultValue;
  }
}

/**
 * Check if user has specific permission
 * @param {object} pool - Database pool
 * @param {number} userId - User ID
 * @param {number} organizationId - Organization ID
 * @param {string[]} allowedRoles - Allowed roles (e.g., ['admin', 'animation'])
 * @returns {Promise<boolean>}
 */
async function hasPermission(pool, userId, organizationId, allowedRoles = ['admin']) {
  try {
    const result = await pool.query(
      `SELECT role
       FROM user_organizations
       WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return allowedRoles.includes(result.rows[0].role);
  } catch (error) {
    logger.error('Error checking permission:', error);
    return false;
  }
}

/**
 * Get point system rules from organization settings
 * Returns organization-specific point values or defaults
 * @param {object} pool - Database pool or client
 * @param {number} organizationId - Organization ID
 * @returns {Promise<object>} Point system rules with attendance point values
 */
async function getPointSystemRules(pool, organizationId) {
  try {
    const result = await pool.query(
      `SELECT setting_value FROM organization_settings
       WHERE organization_id = $1 AND setting_key = 'point_system_rules'`,
      [organizationId]
    );

    if (result.rows.length > 0) {
      const value = result.rows[0].setting_value;
      // Handle both JSON string and already-parsed object (JSONB)
      if (typeof value === 'object' && value !== null) {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch (e) {
        logger.warn('Error parsing point_system_rules:', e);
      }
    }
  } catch (error) {
    logger.error('Error getting point system rules:', error);
  }

  // Default rules if not found or error occurred
  return {
    attendance: {
      present: 1,
      late: 0,
      absent: -1,
      excused: 0
    }
  };
}

module.exports = {
  calculateAge,
  sanitizeInput,
  toBool,
  fromBool,
  userHasAccessToParticipant,
  sendEmail,
  sendResetEmail,
  sendAdminVerificationEmail,
  determineOrganizationId,
  getJWTPayload,
  verifyJWT,
  getUserIdFromToken,
  getUserRoleFromToken,
  getOrganizationIdFromToken,
  formatDateForDB,
  safeJSONParse,
  hasPermission,
  getPointSystemRules
};
