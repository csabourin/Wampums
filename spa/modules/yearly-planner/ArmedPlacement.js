// ArmedPlacement.js
// State machine for placing one activity onto several dates.
//
// This is the replacement for drag and drop, which is awkward on touch and
// hostile to keyboard and screen-reader users. Instead: pick an activity, then
// tap the dates, then confirm. Pure state, no DOM — the view reads it.

/** @enum {string} */
export const PLACEMENT_STATE = {
  IDLE: 'idle',
  CHOOSING: 'choosing',
  ARMED: 'armed',
  COMMITTING: 'committing'
};

export class ArmedPlacement {
  constructor() {
    this.state = PLACEMENT_STATE.IDLE;
    this.activity = null;
    /** Selected meeting ids, kept with their dates so the payload can be ordered. */
    this.selection = new Map();
    this.asSeries = true;
  }

  /** @returns {boolean} Whether chips should currently expose aria-pressed */
  get isArmed() {
    return this.state === PLACEMENT_STATE.ARMED || this.state === PLACEMENT_STATE.COMMITTING;
  }

  /** @returns {number} How many dates are selected */
  get count() {
    return this.selection.size;
  }

  /**
   * Enter the picker.
   * @returns {void}
   */
  choose() {
    this.state = PLACEMENT_STATE.CHOOSING;
  }

  /**
   * Arm with a chosen activity.
   * @param {Object} activity - { name, activity_library_id?, duration_minutes?, ... }
   * @returns {void}
   */
  arm(activity) {
    this.activity = activity;
    this.selection.clear();
    this.state = PLACEMENT_STATE.ARMED;
  }

  /**
   * Toggle a date in or out of the selection.
   * @param {Object} chip - Chip descriptor
   * @returns {boolean} Whether the date is now selected
   */
  toggle(chip) {
    if (!this.isArmed || !chip?.meetingId) {
      return false;
    }
    if (this.selection.has(chip.meetingId)) {
      this.selection.delete(chip.meetingId);
      return false;
    }
    this.selection.set(chip.meetingId, chip.date);
    return true;
  }

  /**
   * @param {number} meetingId - Meeting id
   * @returns {boolean} Whether that date is selected
   */
  isSelected(meetingId) {
    return this.selection.has(meetingId);
  }

  /**
   * @param {boolean} value - Whether occurrences should be numbered
   * @returns {void}
   */
  setSeries(value) {
    this.asSeries = value === true;
  }

  /**
   * Build the request body.
   *
   * Ids are ordered by date so the server numbers "1 of 4" chronologically even
   * if the user tapped the dates out of order.
   *
   * @param {string} [seriesLabel] - Optional label for the series
   * @returns {Object|null} Request body, or null when nothing is selected
   */
  payload(seriesLabel = null) {
    if (this.selection.size === 0 || !this.activity) {
      return null;
    }

    const ordered = Array.from(this.selection.entries())
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(([meetingId]) => meetingId);

    return {
      meeting_ids: ordered,
      activity: this.activity,
      as_series: this.asSeries,
      series_label: seriesLabel || this.activity.name || null
    };
  }

  /** @returns {void} Mark the placement as in flight */
  commit() {
    this.state = PLACEMENT_STATE.COMMITTING;
  }

  /** @returns {void} Return to idle and forget everything */
  disarm() {
    this.state = PLACEMENT_STATE.IDLE;
    this.activity = null;
    this.selection.clear();
  }
}
