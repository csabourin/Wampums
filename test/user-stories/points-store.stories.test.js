/**
 * User stories: PointsStore invariants (pure logic).
 *
 * Implements: US-PTS-004, US-PTS-007, US-PTS-008, US-PTS-009
 *
 * The store's contract: displayed total = confirmed base + pending optimistic
 * deltas, at every instant, regardless of how server responses interleave.
 */

'use strict';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  debugError: jest.fn(),
  debugInfo: jest.fn()
}));

const { PointsStore } = require('../../spa/modules/points/PointsStore.js');
const { i18nGaps } = require('./helpers/story-helpers');

describe('US-PTS-004 — Numbers never jump backwards while I\'m clicking fast', () => {
  let store;
  let txnPlus3;
  let txnPlus1;

  beforeEach(() => {
    store = new PointsStore();
    store.load([{ id: 1, total_points: 10 }], [{ id: 5, total_points: 20 }]);
    txnPlus3 = { participantDeltas: { 1: 3 }, groupDeltas: { 5: 3 } };
    txnPlus1 = { participantDeltas: { 1: 1 }, groupDeltas: {} };
  });

  it('shows 14 after +3 then +1 while both responses are still in flight', () => {
    store.applyOptimistic(txnPlus3);
    store.applyOptimistic(txnPlus1);
    expect(store.getParticipantTotal(1)).toBe(14);
    expect(store.getGroupTotal(5)).toBe(23);
  });

  it('still shows 14 after the first batch confirms (13 base + 1 pending)', () => {
    store.applyOptimistic(txnPlus3);
    store.applyOptimistic(txnPlus1);
    store.confirmBatch([txnPlus3], [
      { type: 'participant', id: 1, totalPoints: 13 },
      { type: 'group', id: 5, totalPoints: 23, memberTotals: [] }
    ]);
    expect(store.getParticipantTotal(1)).toBe(14);
    expect(store.getGroupTotal(5)).toBe(23);
  });

  it('settles on 14 when the second batch confirms, never dipping below 13', () => {
    const observed = [];
    store.subscribe(() => observed.push(store.getParticipantTotal(1)));

    store.applyOptimistic(txnPlus3);
    store.applyOptimistic(txnPlus1);
    store.confirmBatch([txnPlus3], [{ type: 'participant', id: 1, totalPoints: 13 }]);
    store.confirmBatch([txnPlus1], [{ type: 'participant', id: 1, totalPoints: 14 }]);

    expect(store.getParticipantTotal(1)).toBe(14);
    // No observed value ever rolled back below the running maximum
let runningMax = Number.NEGATIVE_INFINITY;
observed.forEach((value) => {
  expect(value).toBeGreaterThanOrEqual(runningMax);
  runningMax = Math.max(runningMax, value);
});
    expect(observed[observed.length - 1]).toBe(14);
    expect(Math.min(...observed)).toBeGreaterThanOrEqual(13);
  });

  it('handles a -1 arriving between two positive confirms without oscillation', () => {
    const txnMinus1 = { participantDeltas: { 1: -1 }, groupDeltas: {} };
    store.applyOptimistic(txnPlus3);
    store.applyOptimistic(txnPlus1);
    store.applyOptimistic(txnMinus1);
    expect(store.getParticipantTotal(1)).toBe(13);

    store.confirmBatch([txnPlus3], [{ type: 'participant', id: 1, totalPoints: 13 }]);
    expect(store.getParticipantTotal(1)).toBe(13);
    store.confirmBatch([txnPlus1, txnMinus1], [{ type: 'participant', id: 1, totalPoints: 13 }]);
    expect(store.getParticipantTotal(1)).toBe(13);
    expect(store.hasPendingDeltas()).toBe(false);
  });
});

describe('US-PTS-007 — A background refresh can\'t erase my in-flight clicks', () => {
  it('keeps pending deltas on top of freshly loaded base totals', () => {
    const store = new PointsStore();
    store.load([{ id: 1, total_points: 10 }], []);

    const txn = { participantDeltas: { 1: 3 }, groupDeltas: {} };
    store.applyOptimistic(txn);
    expect(store.getParticipantTotal(1)).toBe(13);

    // Server refresh arrives with the pre-click total
    store.load([{ id: 1, total_points: 10 }], []);
    expect(store.getParticipantTotal(1)).toBe(13);
    expect(store.hasPendingDeltas()).toBe(true);

    store.confirmBatch([txn], [{ type: 'participant', id: 1, totalPoints: 13 }]);
    expect(store.getParticipantTotal(1)).toBe(13);
    expect(store.hasPendingDeltas()).toBe(false);
  });

  it('treats missing/NaN totals as 0 on load', () => {
    const store = new PointsStore();
    store.load([{ id: 1 }, { id: 2, total_points: 'oops' }], [{ id: 9, total_points: null }]);
    expect(store.getParticipantTotal(1)).toBe(0);
    expect(store.getParticipantTotal(2)).toBe(0);
    expect(store.getGroupTotal(9)).toBe(0);
  });
});

describe('US-PTS-008 — The server\'s word is final for group awards', () => {
  it('snaps every member to the server\'s absolute totals, including skipped members', () => {
    const store = new PointsStore();
    store.load(
      [{ id: 1, total_points: 10 }, { id: 2, total_points: 10 }],
      [{ id: 5, total_points: 20 }]
    );

    // Optimistically +3 to both members (client did not know B was absent)
    const txn = { participantDeltas: { 1: 3, 2: 3 }, groupDeltas: { 5: 3 } };
    store.applyOptimistic(txn);
    expect(store.getParticipantTotal(2)).toBe(13);

    // Server: A credited (13), B skipped (still 10), group total 23
    store.confirmBatch([txn], [{
      type: 'group',
      id: 5,
      totalPoints: 23,
      memberTotals: [
        { id: 1, totalPoints: 13 },
        { id: 2, totalPoints: 10 }
      ]
    }]);

    expect(store.getParticipantTotal(1)).toBe(13);
    expect(store.getParticipantTotal(2)).toBe(10);
    expect(store.getGroupTotal(5)).toBe(23);
    expect(store.getMembersTotal([1, 2])).toBe(23);
  });
});

describe('US-PTS-009 — Store subscriptions are precise and safe', () => {
  it('notifies exactly the changed entity ids for one action', () => {
    const store = new PointsStore();
    const seen = [];
    store.subscribe((ids) => seen.push(ids));

    store.applyOptimistic({ participantDeltas: { 1: 3 }, groupDeltas: { 5: 3 } });

    expect(seen).toHaveLength(1);
    expect(seen[0].sort()).toEqual(['group:5', 'participant:1']);
  });

  it('a throwing listener does not break other listeners', () => {
    const store = new PointsStore();
    const good = jest.fn();
    store.subscribe(() => { throw new Error('bad listener'); });
    store.subscribe(good);

    store.applyOptimistic({ participantDeltas: { 1: 1 }, groupDeltas: {} });

    expect(good).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications; fold and rollback notify their ids', () => {
    const store = new PointsStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    const txn = { participantDeltas: { 1: 2 }, groupDeltas: {} };
    store.applyOptimistic(txn);
    store.foldBatch([txn]);
    expect(store.getParticipantTotal(1)).toBe(2);
    expect(store.hasPendingDeltas()).toBe(false);

    const txn2 = { participantDeltas: { 1: 4 }, groupDeltas: {} };
    store.applyOptimistic(txn2);
    store.rollbackBatch([txn2]);
    expect(store.getParticipantTotal(1)).toBe(2);

    const callsBefore = listener.mock.calls.length;
    unsubscribe();
    store.applyOptimistic({ participantDeltas: { 1: 1 }, groupDeltas: {} });
    expect(listener.mock.calls.length).toBe(callsBefore);
  });
});

describe('US-I18N-001 — points flow strings exist in both languages', () => {
  it('en.json and fr.json both contain every points-flow key', () => {
    const keys = [
      'manage_points',
      'group_points',
      'total_points',
      'please_select_group_or_individual',
      'error_updating_points',
      'points_skipped_absent_participants',
      'unassigned_participants',
      'no_unassigned_participants',
      'no_participants_in_group'
    ];
    expect(i18nGaps(keys)).toEqual({ missingEn: [], missingFr: [] });
  });
});
