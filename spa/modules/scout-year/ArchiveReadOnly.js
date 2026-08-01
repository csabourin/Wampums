/**
 * Archive Read-Only
 *
 * Makes the read-only nature of an archived year visible, not just enforced.
 *
 * The API layer already refuses every write while an archived year is selected
 * (`makeApiRequest`), so nothing can slip through. But a page full of live
 * checkboxes and Save buttons that all fail on click is a worse experience than
 * one that plainly shows there is nothing to do here — and it invites the leader
 * to think the app is broken rather than that they are looking at history.
 *
 * Every page renders into `#app`, so rather than touching forty modules this
 * watches that subtree and disables the controls each time it changes. The cost
 * is only paid while consulting an archive, which is rare.
 *
 * **Opt out with `data-archive-safe`** on any control that is about consulting
 * rather than changing — a date picker, a group filter, a search box. Those stay
 * live, because narrowing what you are looking at is the entire point of opening
 * an archive.
 */

import { debugLog } from '../../utils/DebugUtils.js';
import { isArchiveMode, onScoutYearChange } from './ScoutYearContext.js';

/** Controls that would otherwise invite a write. */
const DISABLED_SELECTOR = 'button, input, select, textarea, [contenteditable="true"]';
/** Marks a control as consultation, not mutation. */
const SAFE_ATTRIBUTE = 'data-archive-safe';
/** Remembers that we disabled it, so restoring never re-enables something else. */
const MARKER_ATTRIBUTE = 'data-archive-disabled';
/** Batch DOM churn: a render can fire many mutations in a row. */
const DEBOUNCE_MS = 50;

let observer = null;
let observedRoot = null;
let pending = null;

/**
 * Whether a control should stay usable in an archive.
 *
 * Anchors are never touched — navigating away is always allowed, and disabling
 * links would trap the leader on the page.
 *
 * @param {Element} element - Candidate control
 * @returns {boolean} True when the control must keep working
 */
function isSafe(element) {
  if (element.hasAttribute(SAFE_ATTRIBUTE) || element.closest(`[${SAFE_ATTRIBUTE}]`)) {
    return true;
  }
  // The year selector lives outside #app, but a page may embed its own way back.
  return element.closest('.scout-year-banner') !== null;
}

/**
 * Disable every mutating control currently inside the app root.
 *
 * @returns {number} How many controls were disabled
 */
function disableControls() {
  const root = document.getElementById('app');
  if (!root) {
    return 0;
  }

  let count = 0;
  root.querySelectorAll(DISABLED_SELECTOR).forEach((element) => {
    if (isSafe(element) || element.hasAttribute(MARKER_ATTRIBUTE)) {
      return;
    }
    // Already disabled for its own reasons: leave it alone, and leave no marker,
    // so restoring never enables a control the page meant to keep disabled.
    if (element.getAttribute('contenteditable') === 'true') {
      element.setAttribute('contenteditable', 'false');
      element.setAttribute(MARKER_ATTRIBUTE, 'contenteditable');
      element.setAttribute('aria-disabled', 'true');
      count += 1;
      return;
    }

    if (element.disabled) {
      return;
    }
    element.disabled = true;
    element.setAttribute(MARKER_ATTRIBUTE, 'true');
    element.setAttribute('aria-disabled', 'true');
    count += 1;
  });

  root.classList.add('is-archive-readonly');
  return count;
}

/**
 * Give back every control this module disabled.
 *
 * @returns {void}
 */
function restoreControls() {
  document.querySelectorAll(`[${MARKER_ATTRIBUTE}]`).forEach((element) => {
    if (element.getAttribute(MARKER_ATTRIBUTE) === 'contenteditable') {
      element.setAttribute('contenteditable', 'true');
    } else {
      element.disabled = false;
    }
    element.removeAttribute(MARKER_ATTRIBUTE);
    element.removeAttribute('aria-disabled');
  });
  document.getElementById('app')?.classList.remove('is-archive-readonly');
}

/**
 * Re-apply after the DOM settles.
 *
 * @returns {void}
 */
function scheduleSweep() {
  if (pending) {
    clearTimeout(pending);
  }
  pending = setTimeout(() => {
    pending = null;
    const disabled = disableControls();
    if (disabled > 0) {
      debugLog(`[Archive] ${disabled} control(s) disabled for read-only consultation`);
    }
  }, DEBOUNCE_MS);
}

/**
 * Start or stop watching, depending on the year being consulted.
 *
 * @returns {void}
 */
function sync() {
  const archive = isArchiveMode();

  if (!archive) {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
    restoreControls();
    return;
  }

  disableControls();

  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  // Re-attach when the app root is a different element than the one being
  // watched. An observer bound to a node that has since been replaced reports
  // nothing, and the page would quietly go back to looking editable.
  if (observer && observedRoot === root) {
    return;
  }
  observer?.disconnect();
  observer = new MutationObserver(scheduleSweep);
  observer.observe(root, { childList: true, subtree: true });
  observedRoot = root;
}

/**
 * Install the read-only guard. Safe to call more than once.
 *
 * @returns {void}
 */
export function initArchiveReadOnly() {
  sync();
  onScoutYearChange(sync);
}
