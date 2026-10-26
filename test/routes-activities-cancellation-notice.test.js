/**
 * Deleting an activity can announce its cancellation.
 *
 * The person deleting chooses (`?notify_participants=true`): deleting also
 * removes mistakes, which nobody needs to hear about. When they do choose it,
 * the people to tell are read before the deletion withdraws the carpool
 * offers that name the drivers, and emailed only once the activity is gone.
 * A failed email never undoes or fails the deletion.
 *
 * @module test/routes-activities-cancellation-notice
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn()
  };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return {
    Pool: jest.fn(() => mPool),
    __esModule: true,
    __mClient: mClient,
    __mPool: mPool
  };
});

jest.mock('../utils/carpool-notifications', () => ({
  sendRideCancellationNotifications: jest.fn().mockResolvedValue(undefined),
  sendActivityUpdateNotifications: jest.fn().mockResolvedValue(undefined),
  findActivityCancellationRecipients: jest.fn(),
  sendActivityCancellationNotifications: jest.fn().mockResolvedValue(undefined),
}));

const { setupDefaultMocks, mockQueryImplementation } = require('./mock-helpers');
const notifications = require('../utils/carpool-notifications');

let app;

const TEST_SECRET = 'testsecret';
const ORG_ID = 3;
const ACTIVITY_ID = 100;
const NOTICE = {
  activity: { activity_name: 'Sortie canot', activity_date: '2026-11-22', invites_everyone: true },
  recipients: [
    { email: 'ada.parent@example.test', name: 'Ada Lovelace' },
    { email: 'akela@example.test', name: 'Julie Gagnon' },
  ],
};

function generateToken() {
  return jwt.sign({
    user_id: 1,
    organizationId: ORG_ID,
    roleIds: [1],
    roleNames: ['admin'],
    permissions: ['activities.view', 'activities.delete'],
  }, TEST_SECRET);
}

/** Answers the deletion's queries, recording the order of what happened. */
function mockDeletion(events) {
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query) => {
    if (query.includes('SELECT id FROM activities')) {
      return Promise.resolve({ rows: [{ id: ACTIVITY_ID }] });
    }
    if (query.includes('UPDATE carpool_offers')) {
      events.push('carpools withdrawn');
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('UPDATE permission_slips')) {
      return Promise.resolve({ rows: [] });
    }
    if (query.includes('UPDATE activities') && query.includes('is_active = FALSE')) {
      events.push('activity deleted');
      return Promise.resolve({ rows: [{ id: ACTIVITY_ID, is_active: false }] });
    }
    return undefined;
  });
  notifications.findActivityCancellationRecipients.mockImplementation(() => {
    events.push('recipients read');
    return Promise.resolve(NOTICE);
  });
  notifications.sendActivityCancellationNotifications.mockImplementation(() => {
    events.push('emails sent');
    return Promise.resolve();
  });
}

function deleteActivity(query = '') {
  return request(app)
    .delete(`/api/v1/activities/${ACTIVITY_ID}${query}`)
    .set('Authorization', `Bearer ${generateToken()}`);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  process.env.DB_USER = 'test';
  process.env.DB_HOST = 'localhost';
  process.env.DB_NAME = 'testdb';
  process.env.DB_PASSWORD = 'test';
  process.env.DB_PORT = '5432';

  app = require('../api');
});

beforeEach(() => {
  const { __mClient, __mPool } = require('pg');
  setupDefaultMocks(__mClient, __mPool);
  jest.clearAllMocks();
});

afterAll((done) => {
  closeServerResources(app, done);
});

describe('deleting an activity', () => {
  test('nobody is emailed unless the person deleting asks for it', async () => {
    const events = [];
    mockDeletion(events);

    const res = await deleteActivity();

    expect(res.status).toBe(200);
    expect(events).toEqual(['carpools withdrawn', 'activity deleted']);
    expect(notifications.findActivityCancellationRecipients).not.toHaveBeenCalled();
    expect(notifications.sendActivityCancellationNotifications).not.toHaveBeenCalled();
  });

  test('when asked, the people to tell are read before the carpools are withdrawn and emailed after the deletion', async () => {
    const events = [];
    mockDeletion(events);

    const res = await deleteActivity('?notify_participants=true');

    expect(res.status).toBe(200);
    expect(events).toEqual(['recipients read', 'carpools withdrawn', 'activity deleted', 'emails sent']);
    expect(notifications.findActivityCancellationRecipients).toHaveBeenCalledWith(expect.anything(), ACTIVITY_ID, ORG_ID);
    expect(notifications.sendActivityCancellationNotifications).toHaveBeenCalledWith(expect.anything(), ORG_ID, NOTICE);
  });

  test('a failed email does not fail the deletion', async () => {
    mockDeletion([]);
    notifications.sendActivityCancellationNotifications.mockRejectedValueOnce(new Error('provider down'));

    const res = await deleteActivity('?notify_participants=true');

    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });

  test('when the people to tell cannot be read, the activity is still deleted and nobody is emailed', async () => {
    const events = [];
    mockDeletion(events);
    notifications.findActivityCancellationRecipients.mockRejectedValueOnce(new Error('db down'));

    const res = await deleteActivity('?notify_participants=true');

    expect(res.status).toBe(200);
    expect(events).toEqual(['carpools withdrawn', 'activity deleted']);
    expect(notifications.sendActivityCancellationNotifications).not.toHaveBeenCalled();
  });

  test('another unit\'s activity is not found, and nobody is emailed', async () => {
    const { __mClient, __mPool } = require('pg');
    mockQueryImplementation(__mClient, __mPool, (query) => {
      if (query.includes('SELECT id FROM activities')) {
        return Promise.resolve({ rows: [] });
      }
      return undefined;
    });

    const res = await deleteActivity('?notify_participants=true');

    expect(res.status).toBe(404);
    expect(notifications.findActivityCancellationRecipients).not.toHaveBeenCalled();
    expect(notifications.sendActivityCancellationNotifications).not.toHaveBeenCalled();
  });
});
