/**
 * The meeting-plan assistant names the previous meeting's honour. It reads it
 * from the honours history, whose rows carry first_name, last_name, reason and
 * date (routes/honors.js, GET /v1/honors/history).
 *
 * @module test/spa/HonorUtils
 */

import { honorForMeetingPlan } from '../../spa/utils/HonorUtils.js';

const historyRow = {
  id: 3,
  date: '2026-10-10',
  reason: 'Aide aux plus jeunes',
  participant_id: 1,
  first_name: 'Léa',
  last_name: 'Tremblay',
  group_name: 'Tanière rouge',
};

test('the assistant receives the honoured youth, the reason and the date', () => {
  expect(honorForMeetingPlan(historyRow, 'Loup d’honneur')).toEqual({
    name: 'Léa Tremblay',
    honor: 'Aide aux plus jeunes',
    date: '2026-10-10',
  });
});

test('an honour without a reason is named by the unit’s own term', () => {
  expect(honorForMeetingPlan({ ...historyRow, reason: null }, 'Loup d’honneur').honor).toBe('Loup d’honneur');
});

test('no honour, or one nobody is named in, sends none', () => {
  expect(honorForMeetingPlan(null, 'Loup d’honneur')).toBeNull();
  expect(honorForMeetingPlan({ reason: 'x', date: '2026-10-10' }, 'Loup d’honneur')).toBeNull();
});
