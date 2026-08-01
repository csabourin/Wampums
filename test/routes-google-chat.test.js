const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockGoogleChatClient = {
  clearClient: jest.fn(),
  getSpace: jest.fn(),
  sendMessageToSpace: jest.fn(),
  sendBroadcast: jest.fn(),
};

jest.mock('../services/google-chat', () => jest.fn().mockImplementation(() => mockGoogleChatClient));

const TEST_SECRET = 'google-chat-route-secret';
const USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ORGANIZATION_ID = 7;

function token(overrides = {}) {
  return jwt.sign({
    user_id: USER_ID,
    user_role: 'district',
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }, TEST_SECRET);
}

function createFixture({
  permissions = ['org.view', 'org.edit', 'communications.send'],
  demo = false,
  failConfigQuery = false,
} = {}) {
  const queryLog = [];
  const pool = {
    query: jest.fn(async (query, params = []) => {
      queryLog.push({ query, params });

      if (query.includes('SELECT organization_id FROM user_organizations')) {
        return { rows: [{ organization_id: ORGANIZATION_ID }] };
      }
      if (query.includes("role_name IN ('demoadmin', 'demoparent')")) {
        return { rows: demo ? [{ role_name: 'demoadmin' }] : [] };
      }
      if (query.includes('SELECT DISTINCT p.permission_key')) {
        return { rows: permissions.map((permission_key) => ({ permission_key })) };
      }
      if (query.includes('SELECT DISTINCT r.role_name')) {
        return { rows: [{ role_name: 'district', display_name: 'District' }] };
      }
      if (query.includes('FROM google_chat_config')) {
        if (failConfigQuery) {
          throw new Error('/srv/app/node_modules/pg SQL relation google_chat_config');
        }
        return {
          rows: [{
            id: 1,
            service_account_email: 'chat@example.iam.gserviceaccount.com',
            project_id: 'wampums-test',
            is_active: true,
          }],
        };
      }
      if (query.includes('INSERT INTO google_chat_config')) {
        return {
          rows: [{ id: 1, service_account_email: params[1], project_id: params[3] }],
        };
      }
      if (query.includes('FROM google_chat_spaces')) {
        return {
          rows: [{ id: 2, space_id: 'spaces/AAAA', space_name: 'Leaders', is_active: true }],
        };
      }
      if (query.includes('INSERT INTO google_chat_spaces')) {
        return {
          rows: [{ id: 2, space_id: params[1], space_name: params[2], is_broadcast_space: params[3] }],
        };
      }
      if (query.includes('FROM google_chat_messages')) {
        return { rows: [{ id: 3, organization_id: params[0], message_text: 'Hello' }] };
      }

      return { rows: [] };
    }),
  };

  const app = express();
  app.locals.pool = pool;
  app.use(express.json());
  app.use('/api/v1/google-chat', require('../routes/google-chat')(pool, {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));

  return { app, pool, queryLog };
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGoogleChatClient.getSpace.mockResolvedValue({ displayName: 'Leaders', spaceType: 'SPACE' });
  mockGoogleChatClient.sendMessageToSpace.mockResolvedValue({ name: 'spaces/AAAA/messages/1' });
  mockGoogleChatClient.sendBroadcast.mockResolvedValue({ name: 'spaces/AAAA/messages/2' });
});

test.each([
  ['get', '/config'],
  ['post', '/config'],
  ['get', '/spaces'],
  ['post', '/spaces'],
  ['post', '/send-message'],
  ['post', '/broadcast'],
  ['get', '/messages'],
])('%s %s is mounted once at the documented prefix and requires authentication', async (method, path) => {
  const { app } = createFixture();
  const response = await request(app)[method](`/api/v1/google-chat${path}`);

  expect(response.status).toBe(401);
  expect(response.body).toEqual(expect.objectContaining({
    success: false,
    message: expect.stringMatching(/authentication required/i),
  }));
});

test('loads configuration with the standard response envelope and tenant scope', async () => {
  const { app, queryLog } = createFixture();
  const response = await request(app)
    .get('/api/v1/google-chat/config')
    .set('Authorization', `Bearer ${token()}`)
    .set('x-organization-id', '99');

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({
    success: true,
    data: expect.objectContaining({ configured: true }),
    timestamp: expect.any(String),
  }));
  const configQuery = queryLog.find(({ query }) => query.includes('FROM google_chat_config'));
  expect(configQuery.params).toEqual([ORGANIZATION_ID]);
});

test('saves credentials, registers/lists a space, sends a message, broadcasts, and lists history', async () => {
  const { app } = createFixture();
  const authorization = `Bearer ${token()}`;
  const credentials = {
    type: 'service_account',
    project_id: 'wampums-test',
    private_key: 'private-key',
    client_email: 'chat@example.iam.gserviceaccount.com',
  };

  const responses = [];
  responses.push(await request(app).post('/api/v1/google-chat/config').set('Authorization', authorization).send({ credentials }));
  responses.push(await request(app).post('/api/v1/google-chat/spaces').set('Authorization', authorization).send({ spaceId: 'spaces/AAAA', isBroadcastSpace: true }));
  responses.push(await request(app).get('/api/v1/google-chat/spaces').set('Authorization', authorization));
  responses.push(await request(app).post('/api/v1/google-chat/send-message').set('Authorization', authorization).send({ spaceId: 'spaces/AAAA', message: 'Hello' }));
  responses.push(await request(app).post('/api/v1/google-chat/broadcast').set('Authorization', authorization).send({ subject: 'News', message: 'Hello all' }));
  responses.push(await request(app).get('/api/v1/google-chat/messages').set('Authorization', authorization));

  expect(responses.map(({ status }) => status)).toEqual([200, 200, 200, 200, 200, 200]);
  responses.forEach(({ body }) => {
    expect(body).toEqual(expect.objectContaining({
      success: true,
      data: expect.anything(),
      timestamp: expect.any(String),
    }));
  });
  expect(mockGoogleChatClient.clearClient).toHaveBeenCalledWith(ORGANIZATION_ID);
  expect(mockGoogleChatClient.sendMessageToSpace).toHaveBeenCalledWith(
    ORGANIZATION_ID,
    'spaces/AAAA',
    'Hello'
  );
  expect(mockGoogleChatClient.sendBroadcast).toHaveBeenCalledWith(
    ORGANIZATION_ID,
    'News',
    'Hello all'
  );
});

test('validates writes after authentication and authorization', async () => {
  const { app } = createFixture();
  const response = await request(app)
    .post('/api/v1/google-chat/send-message')
    .set('Authorization', `Bearer ${token()}`)
    .send({ spaceId: '', message: '' });

  expect(response.status).toBe(400);
  expect(response.body).toEqual(expect.objectContaining({
    success: false,
    errors: expect.any(Array),
  }));
});

test('returns standardized permission details when access is denied', async () => {
  const { app } = createFixture({ permissions: [] });
  const response = await request(app)
    .get('/api/v1/google-chat/config')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(403);
  expect(response.body).toEqual(expect.objectContaining({
    success: false,
    required: ['org.view'],
    missing: ['org.view'],
  }));
});

test('blocks demo-role writes', async () => {
  const { app } = createFixture({ demo: true });
  const response = await request(app)
    .post('/api/v1/google-chat/spaces')
    .set('Authorization', `Bearer ${token()}`)
    .send({ spaceId: 'spaces/AAAA' });

  expect(response.status).toBe(403);
  expect(response.body).toEqual(expect.objectContaining({ success: false, isDemo: true }));
});

test('does not expose provider or database errors', async () => {
  const { app } = createFixture({ failConfigQuery: true });

  const response = await request(app)
    .get('/api/v1/google-chat/config')
    .set('Authorization', `Bearer ${token()}`);

  expect(response.status).toBe(500);
  expect(response.body.message).not.toMatch(/srv|node_modules|relation/i);
});
