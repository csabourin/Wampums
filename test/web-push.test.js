const { sortPushResults } = require('../utils/web-push');

const refused = (statusCode) => ({ status: 'rejected', reason: Object.assign(new Error('refused'), { statusCode }) });
const delivered = { status: 'fulfilled', value: { statusCode: 201 } };
const devices = (count) => Array.from({ length: count }, (_, index) => ({ endpoint: `https://push.example/${index}` }));

describe('sortPushResults', () => {
  test.each([[404], [410]])('a gone device (%p) is always forgotten', (statusCode) => {
    const { sent, refusals, invalidEndpoints } = sortPushResults([refused(statusCode)], devices(1));

    expect(sent).toBe(0);
    expect(refusals).toEqual([]);
    expect(invalidEndpoints).toEqual(['https://push.example/0']);
  });

  test.each([[401], [403]])('a device refused for its key (%p) is forgotten once another device accepted the send', (statusCode) => {
    const { sent, refusals, invalidEndpoints } = sortPushResults([delivered, refused(statusCode)], devices(2));

    expect(sent).toBe(1);
    expect(refusals).toHaveLength(1);
    expect(invalidEndpoints).toEqual(['https://push.example/1']);
  });

  test('when every device refuses for the key, the server keys are suspect and nobody is forgotten', () => {
    const { invalidEndpoints, refusals } = sortPushResults([refused(403), refused(401)], devices(2));

    expect(invalidEndpoints).toEqual([]);
    expect(refusals).toHaveLength(2);
  });

  test.each([[429], [500], [503], [undefined]])('a passing failure (%p) keeps the device', (statusCode) => {
    const { invalidEndpoints } = sortPushResults([delivered, refused(statusCode)], devices(2));

    expect(invalidEndpoints).toEqual([]);
  });
});
