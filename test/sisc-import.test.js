const express = require('express');
const request = require('supertest');
const { parseSiscCsv } = require('../utils/siscCsv');
const { SISC_IMPORT_LIMITS: LIMITS } = require('../config/constants');

jest.mock('../middleware/auth', () => ({
  authenticate: (_req, _res, next) => next(),
  blockDemoRoles: (_req, _res, next) => next(),
  requirePermission: () => (_req, _res, next) => next(),
  getOrganizationId: jest.fn().mockResolvedValue(1),
}));

jest.mock('../services/roleVisibility', () => ({ resolveUnitRoleId: jest.fn().mockResolvedValue(1) }));
jest.mock('../services/roleAssignment', () => ({ checkRolesGrantable: jest.fn().mockResolvedValue({ allowed: true }) }));

const INVALID_IMPORTS = [
  ['an absent CSV', undefined, 400],
  ['a null CSV', null, 400],
  ['an object with an attacker-controlled length', { length: Number.MAX_SAFE_INTEGER }, 400],
  ['an array instead of CSV text', ['nom;prenom', 'Roy;Léa'], 400],
  ['empty CSV text', ' \n ', 400],
  ['a header without data', 'nom;prenom', 400],
  ['an unclosed quoted field', 'nom;prenom\n"Roy;Léa', 400],
  ['too many data rows', `nom;prenom\n${'Roy;Léa\n'.repeat(LIMITS.MAX_DATA_ROWS + 1)}`, 413],
  ['too many columns', `nom\n${Array(LIMITS.MAX_COLUMNS + 1).fill('x').join(';')}`, 413],
  ['an oversized field', `nom\n${'x'.repeat(LIMITS.MAX_FIELD_LENGTH + 1)}`, 413],
  ['an oversized line', `nom\n${'"'.repeat(LIMITS.MAX_LINE_LENGTH + 1)}`, 413],
  ['an oversized UTF-8 file', `nom\n${'é'.repeat(LIMITS.MAX_BYTES / 2)}`, 413],
];

test('a SISC import preserves accents, quoted separators, CRLF and blank lines', () => {
  expect(parseSiscCsv('"nom";"prenom"\r\n\r\n"Roy;Dupont";"Léa"\r\n'))
    .toEqual([['nom', 'prenom'], ['Roy;Dupont', 'Léa']]);
});

test('a SISC import accepts the configured row, field and column boundaries', () => {
  expect(parseSiscCsv(`nom\n${'Roy\n'.repeat(LIMITS.MAX_DATA_ROWS)}`))
    .toHaveLength(LIMITS.MAX_DATA_ROWS + 1);
  expect(parseSiscCsv(`nom\n${'x'.repeat(LIMITS.MAX_FIELD_LENGTH)}`)[1][0])
    .toHaveLength(LIMITS.MAX_FIELD_LENGTH);
  expect(parseSiscCsv(`nom\n${Array(LIMITS.MAX_COLUMNS).fill('x').join(';')}`)[1])
    .toHaveLength(LIMITS.MAX_COLUMNS);
});

describe('SISC import validation before database work', () => {
  const pool = { connect: jest.fn(), query: jest.fn() };
  const logger = { info: jest.fn(), error: jest.fn() };
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api/v1/import', require('../routes/import')(pool, logger));

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each(INVALID_IMPORTS)('rejects %s before acquiring a database connection', async (_label, csvContent, status) => {
    const response = await request(app).post('/api/v1/import/sisc').send({ csvContent });
    expect(response.status).toBe(status);
    expect(response.body.success).toBe(false);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).not.toHaveBeenCalled();
  });

  test('a valid CSV still imports its parsed names into the authenticated unit', async () => {
    const client = {
      query: jest.fn((sql) => Promise.resolve({
        rows: sql.includes('SELECT p.id FROM participants') ? [{ id: 7 }] : [],
      })),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    pool.query.mockResolvedValue({ rows: [{ count: '1' }] });
    const response = await request(app).post('/api/v1/import/sisc').send({
      csvContent: 'nom;prenom;naissance\n"Roy;Dupont";Léa;20160503',
    });
    expect(response.status).toBe(200);
    expect(response.body.stats.participantsUpdated).toBe(1);
    expect(response.body.stats.errors).toEqual([]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT p.id FROM participants'),
      ['Léa', 'Roy;Dupont', '2016-05-03', 1],
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });

});
