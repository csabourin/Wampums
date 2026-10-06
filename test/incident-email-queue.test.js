/**
 * Incident escalation email queue.
 *
 * The queue is drained both when an incident is submitted and by a periodic
 * retry on every instance, so a batch must be claimed atomically. A send the
 * provider refuses must stay retryable instead of being recorded as sent.
 */

process.env.JWT_SECRET_KEY ||= 'incident-email-queue-test-secret';

jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn(),
}));

const { sendEmail } = require('../utils/index');
const { processEmailQueue } = require('../routes/incidents');

const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();

function queuePool(claimedRows) {
  return {
    query: jest.fn((sql) => {
      if (normalize(sql).startsWith("UPDATE incident_email_queue SET status = 'sending'")) {
        return Promise.resolve({ rows: claimedRows });
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

const queuedEmail = {
  id: 7,
  incident_report_id: 12,
  recipient_email: 'escalation@example.org',
  subject: 'Incident',
  body_text: 'text',
  body_html: '<p>html</p>',
};

describe('processEmailQueue', () => {
  beforeEach(() => {
    sendEmail.mockReset();
  });

  test('claims the batch in one locking statement', async () => {
    const pool = queuePool([]);

    await processEmailQueue(pool, null, 3, 12);

    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(normalize(sql)).toContain('FOR UPDATE SKIP LOCKED');
    expect(normalize(sql)).toContain('RETURNING *');
    expect(params.slice(1)).toEqual([3, 12, 50]);
  });

  test('records a delivered email as sent', async () => {
    sendEmail.mockResolvedValue(true);
    const pool = queuePool([queuedEmail]);

    await processEmailQueue(pool, null);

    const statuses = pool.query.mock.calls.map(([sql]) => normalize(sql));
    expect(statuses).toContain("UPDATE incident_email_queue SET status = 'sent', sent_at = NOW() WHERE id = $1");
  });

  test('keeps a refused email retryable instead of marking it sent', async () => {
    sendEmail.mockResolvedValue(false);
    const pool = queuePool([queuedEmail]);
    const logger = { info: jest.fn(), error: jest.fn() };

    await processEmailQueue(pool, logger);

    const statements = pool.query.mock.calls.map(([sql]) => normalize(sql));
    expect(statements.some((sql) => sql.includes("status = 'sent'"))).toBe(false);
    expect(statements).toContain(
      "UPDATE incident_email_queue SET status = 'failed', error_message = $1 WHERE id = $2"
    );
  });
});
