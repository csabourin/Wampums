/**
 * Test copies of emails meant for families.
 *
 * A leader can send themselves the exact email families will receive
 * (an announcement, a permission slip) before sending it for real. The copy
 * is the same message with "[TEST]" (translated) before its subject and a short note at
 * the top, in the leader's language, saying who it went to and what does
 * not work in a test.
 *
 * @module utils/test-email
 */

const { escapeHtml } = require('./api-helpers');
const { getTranslationsByCode, getUserEmailLanguage } = require('./index');

const BANNER_STYLE = 'padding: 12px; margin-bottom: 16px; border: 2px dashed #b45309; background: #fffbeb; color: #78350f; border-radius: 4px;';

/**
 * A translation in the given language, else in English, else the fallback.
 *
 * @param {string} languageCode - Language of the recipient
 * @param {string} key - Translation key
 * @param {string} fallback - Text when no bundle has the key
 * @returns {string}
 */
function translateFor(languageCode, key, fallback) {
  return getTranslationsByCode(languageCode)?.[key]
    || getTranslationsByCode('en')?.[key]
    || fallback;
}

/**
 * Turn an email for families into its test copy.
 *
 * @param {{subject: string, textBody: string, htmlBody: (string|null)}} email - The email families get
 * @param {Object} options
 * @param {string} options.languageCode - The tester's language
 * @param {string[]} [options.noteKeys] - Extra notes to add, as translation keys
 * @returns {{subject: string, textBody: string, htmlBody: string}}
 */
function markAsTestEmail(email, { languageCode, noteKeys = [] }) {
  const notes = [
    translateFor(languageCode, 'email_test_banner',
      'Test email sent to you only. Families will receive this message as it is, without this note.'),
    ...noteKeys.map((key) => translateFor(languageCode, key, '')),
  ].filter(Boolean);

  const body = email.htmlBody || `<div>${escapeHtml(email.textBody || '').replace(/\n/g, '<br>')}</div>`;
  const prefix = translateFor(languageCode, 'email_test_subject_prefix', '[TEST]');
  return {
    subject: `${prefix} ${email.subject}`,
    textBody: `${notes.map((note) => `*** ${note} ***`).join('\n')}\n\n${email.textBody || ''}`,
    htmlBody: `<div style="${BANNER_STYLE}">${notes.map((note) => `<p style="margin: 0;">${escapeHtml(note)}</p>`).join('')}</div>${body}`,
  };
}

/**
 * The signed-in member's address and email language, to send a test to.
 *
 * @param {Object} pool - Database pool
 * @param {string} userId - The member's UUID
 * @param {number} organizationId - The unit
 * @returns {Promise<{email: string, languageCode: string}|null>} Null without an address
 */
async function findTestRecipient(pool, userId, organizationId) {
  const result = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
  const email = result.rows[0]?.email;
  if (!email) {
    return null;
  }
  return { email, languageCode: await getUserEmailLanguage(pool, email, organizationId) };
}

module.exports = {
  findTestRecipient,
  markAsTestEmail,
};
