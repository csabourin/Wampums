'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const request = require('supertest');
process.env.JWT_SECRET_KEY ||= 'authorization-context-test-secret';
const { signJWTToken } = require('../utils/jwt-config');
const { authenticate, optionalAuth, requirePermission, requireAnyPermission, userHasPermission } = require('../middleware/auth');

const USER_ID = '11111111-2222-4333-8444-555555555555';
const ORGANIZATION_ID = 3;

function signed(claims = {}) {
  return signJWTToken({ user_id: USER_ID, organizationId: ORGANIZATION_ID, permissions: ['forged'], ...claims });
}

function server(pool) {
  const app = express();
  app.locals.pool = pool;
  // Mirrors production, where every API route sits behind a limiter.
  app.use(rateLimit({ windowMs: 60000, limit: 1000 }));
  app.get('/member', authenticate, requirePermission('first'), (_req, res) => res.json({ success: true }));
  app.get('/visitor', optionalAuth, (req, res) => res.json({ signedIn: Boolean(req.user) }));
  app.get('/composed', authenticate, requirePermission('first'), requireAnyPermission('second', 'third'), async (req, res) => {
    res.json({ allowed: await userHasPermission(req, pool, ORGANIZATION_ID, 'fourth'), permissions: req.userPermissions });
  });
  return app;
}

test('a database outage is a server failure and never invalidates a valid session', async () => {
  const pool = { query: jest.fn(() => Promise.reject(new Error('database unavailable'))) };
  const response = await request(server(pool)).get('/member').set('Authorization', `Bearer ${signed()}`);
  expect(response.status).toBe(500);
  expect(response.body.message).toBe('internal_server_error');
  expect(response.body.message).not.toMatch(/token/i);
});

test('optional authentication also reports database failures instead of silently signing out', async () => {
  const pool = { query: jest.fn(() => Promise.reject(new Error('database unavailable'))) };
  const response = await request(server(pool)).get('/visitor').set('Authorization', `Bearer ${signed()}`);
  expect(response.status).toBe(500);
});

test('optional authentication keeps invalid credentials on a public page signed out', async () => {
  const pool = { query: jest.fn() };
  const response = await request(server(pool)).get('/visitor').set('Authorization', 'Bearer invalid');
  expect(response.status).toBe(200);
  expect(response.body.signedIn).toBe(false);
  expect(pool.query).not.toHaveBeenCalled();
});

test('a signed token without an account cannot act as an authenticated organization member', async () => {
  const pool = { query: jest.fn() };
  const response = await request(server(pool)).get('/member')
    .set('Authorization', `Bearer ${signed({ user_id: null })}`);
  expect(response.status).toBe(401);
  expect(response.body.message).toMatch(/authentication required/i);
  expect(pool.query).not.toHaveBeenCalled();
});

test('a signed account without a unit cannot choose an authenticated unit through a header', async () => {
  const pool = { query: jest.fn() };
  const response = await request(server(pool)).get('/member')
    .set('Authorization', `Bearer ${signed({ organizationId: null })}`)
    .set('x-organization-id', String(ORGANIZATION_ID));
  expect(response.status).toBe(401);
  expect(pool.query).not.toHaveBeenCalled();
});

test('all, any and a later conditional permission read share a complete current context', async () => {
  const pool = { query: jest.fn((sql) => {
    if (sql.includes('SELECT organization_id FROM user_organizations')) {
      return Promise.resolve({ rows: [{ organization_id: ORGANIZATION_ID }] });
    }
    if (sql.includes('AS authorization_permissions')) {
      return Promise.resolve({ rows: [{ status: 'active',
        authorization_permissions: ['first', 'second', 'fourth'],
        authorization_roles: [{ role_name: 'custom', display_name: 'Custom', data_scope: 'organization' }],
        authorization_forms: {},
      }] });
    }
    throw new Error('Unexpected authorization query');
  }) };
  const response = await request(server(pool)).get('/composed').set('Authorization', `Bearer ${signed()}`);
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ allowed: true, permissions: ['first', 'second', 'fourth'] });
  expect(pool.query.mock.calls.filter(([sql]) => sql.includes('AS authorization_permissions'))).toHaveLength(1);
  expect(pool.query).toHaveBeenCalledTimes(2);
});
