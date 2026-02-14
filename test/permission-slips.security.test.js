const request = require('supertest');
const jwt = require('jsonwebtoken');

// Mock pg module before requiring app
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

const { Pool } = require('pg');
let app;

const TEST_SECRET = 'testsecret';
const TEST_TOKEN = '550e8400-e29b-41d4-a716-446655440000';
const TEST_ID = 28;

beforeAll(() => {
    process.env.JWT_SECRET_KEY = TEST_SECRET;
    app = require('../api');
});

afterAll((done) => {
    // Close server and socket.io to prevent hanging
    if (app.server) {
        app.server.close(() => {
            if (app.io) {
                app.io.close();
            }
            done();
        });
    } else {
        done();
    }
});

describe('Permission Slip Security', () => {
    const { __mPool } = require('pg');

    beforeEach(() => {
        __mPool.query.mockReset();
    });

    describe('Public access via Token', () => {
        test('GET /api/v1/resources/permission-slips/v/:token should allow viewing', async () => {
            __mPool.query.mockResolvedValueOnce({
                rows: [{
                    id: TEST_ID,
                    access_token: TEST_TOKEN,
                    activity_title: 'Camp',
                    meeting_date: '2026-06-01',
                    participant_name: 'John Doe',
                    status: 'pending'
                }]
            });

            const res = await request(app).get(`/api/v1/resources/permission-slips/v/${TEST_TOKEN}`);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.access_token).toBe(TEST_TOKEN);
        });

        test('PATCH /api/v1/resources/permission-slips/s/:token should allow signing', async () => {
            // Mock existing slip check
            __mPool.query.mockResolvedValueOnce({
                rows: [{ id: TEST_ID, status: 'pending' }]
            });
            // Mock update
            __mPool.query.mockResolvedValueOnce({
                rows: [{ id: TEST_ID, status: 'signed', signed_by: 'Parent' }]
            });

            const res = await request(app)
                .patch(`/api/v1/resources/permission-slips/s/${TEST_TOKEN}`)
                .send({ signed_by: 'Parent' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.message).toContain('signed');
        });
    });

    describe('Insecure access via ID (Protection Check)', () => {
        test('GET /api/v1/resources/permission-slips/:id/view should REJECT without authentication', async () => {
            const res = await request(app).get(`/api/v1/resources/permission-slips/${TEST_ID}/view`);

            expect(res.status).toBe(401);
        });

        test('PATCH /api/v1/resources/permission-slips/:id/sign should REJECT without authentication', async () => {
            const res = await request(app)
                .patch(`/api/v1/resources/permission-slips/${TEST_ID}/sign`)
                .send({ signed_by: 'Attacker' });

            expect(res.status).toBe(401);
        });

        test('GET /api/v1/resources/permission-slips/:id/view should allow with valid authentication', async () => {
            const token = jwt.sign({ user_id: 1, organizationId: 1 }, TEST_SECRET);

            // Mock permissions check
            __mPool.query.mockResolvedValueOnce({
                rows: [{ permission_key: 'activities.view' }]
            });
            // Mock roles check (for context)
            __mPool.query.mockResolvedValueOnce({
                rows: [{ role_name: 'leader', display_name: 'Leader' }]
            });
            // Mock the slip result
            __mPool.query.mockResolvedValueOnce({
                rows: [{ id: TEST_ID, activity_title: 'Camp' }]
            });

            const res = await request(app)
                .get(`/api/v1/resources/permission-slips/${TEST_ID}/view`)
                .set('Authorization', `Bearer ${token}`)
                .set('x-organization-id', '1');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
        });
    });
});
