/**
 * @jest-environment jsdom
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

import { decodeJWT } from '../../spa/jwt-helper.js';

function toBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64url');
}

describe('decodeJWT', () => {
  test('decodes unpadded base64url and UTF-8 claims', () => {
    const payload = {
      user_id: 'abc-123',
      full_name: 'Élodie 🧭',
      marker: '\u{10ffff}',
    };
    const token = `e30.${toBase64Url(payload)}.signature`;

    expect(decodeJWT(token)).toEqual(payload);
  });

  test('returns null for malformed tokens', () => {
    expect(decodeJWT('not-a-token')).toBeNull();
    expect(decodeJWT('one.two.three')).toBeNull();
  });
});
