/**
 * Stripe webhook — signature checked on the bytes Stripe sent
 *
 * Stripe signs the raw request body. The app parsed every JSON body before
 * any route ran, so the webhook route received an object, signature
 * verification refused every genuine event, and card payments were charged
 * without ever being recorded. These tests sign events with Stripe's own
 * library and send them through the whole app, rather than mocking
 * constructEvent the way test/routes-stripe-payments.test.js does.
 *
 * @module test/stripe-webhook-signature
 */

const request = require('supertest');
const { closeServerResources } = require('./test-helpers');

const WEBHOOK_SECRET = 'whsec_test_signature_suite';
const STRIPE_KEY = 'sk_test_signature_suite';
const PAYMENT_INTENT_ID = 'pi_signature_suite';
const FEE_ID = 42;
const ORG_ID = 1;

jest.mock('stripe', () => {
  const Stripe = jest.requireActual('stripe');
  return () => Stripe('sk_test_signature_suite');
});

const mockRoomEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockRoomEmit, except: () => ({ emit: mockRoomEmit }) }));
jest.mock('../services/socket', () => ({
  init: jest.fn(),
  getIO: () => ({ to: mockTo, sockets: { sockets: new Map() } }),
}));

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(() => Promise.resolve({ rows: [] })),
    on: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient };
});

const Stripe = jest.requireActual('stripe');
const signer = Stripe(STRIPE_KEY);

let app;

/**
 * @param {Object} event - Stripe event
 * @returns {import('supertest').Test} The signed webhook request
 */
function sendSigned(event) {
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return request(app)
    .post('/api/v1/stripe/webhook')
    .set('stripe-signature', header)
    .set('Content-Type', 'application/json')
    .send(payload);
}

/** @returns {string[]} SQL the webhook ran on its transaction client */
function clientSql() {
  const { __mClient } = require('pg');
  return __mClient.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' ').trim());
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'testsecret';
  process.env.STRIPE_SECRET_KEY = STRIPE_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  app = require('../api');
});

afterAll((done) => {
  closeServerResources(app, done);
});

/** @returns {Promise<void>} Let the live-sync announcement, made after the response, complete */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  mockRoomEmit.mockClear();
  mockTo.mockClear();
  const { __mClient } = require('pg');
  __mClient.query.mockReset();
  __mClient.query.mockImplementation((sql, params) => {
    if (/FROM participant_fees WHERE id = \$1 AND organization_id = \$2 FOR UPDATE/.test(sql)) {
      const inUnit = String(params[0]) === String(FEE_ID) && String(params[1]) === String(ORG_ID);
      return Promise.resolve({ rows: inUnit ? [{ id: FEE_ID }] : [] });
    }
    if (/INSERT INTO payments/.test(sql)) {
      return Promise.resolve({ rows: [{ id: 7 }] });
    }
    if (/COALESCE\(SUM\(p\.amount\), 0\) as total_paid/.test(sql)) {
      return Promise.resolve({ rows: [{ total_amount: '50.00', total_paid: '50.00' }] });
    }
    return Promise.resolve({ rows: [] });
  });
});

describe('POST /api/v1/stripe/webhook', () => {
  test('a genuinely signed event is accepted', async () => {
    const res = await sendSigned({ id: 'evt_other', type: 'customer.created', data: { object: {} } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  test('an event whose body was altered after signing is refused', async () => {
    const payload = JSON.stringify({ id: 'evt_tampered', type: 'customer.created', data: { object: {} } });
    const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });

    const res = await request(app)
      .post('/api/v1/stripe/webhook')
      .set('stripe-signature', header)
      .set('Content-Type', 'application/json')
      .send(payload.replace('evt_tampered', 'evt_tampered2'));

    expect(res.status).toBe(400);
  });

  test('a card payment Stripe confirms is recorded against its fee', async () => {
    const res = await sendSigned({
      id: 'evt_paid',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: PAYMENT_INTENT_ID,
          amount: 5000,
          currency: 'cad',
          payment_method: 'pm_test',
          metadata: { participant_fee_id: String(FEE_ID), participant_id: '3', organization_id: String(ORG_ID) },
        },
      },
    });

    expect(res.status).toBe(200);
    const { __mClient } = require('pg');
    const insert = __mClient.query.mock.calls.find(([sql]) => /INSERT INTO payments/.test(sql));
    expect(insert).toBeDefined();
    expect(insert[1][0]).toBe(String(FEE_ID));
    expect(insert[1][1]).toBe(50);
    expect(clientSql()).toContain('UPDATE participant_fees SET status = $1 WHERE id = $2');

    // The unit's open finance screens hear of it as if a leader had entered the payment.
    await settle();
    expect(mockTo).toHaveBeenCalledWith(`org-${ORG_ID}`);
    expect(mockRoomEmit).toHaveBeenCalledWith('data-changed', expect.objectContaining({
      path: `/api/v1/finance/participant-fees/${FEE_ID}/payments`,
    }));
  });

  test('a payment already recorded is not announced again', async () => {
    const { __mClient } = require('pg');
    const base = __mClient.query.getMockImplementation();
    __mClient.query.mockImplementation((sql, params) => (/FROM payments WHERE stripe_payment_intent_id/.test(sql)
      ? Promise.resolve({ rows: [{ id: 7 }] })
      : base(sql, params)));

    const res = await sendSigned({
      id: 'evt_paid_again',
      type: 'payment_intent.succeeded',
      data: { object: { id: PAYMENT_INTENT_ID, amount: 5000, currency: 'cad', metadata: { participant_fee_id: String(FEE_ID), organization_id: String(ORG_ID) } } },
    });

    await settle();
    expect(res.status).toBe(200);
    expect(clientSql().some((s) => /INSERT INTO payments/.test(s))).toBe(false);
    expect(mockRoomEmit).not.toHaveBeenCalled();
  });

  test('the fee is locked before checking for an earlier delivery of the same payment', async () => {
    await sendSigned({
      id: 'evt_paid_twice',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: PAYMENT_INTENT_ID,
          amount: 5000,
          currency: 'cad',
          metadata: { participant_fee_id: String(FEE_ID), organization_id: String(ORG_ID) },
        },
      },
    });

    const sql = clientSql();
    const lock = sql.findIndex((s) => /FROM participant_fees WHERE id = \$1 AND organization_id = \$2 FOR UPDATE/.test(s));
    const duplicateCheck = sql.findIndex((s) => /FROM payments WHERE stripe_payment_intent_id = \$1/.test(s));
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(duplicateCheck);
  });

  test('a payment naming a fee outside its unit is not recorded', async () => {
    const res = await sendSigned({
      id: 'evt_wrong_unit',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: PAYMENT_INTENT_ID,
          amount: 5000,
          currency: 'cad',
          metadata: { participant_fee_id: String(FEE_ID), organization_id: '999' },
        },
      },
    });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(clientSql().some((s) => /INSERT INTO payments/.test(s))).toBe(false);
    expect(clientSql()).toContain('ROLLBACK');
  });
});
