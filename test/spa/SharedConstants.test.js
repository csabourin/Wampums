import { HTTP_STATUS as serverStatus } from '../../utils/http-status';
import * as serverTimeModule from '../../utils/time-units';
import { HTTP_STATUS as spaStatus } from '../../spa/utils/HttpStatus.js';
import * as spaTime from '../../spa/utils/TimeUnits.js';

const serverTime = { ...serverTimeModule };
delete serverTime.default;

test('the SPA names the same HTTP status codes as the server', () => {
  expect({ ...spaStatus }).toEqual({ ...serverStatus });
});

test('the SPA and the server use the same time units', () => {
  expect({ ...spaTime }).toEqual({ ...serverTime });
});

test('time units multiply out to the familiar durations', () => {
  expect(serverTime.MS_PER_MINUTE).toBe(60000);
  expect(serverTime.MS_PER_HOUR).toBe(3600000);
  expect(serverTime.MS_PER_DAY).toBe(86400000);
  expect(serverTime.MS_PER_WEEK).toBe(604800000);
  expect(serverTime.SECONDS_PER_DAY).toBe(86400);
});
