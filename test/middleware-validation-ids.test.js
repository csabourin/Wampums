/**
 * Integer ids are refused before they reach the database unless they fit a
 * PostgreSQL `integer`: a larger one would fail there with a 500, and a
 * partial number such as `12abc` must not be read as 12.
 */

const { validationResult } = require('express-validator');
const {
  validateIdParam,
  validateIdBody,
  validateIdBodyOptional,
  validateIdQuery,
} = require('../middleware/validation');

/**
 * Run one validation chain against a request.
 *
 * @param {Object} chain - express-validator chain
 * @param {Object} req - Request with params, body and query
 * @returns {Promise<boolean>} Whether the value passed
 */
async function passes(chain, req) {
  await chain.run(req);
  return validationResult(req).isEmpty();
}

const cases = [
  ['a URL parameter', validateIdParam('id'), (value) => ({ params: { id: value }, body: {}, query: {} })],
  ['a body field', validateIdBody('id'), (value) => ({ params: {}, body: { id: value }, query: {} })],
  ['an optional body field', validateIdBodyOptional('id'), (value) => ({ params: {}, body: { id: value }, query: {} })],
  ['a query parameter', validateIdQuery('id'), (value) => ({ params: {}, body: {}, query: { id: value } })],
];

describe.each(cases)('an id in %s', (_label, chain, request) => {
  test('accepts the largest PostgreSQL integer', async () => {
    expect(await passes(chain, request('2147483647'))).toBe(true);
  });

  test('refuses one beyond it, instead of letting the database answer 500', async () => {
    expect(await passes(chain, request('2147483648'))).toBe(false);
  });

  test.each(['0', '-1', '12abc', '1.5'])('refuses %s', async (value) => {
    expect(await passes(chain, request(value))).toBe(false);
  });
});
