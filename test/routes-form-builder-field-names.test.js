/**
 * The form builder refuses field names the SPA cannot draw.
 *
 * DOMPurify strips a control's `name` when it names a property of a form or
 * of `document` (`name`, `title`, `action`…). A field so named loses its
 * answer, as the unit's name did on the unit creation form. A name the stored
 * format already uses is kept, so an older form can still be edited.
 *
 * @module test/routes-form-builder-field-names
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mClient = { query: jest.fn(), release: jest.fn() };
  const mPool = {
    connect: jest.fn(() => Promise.resolve(mClient)),
    query: jest.fn(),
    on: jest.fn()
  };
  return { Pool: jest.fn(() => mPool), __esModule: true, __mClient: mClient, __mPool: mPool };
});

const { mockQueryImplementation } = require('./mock-helpers');

const TEST_SECRET = 'testsecret';
const ORG_ID = 1;
const FORMAT_ID = 7;
const USER_ID = '00000000-0000-4000-8000-000000000001';
const STORED = { fields: [{ name: 'name', type: 'text', label: 'Name' }] };

let app;
let queries;

function token() {
  return jwt.sign({ user_id: USER_ID, organizationId: ORG_ID, roleIds: [1], roleNames: ['leader'], permissions: ['forms.manage'] }, TEST_SECRET);
}

beforeAll(() => {
  process.env.JWT_SECRET_KEY = TEST_SECRET;
  process.env.ORGANIZATION_ID = ORG_ID.toString();
  app = require('../api');
});

beforeEach(() => {
  queries = [];
  const { __mClient, __mPool } = require('pg');
  mockQueryImplementation(__mClient, __mPool, (query) => {
    if (query.includes('permission_key')) {
      return { rows: [{ permission_key: 'forms.manage' }] };
    }
    queries.push(query);
    if (/SELECT id(, form_type)?, form_structure FROM organization_form_formats/.test(query)) {
      return { rows: [{ id: FORMAT_ID, form_type: 'organization_info', form_structure: STORED }] };
    }
    if (/UPDATE organization_form_formats/.test(query)) {
      return { rows: [{ id: FORMAT_ID, form_structure: STORED }] };
    }
    return undefined;
  });
});

afterAll((done) => {
  closeServerResources(app, done);
});

const auth = (req) => req.set('Authorization', `Bearer ${token()}`);

describe('form field names', () => {
  it('a new form cannot name a field "title", and is told which field', async () => {
    const res = await auth(request(app).post('/api/v1/form-builder/form-formats')).send({
      form_type: 'sortie',
      form_structure: { fields: [{ name: 'title', type: 'text' }, { name: 'lieu', type: 'text' }] },
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe('form_field_name_reserved');
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'title' })]);
    expect(queries.some((query) => /INSERT INTO organization_form_formats/.test(query))).toBe(false);
  });

  it('a field added as "action" to a stored form is refused', async () => {
    const res = await auth(request(app).put(`/api/v1/form-builder/form-formats/${FORMAT_ID}`)).send({
      form_structure: { fields: [...STORED.fields, { name: 'action', type: 'text' }] },
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'action' })]);
    expect(queries.some((query) => /UPDATE organization_form_formats/.test(query))).toBe(false);
  });

  it('an older form keeps the reserved name it already had', async () => {
    const res = await auth(request(app).put(`/api/v1/form-builder/form-formats/${FORMAT_ID}`)).send({
      form_structure: { fields: [...STORED.fields, { name: 'endroit', type: 'text' }] },
    });

    expect(res.status).toBe(200);
  });

  it('a new version cannot add a field named "submit"', async () => {
    const res = await auth(request(app).post(`/api/v1/form-builder/form-formats/${FORMAT_ID}/versions`)).send({
      form_structure: { fields: [{ name: 'submit', type: 'text' }] },
    });

    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual([expect.objectContaining({ field: 'submit' })]);
    expect(queries.some((query) => /create_new_form_version/.test(query))).toBe(false);
  });
});
