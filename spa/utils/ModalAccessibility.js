const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let generatedDialogId = 0;

function getFocusable(dialog) {
  return Array.from(dialog.querySelectorAll(FOCUSABLE_SELECTOR))
    .filter((element) => element.offsetParent !== null);
}

/**
 * Upgrade hand-authored modals with consistent dialog semantics and keyboard
 * behavior while legacy screens are migrated to the shared dialog component.
 *
 * @param {ParentNode|Element} root - Recently rendered DOM subtree
 */
export function enhanceModalAccessibility(root = document) {
  const selector = '.modal-overlay, .modal-container, .modal-screen';
  const overlays = [
    ...(root instanceof Element && root.matches(selector) ? [root] : []),
    ...root.querySelectorAll(selector),
  ];

  overlays.forEach((overlay) => {
    if (overlay.dataset.modalA11yEnhanced === 'true') return;
    const dialog = overlay.querySelector('.modal-dialog, .modal-content, .modal');
    if (!dialog) return;

    overlay.dataset.modalA11yEnhanced = 'true';
    const previousFocus = document.activeElement;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('tabindex', '-1');

    const heading = dialog.querySelector('h1, h2, h3');
    if (heading) {
      heading.id ||= `app-dialog-title-${++generatedDialogId}`;
      dialog.setAttribute('aria-labelledby', heading.id);
    } else if (!dialog.hasAttribute('aria-label')) {
      dialog.setAttribute(
        'aria-label',
        document.documentElement.lang === 'fr' ? 'Dialogue' : 'Dialog',
      );
    }

    const closeLabel = document.documentElement.lang === 'fr' ? 'Fermer' : 'Close';
    dialog.querySelectorAll('.modal-close, [data-modal-close]').forEach((button) => {
      if (!button.getAttribute('aria-label') || button.getAttribute('aria-label') === '✕') {
        button.setAttribute('aria-label', closeLabel);
      }
    });

    dialog.querySelectorAll('label:not([for])').forEach((label) => {
      if (label.querySelector('input, select, textarea')) return;
      const control = label.nextElementSibling;
      if (!control?.matches('input, select, textarea')) return;
      control.id ||= `app-dialog-control-${++generatedDialogId}`;
      label.htmlFor = control.id;
    });

    const close = () => {
      const closeButton = dialog.querySelector('.modal-close, [data-modal-close]');
      if (closeButton) closeButton.click();
      else overlay.remove();
    };
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Tab') {
        const focusable = getFocusable(dialog);
        if (focusable.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });

    document.body.classList.add('modal-open');
    const observer = new MutationObserver(() => {
      if (overlay.isConnected) return;
      observer.disconnect();
      if (!document.querySelector(selector)) document.body.classList.remove('modal-open');
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    requestAnimationFrame(() => {
      const [firstFocusable] = getFocusable(dialog);
      (firstFocusable || dialog).focus();
    });
  });
}
