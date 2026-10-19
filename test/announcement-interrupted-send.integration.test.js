/**
 * Interrupted announcement sends — integration suite
 *
 * A send cut off by a restart left its announcement in 'sending' for good:
 * nothing picked it up again and it could not be archived. The scheduler now
 * marks such a send failed once it is clearly stale, so a leader sees it and
 * can send it again, while a send still in progress is left alone.
 *
 * Skipped unless SCOUT_YEAR_TEST_DATABASE_URL (or TEST_DATABASE_URL) points at
 * a disposable database holding the project schema and migrations.
 *
 * @module test/announcement-interrupted-send.integration
 */

const { Pool } = require('pg');

require('./jest-conditional-helpers');

const DATABASE_URL = process.env.SCOUT_YEAR_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;

const { processScheduledAnnouncementsForTests } = require('../routes/announcements');

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe.skipIf(!DATABASE_URL)('Announcements cut off mid-send', () => {
  let pool;
  let organizationId;
  let userId;

  /**
   * @param {string} status - Announcement status
   * @param {string} age - How long ago it was last touched, as a PostgreSQL interval
   * @returns {Promise<number>} The announcement id
   */
  async function insertAnnouncement(status, age) {
    const { rows } = await pool.query(
      `INSERT INTO announcements (organization_id, created_by, subject, message, status, updated_at)
       VALUES ($1, $2, 'Subject', 'Message', $3, NOW() - $4::interval)
       RETURNING id`,
      [organizationId, userId, status, age],
    );
    return rows[0].id;
  }

  /**
   * @param {number} id - Announcement id
   * @returns {Promise<string>} Its current status
   */
  async function statusOf(id) {
    const { rows } = await pool.query('SELECT status FROM announcements WHERE id = $1', [id]);
    return rows[0].status;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    // The program section and its unit reference each other; the key is
    // checked at commit.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const org = await client.query(
        "INSERT INTO organizations (name) VALUES ('Interrupted send unit') RETURNING id",
      );
      organizationId = org.rows[0].id;
      await client.query(
        `INSERT INTO organization_program_sections (organization_id, section_key, display_name)
         VALUES ($1, 'general', 'General')`,
        [organizationId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const user = await pool.query(
      `INSERT INTO users (email, password)
       VALUES ('interrupted-send-' || gen_random_uuid() || '@example.test', 'x')
       RETURNING id`,
    );
    userId = user.rows[0].id;
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM organizations WHERE id = $1', [organizationId]);
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      await pool.end();
    }
  });

  test('a send cut off two hours ago is marked failed so a leader can resend it', async () => {
    const id = await insertAnnouncement('sending', '2 hours');

    await processScheduledAnnouncementsForTests(pool, logger);

    expect(await statusOf(id)).toBe('failed');
  });

  test('a send that started a few minutes ago is left to finish', async () => {
    const id = await insertAnnouncement('sending', '5 minutes');

    await processScheduledAnnouncementsForTests(pool, logger);

    expect(await statusOf(id)).toBe('sending');
  });

  test('an announcement already sent is not touched', async () => {
    const id = await insertAnnouncement('sent', '2 hours');

    await processScheduledAnnouncementsForTests(pool, logger);

    expect(await statusOf(id)).toBe('sent');
  });
});
