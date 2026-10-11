// ModalUtils.js
// The one modal every SPA screen uses: same markup, same keyboard and focus
// behaviour, same scroll lock. Confirmations, alerts and prompts go through
// DialogUtils.js instead.
import { translate } from '../app.js';
import { setContent } from './DOMUtils.js';
import { escapeHTML } from './SecurityUtils.js';
import { lockBodyScroll, unlockBodyScroll } from './ScrollLockUtils.js';
import { hasActiveDialog } from './DialogUtils.js';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const SIZE_CLASSES = {
  small: 'modal-dialog--small',
  large: 'modal-dialog--large',
};

/**
 * The close button's accessible name, in the page's language.
 *
 * @returns {string}
 */
function closeLabel() {
  try {
    const label = translate('close');
    if (label && label !== 'close') {return label;}
  } catch (_error) {
    // Translations not loaded yet
  }
  return document.documentElement.lang === 'fr' ? 'Fermer' : 'Close';
}

/** Open modals, the topmost last. Only the topmost answers Escape and Tab. */
const openStack = [];

/**
 * Elements Tab may reach inside a dialog. Hidden controls (display: none, or
 * inside a closed <details>) are skipped.
 *
 * @param {HTMLElement} dialog
 * @returns {HTMLElement[]}
 */
function getFocusable(dialog) {
  // Without layout (tests, a dialog not rendered yet) nothing has client rects
  const hasLayout = dialog.getClientRects().length > 0;
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => !element.closest('[hidden]') && (!hasLayout || element.getClientRects().length > 0));
}

/**
 * @returns {Object|null} The topmost open modal still in the page
 */
function topmost() {
  while (openStack.length && !openStack[openStack.length - 1].overlay.isConnected) {
    openStack.pop();
  }
  return openStack[openStack.length - 1] || null;
}

/**
 * Keyboard handling shared by every modal: Escape closes the topmost one, and
 * Tab stays inside it. A confirmation from DialogUtils on top of a modal
 * owns keyboard focus until it closes, including Tab between its controls.
 *
 * @param {KeyboardEvent} event
 */
function handleKeydown(event) {
  if (event.defaultPrevented || hasActiveDialog()) {
    return;
  }
  const entry = topmost();
  if (!entry) {
    document.removeEventListener('keydown', handleKeydown);
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    entry.close();
    return;
  }

  if (event.key !== 'Tab') {
    return;
  }
  const focusable = getFocusable(entry.dialog);
  if (focusable.length === 0) {
    event.preventDefault();
    entry.dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const outside = !entry.dialog.contains(document.activeElement);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === entry.dialog || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Open a modal dialog with the shared `.modal-overlay` / `.modal-dialog` markup.
 *
 * Behaviour every modal gets:
 * - `role="dialog"`, `aria-modal`, labelled by its title
 * - focus moves into the dialog (`initialFocus`, else the first form control,
 *   else the dialog) and returns to the element that opened it on close
 * - Tab and Shift+Tab stay inside the topmost dialog; Escape closes it
 * - clicking the backdrop or the × button closes it, unless `canClose` refuses
 * - the page behind does not scroll while it is open
 *
 * The caller escapes any user content in `title`, `body` and `footer`: they
 * are injected as HTML.
 *
 * @param {Object} options - Modal options
 * @param {string} [options.id] - DOM id (an open modal with the same id is replaced)
 * @param {string} options.title - Header HTML (usually a translated string)
 * @param {string} options.body - Body HTML
 * @param {string} [options.footer] - Footer HTML (usually action buttons)
 * @param {'small'|'large'} [options.size] - Narrower or wider than the default
 * @param {string} [options.className] - Extra classes for the dialog panel
 * @param {string|false} [options.initialFocus] - Selector of the element to focus first; false focuses the dialog
 * @param {boolean} [options.closeOnBackdrop] - Whether a backdrop click closes (default true)
 * @param {HTMLElement} [options.returnFocus] - Where focus goes on close (default: the element focused when it opened)
 * @param {Function} [options.onClose] - Called once, after the modal is removed
 * @param {Function} [options.canClose] - Whether a user may dismiss the dialog (e.g. while saving)
 * @returns {{ overlay: HTMLElement, dialog: HTMLElement, body: HTMLElement, close: Function }} Modal handle
 */
export function openModal({
  id = 'app-modal',
  title = '',
  body = '',
  footer = '',
  size = null,
  className = '',
  initialFocus = null,
  closeOnBackdrop = true,
  returnFocus = null,
  onClose = null,
  canClose = () => true,
}) {
  closeModal(id);

  const opener = returnFocus || document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay';
  const panelClasses = ['modal-dialog', SIZE_CLASSES[size], className].filter(Boolean).join(' ');
  setContent(overlay, `
    <div class="${panelClasses}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" tabindex="-1">
      <div class="modal-header">
        <h2 id="${id}-title">${title}</h2>
        <button type="button" class="modal-close" data-modal-close aria-label="${escapeHTML(closeLabel())}"><span aria-hidden="true">&times;</span></button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer modal-actions">${footer}</div>` : ''}
    </div>
  `);
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.modal-dialog');

  // The lock is reference counted by owner key, so nested dialogs are safe, and
  // the router's releaseAllScrollLocks() covers navigating away mid-dialog.
  lockBodyScroll(`modal:${id}`);

  let closed = false;
  const close = (force = false) => {
    if (closed || (!force && !canClose())) {return;}
    closed = true;
    unlockBodyScroll(`modal:${id}`);
    const index = openStack.indexOf(entry);
    if (index !== -1) {openStack.splice(index, 1);}
    if (!topmost()) {document.removeEventListener('keydown', handleKeydown);}
    const focusWasInside = overlay.contains(document.activeElement);
    overlay.remove();
    if (focusWasInside || document.activeElement === document.body) {
      if (opener instanceof HTMLElement && opener.isConnected && opener !== document.body) {
        opener.focus();
      }
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  };
  const entry = { overlay, dialog, close };

  overlay.addEventListener('click', (event) => {
    if (closeOnBackdrop && event.target === overlay) {
      close();
    }
  });
  overlay.querySelectorAll('[data-modal-close]').forEach((button) => {
    button.addEventListener('click', () => close());
  });
  overlay.addEventListener('modal-force-close', () => close(true));

  openStack.push(entry);
  document.removeEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', handleKeydown);

  const target = initialFocus === false
    ? dialog
    : (initialFocus && dialog.querySelector(initialFocus))
      || dialog.querySelector([
        'input:not([type="hidden"]):not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '.modal-body button:not([disabled])',
        '.modal-footer button:not([disabled])',
      ].join(','))
      || dialog;
  target.focus();

  return { overlay, dialog, body: dialog.querySelector('.modal-body'), close };
}

/**
 * Close (remove) a modal by id if it is open.
 * @param {string} id - Modal DOM id
 */
export function closeModal(id = 'app-modal') {
  const overlay = document.getElementById(id);
  if (!overlay) {return;}

  // Programmatic completion may close a pending dialog, with listener cleanup.
  overlay.dispatchEvent(new Event('modal-force-close'));

  // Fallback: if no handler was registered, still remove the DOM.
  document.getElementById(id)?.remove();
}

/**
 * Close every open modal, topmost first. The router calls it when leaving a
 * screen, so no dialog, key listener or scroll lock outlives its screen.
 */
export function closeAllModals() {
  [...openStack].reverse().forEach((entry) => entry.close(true));
  openStack.length = 0;
  document.removeEventListener('keydown', handleKeydown);
}
