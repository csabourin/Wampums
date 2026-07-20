// PointsStore.js
// Single source of truth for participant and group point totals.
//
// The displayed total for every entity is always:
//     displayed = base (last confirmed server total) + pending optimistic deltas
//
// This invariant makes the UI stable no matter how server responses and user
// clicks interleave: confirming a batch moves its deltas from "pending" into
// "base" (using the server's absolute total), so the displayed number never
// jumps backwards while other deltas are still in flight.
//
// The DOM must never be used to store or derive totals — subscribe to the
// store and render from it.

import { debugWarn } from '../../utils/DebugUtils.js';

/**
 * A transaction groups the optimistic deltas of one user action (e.g. "+3 to
 * group 5") so they can later be confirmed, folded, or rolled back together.
 * @typedef {Object} PointsTransaction
 * @property {Object<string, number>} participantDeltas - participantId -> delta
 * @property {Object<string, number>} groupDeltas - groupId -> delta
 */

export class PointsStore {
  constructor() {
    this.baseParticipantTotals = new Map();
    this.baseGroupTotals = new Map();
    this.pendingParticipantDeltas = new Map();
    this.pendingGroupDeltas = new Map();
    this.listeners = new Set();
  }

  /**
   * Load confirmed totals from server/cache data. Pending deltas are kept:
   * a reload while updates are in flight must not erase optimistic state.
   * @param {Array<{id: number|string, total_points?: number}>} participants
   * @param {Array<{id: number|string, total_points?: number}>} groups
   */
  load(participants = [], groups = []) {
    participants.forEach((participant) => {
      this.baseParticipantTotals.set(
        String(participant.id),
        Number(participant.total_points) || 0,
      );
    });
    groups.forEach((group) => {
      this.baseGroupTotals.set(
        String(group.id),
        Number(group.total_points) || 0,
      );
    });
    this.emit(this.allIds());
  }

  getParticipantTotal(participantId) {
    const key = String(participantId);
    return (this.baseParticipantTotals.get(key) || 0) +
      (this.pendingParticipantDeltas.get(key) || 0);
  }

  getGroupTotal(groupId) {
    const key = String(groupId);
    return (this.baseGroupTotals.get(key) || 0) +
      (this.pendingGroupDeltas.get(key) || 0);
  }

  /**
   * Sum of displayed member totals for a group
   * @param {Array<number|string>} memberIds
   */
  getMembersTotal(memberIds) {
    return memberIds.reduce((sum, id) => sum + this.getParticipantTotal(id), 0);
  }

  /**
   * Apply the optimistic deltas of one user action.
   * @param {PointsTransaction} txn
   * @returns {PointsTransaction} the same transaction, for later confirm/rollback
   */
  applyOptimistic(txn) {
    this.addDeltas(txn, 1);
    this.emit(this.txnIds(txn));
    return txn;
  }

  /**
   * A batch containing this transaction was confirmed by the server.
   * Server absolute totals become the new base; the transaction's deltas
   * leave the pending pool. Other in-flight deltas remain applied on top.
   * @param {PointsTransaction[]} txns - Transactions included in the batch
   * @param {Array} serverUpdates - Response entries from POST /v1/points
   */
  confirmBatch(txns, serverUpdates = []) {
    txns.forEach((txn) => this.addDeltas(txn, -1));

    const changed = new Set();
    txns.forEach((txn) => this.txnIds(txn).forEach((id) => changed.add(id)));

    serverUpdates.forEach((update) => {
      if (update.type === 'group') {
        this.baseGroupTotals.set(String(update.id), Number(update.totalPoints) || 0);
        changed.add(`group:${update.id}`);
        (update.memberTotals || []).forEach((member) => {
          this.baseParticipantTotals.set(String(member.id), Number(member.totalPoints) || 0);
          changed.add(`participant:${member.id}`);
        });
      } else {
        this.baseParticipantTotals.set(String(update.id), Number(update.totalPoints) || 0);
        changed.add(`participant:${update.id}`);
      }
    });

    this.emit([...changed]);
  }

  /**
   * A batch was queued for offline sync: fold its deltas into the base so the
   * optimistic totals survive page reloads (they are persisted via the cache).
   * @param {PointsTransaction[]} txns
   */
  foldBatch(txns) {
    txns.forEach((txn) => {
      Object.entries(txn.participantDeltas || {}).forEach(([id, delta]) => {
        this.baseParticipantTotals.set(
          String(id),
          (this.baseParticipantTotals.get(String(id)) || 0) + delta,
        );
      });
      Object.entries(txn.groupDeltas || {}).forEach(([id, delta]) => {
        this.baseGroupTotals.set(
          String(id),
          (this.baseGroupTotals.get(String(id)) || 0) + delta,
        );
      });
      this.addDeltas(txn, -1);
    });
    const changed = new Set();
    txns.forEach((txn) => this.txnIds(txn).forEach((id) => changed.add(id)));
    this.emit([...changed]);
  }

  /**
   * A batch failed: remove its deltas from the pending pool.
   * @param {PointsTransaction[]} txns
   */
  rollbackBatch(txns) {
    txns.forEach((txn) => this.addDeltas(txn, -1));
    const changed = new Set();
    txns.forEach((txn) => this.txnIds(txn).forEach((id) => changed.add(id)));
    this.emit([...changed]);
    debugWarn('[PointsStore] Rolled back', txns.length, 'transaction(s)');
  }

  hasPendingDeltas() {
    const hasParticipantPending = [...this.pendingParticipantDeltas.values()].some((v) => v !== 0);
    const hasGroupPending = [...this.pendingGroupDeltas.values()].some((v) => v !== 0);
    return hasParticipantPending || hasGroupPending;
  }

  /**
   * Subscribe to total changes.
   * @param {(changedIds: string[]) => void} listener - Receives entity ids in
   *   the form "participant:12" / "group:5"
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(changedIds) {
    this.listeners.forEach((listener) => {
      try {
        listener(changedIds);
      } catch (error) {
        debugWarn('[PointsStore] Listener error:', error);
      }
    });
  }

  // Internal helpers

  addDeltas(txn, sign) {
    Object.entries(txn.participantDeltas || {}).forEach(([id, delta]) => {
      const key = String(id);
      this.pendingParticipantDeltas.set(
        key,
        (this.pendingParticipantDeltas.get(key) || 0) + sign * delta,
      );
    });
    Object.entries(txn.groupDeltas || {}).forEach(([id, delta]) => {
      const key = String(id);
      this.pendingGroupDeltas.set(
        key,
        (this.pendingGroupDeltas.get(key) || 0) + sign * delta,
      );
    });
  }

  txnIds(txn) {
    return [
      ...Object.keys(txn.participantDeltas || {}).map((id) => `participant:${id}`),
      ...Object.keys(txn.groupDeltas || {}).map((id) => `group:${id}`),
    ];
  }

  allIds() {
    return [
      ...[...this.baseParticipantTotals.keys()].map((id) => `participant:${id}`),
      ...[...this.baseGroupTotals.keys()].map((id) => `group:${id}`),
    ];
  }
}
