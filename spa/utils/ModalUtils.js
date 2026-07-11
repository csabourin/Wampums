// ModalUtils.js
// Shared modal builder used by all SPA modules (single markup + behavior for
// what used to be three hand-rolled modal implementations).
import { setContent } from './DOMUtils.js';

/**
 * Open a modal dialog using the global .modal-overlay / .modal-dialog styles.
 * The caller is responsible for escaping any user content in `title`, `body`
 * and `footer` (they are injected as HTML).
 *
 * @param {Object} options - Modal options
 * @param {string} [options.id] - DOM id (an existing modal with the same id is replaced)
 * @param {string} options.title - Header HTML (usually a translated string)
 * @param {string} options.body - Body HTML
 * @param {string} [options.footer] - Footer HTML (usually action buttons)
 * @param {Function} [options.onClose] - Called after the modal is removed
 * @returns {{ overlay: HTMLElement, close: Function }} Modal handle
 */
export function openModal({ id = 'app-modal', title = '', body = '', footer = '', onClose = null }) {
  closeModal(id);

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'modal-overlay';
  setContent(overlay, `
    <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <div class="modal-header">
        <h2 id="${id}-title">${title}</h2>
        <button type="button" class="modal-close" data-modal-close aria-label="✕">&times;</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer modal-actions">${footer}</div>` : ''}
    </div>
  `);
  document.body.appendChild(overlay);

  const close = () => {
    document.removeEventListener('keydown', handleEscape);
    overlay.remove();
    if (typeof onClose === 'function') {
      onClose();
    }
  };

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      close();
    }
  };

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      close();
    }
  });
  overlay.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', close);
  });
  document.addEventListener('keydown', handleEscape);

  // Focus the first focusable form control for keyboard users
  const focusable = overlay.querySelector('input, select, textarea, button:not(.modal-close)');
  if (focusable) {
    focusable.focus();
  }

  return { overlay, close };
}

/**
 * Close (remove) a modal by id if it is open.
 * @param {string} id - Modal DOM id
 */
export function closeModal(id = 'app-modal') {
  const overlay = document.getElementById(id);
  if (!overlay) return;

  // Prefer the modal's own close handler so it can clean up document listeners.
  overlay.querySelector('[data-modal-close]')?.dispatchEvent(new Event('click', { bubbles: true }));

  // Fallback: if no handler was registered, still remove the DOM.
  document.getElementById(id)?.remove();
}
