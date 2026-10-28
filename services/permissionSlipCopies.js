const { sendEmail, getUserEmailLanguage } = require('../utils/index');
const { buildPermissionSlipLeaderCopyContent } = require('../utils/permission-slip-email');
const { listActivityLeaderContacts } = require('./unitLeaders');
const { resolveOrganizationBaseUrl } = require('../utils/public-url');

/** Share the family/leader copy receipts across both permission workflows. */
const ISO_DATE_LENGTH = 10;
module.exports = (pool) => {
  const parseDate = (date) => new Date(date).toISOString().slice(0, ISO_DATE_LENGTH);
  /**
   * Send the unit's leaders a copy, for information, of the request the
   * families just received: once per leader and activity, without a signing
   * link. A leader who is the parent of an invited child and received the
   * parent's email, with its link, gets no copy: that delivery was recorded
   * as their claim (recordFamilyDelivery). One whose family email failed
   * still gets the copy.
   *
   * Each copy is claimed in permission_slip_leader_copies before it is sent,
   * so the parallel requests of one large send mail each leader once. A copy
   * the email service refused gives its claim back for the next send.
   *
   * @param {number} organizationId - Active organization
   * @param {object[]} sentSlips - Slips whose email went to at least one family
   * @param {object} sender - Unit email sender
   * @returns {Promise<number>} Copies sent
   */
  /**
   * What a slip was for, as permission_slip_leader_copies records it.
   * @param {object} slip - Permission slip row
   * @returns {string} 'activity:<id>' or 'meeting:<date>:<title>'
   */
  function slipGroupKey(slip) {
    return slip.activity_id
      ? `activity:${slip.activity_id}`
      : `meeting:${parseDate(slip.meeting_date)}:${slip.activity_title || ''}`;
  }

  /**
   * A family email reached this address: an account with it (a leader who is
   * also a parent) has the request, with its signing link, and needs no copy.
   *
   * @param {number} organizationId - Active organization
   * @param {object} slip - The slip emailed
   * @param {string} email - Address that accepted it
   * @returns {Promise<void>}
   */
  async function recordFamilyDelivery(organizationId, slip, email) {
    await pool.query(
      `INSERT INTO permission_slip_leader_copies (organization_id, group_key, user_id)
       SELECT $1, $2, u.id FROM users u WHERE LOWER(u.email) = LOWER($3)
       ON CONFLICT (organization_id, group_key, user_id) DO NOTHING`,
      [organizationId, slipGroupKey(slip), email],
    );
  }

  async function sendLeaderCopies(organizationId, sentSlips, sender) {
    if (sentSlips.length === 0) {
      return 0;
    }
    const leaders = await listActivityLeaderContacts(pool, organizationId);
    if (leaders.length === 0) {
      return 0;
    }

    const groups = new Map();
    for (const slip of sentSlips) {
      const groupKey = slipGroupKey(slip);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, slip);
      }
    }
    const baseUrl = await resolveOrganizationBaseUrl(pool, organizationId);

    const sentPerGroup = await Promise.all([...groups].map(async ([groupKey, slip]) => {
      const followLink = slip.activity_id
        ? `${baseUrl}/permission-slips/${slip.activity_id}`
        : `${baseUrl}/permission-slips`;

      const outcomes = await Promise.all(leaders
        .map(async (leader) => {
          const claim = await pool.query(
            `INSERT INTO permission_slip_leader_copies (organization_id, group_key, user_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, group_key, user_id) DO NOTHING
             RETURNING id`,
            [organizationId, groupKey, leader.id],
          );
          if (claim.rows.length === 0) {
            return false;
          }
          const languageCode = await getUserEmailLanguage(pool, leader.email, organizationId);
          const { subject, textBody, htmlBody } = buildPermissionSlipLeaderCopyContent({
            activityTitle: slip.activity_title,
            activityDescription: slip.activity_description,
            activityDescriptionHtml: slip.activity_description_html,
            meetingDate: slip.meeting_date,
            deadlineDate: slip.deadline_date,
            followLink,
            languageCode,
          });
          const delivered = await sendEmail(leader.email, subject, textBody, htmlBody, sender);
          if (!delivered) {
            await pool.query(
              'DELETE FROM permission_slip_leader_copies WHERE id = $1',
              [claim.rows[0].id],
            );
          }
          return Boolean(delivered);
        }));
      return outcomes.filter(Boolean).length;
    }));
    return sentPerGroup.reduce((total, count) => total + count, 0);
  }

  return { recordFamilyDelivery, sendLeaderCopies };
};
