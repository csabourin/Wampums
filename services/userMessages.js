/**
 * Pushed messages kept for their recipients, so a tapped notification opens a
 * page that shows the message instead of losing it.
 *
 * @module services/userMessages
 */

/** Path of the SPA page that shows one message. */
const MESSAGE_PATH = '/messages';

/**
 * Record one copy of a message for each person it is pushed to.
 *
 * @param {Object} pool - Database pool or client
 * @param {Object} message
 * @param {number} message.organizationId - Unit sending it
 * @param {string[]} message.userIds - Recipients' account ids (duplicates and nulls are ignored)
 * @param {string} message.title - Title as sent
 * @param {string} message.body - Text as sent
 * @param {string|null} [message.sentBy] - Sender's account id
 * @param {number|null} [message.announcementId] - Announcement it belongs to
 * @returns {Promise<Map<string, number>>} Message id for each recipient
 */
async function recordUserMessages(pool, {
  organizationId, userIds, title, body, sentBy = null, announcementId = null,
}) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (recipients.length === 0) {
    return new Map();
  }
  const result = await pool.query(
    `INSERT INTO user_messages (organization_id, user_id, announcement_id, sent_by, title, body)
     SELECT $1, recipient, $3, $4, $5, $6 FROM unnest($2::uuid[]) AS recipient
     RETURNING id, user_id`,
    [organizationId, recipients, announcementId, sentBy, title, body]
  );
  return new Map(result.rows.map((row) => [row.user_id, row.id]));
}

/**
 * The page a notification opens: the recipient's copy of the message, or the
 * list of messages when there is none (a device registered without an account).
 *
 * @param {Map<string, number>} messageIds - From recordUserMessages
 * @param {string|null} userId - Recipient's account id
 * @returns {string} App path
 */
function messageUrl(messageIds, userId) {
  const id = userId ? messageIds.get(userId) : null;
  return id ? `${MESSAGE_PATH}/${id}` : MESSAGE_PATH;
}

module.exports = { recordUserMessages, messageUrl };
