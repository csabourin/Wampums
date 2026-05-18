/**
 * DialogUtils — unified, promise-based confirmation / alert / prompt dialogs.
 *
 * Replaces native `confirm()`, `alert()`, and `prompt()` which:
 *  - block the JS thread
 *  - cannot be styled or themed
 *  - cannot be translated reliably across browsers
 *  - have poor mobile UX
 *
 * All dialogs return a Promise:
 *   confirm(...) -> Promise<boolean>
 *   alert(...)   -> Promise<void>
 *   prompt(...)  -> Promise<string|null>
 *
 * Markup is appended to <body> and removed on close, so there are no
 * leaks even if the caller never awaits the promise.
 */

import { translate } from "../app.js";

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let activeDialog = null;

function tr(key, fallback) {
  try {
    const translated = translate(key);
    if (translated && translated !== key) return translated;
  } catch (_) {
    // translate may not be ready
  }
  return fallback;
}

function buildOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.setAttribute("role", "presentation");
  return overlay;
}

function buildDialog({ title, message, kind = "info", isPrompt = false, promptValue = "" }) {
  const dialog = document.createElement("div");
  dialog.className = `dialog dialog--${kind}`;
  dialog.setAttribute("role", "alertdialog");
  dialog.setAttribute("aria-modal", "true");

  const titleId = `dialog-title-${Date.now()}`;
  const bodyId = `dialog-body-${Date.now()}`;
  dialog.setAttribute("aria-labelledby", titleId);
  dialog.setAttribute("aria-describedby", bodyId);

  // Heading
  if (title) {
    const h = document.createElement("h2");
    h.className = "dialog__title";
    h.id = titleId;
    h.textContent = title;
    dialog.appendChild(h);
  }

  // Body
  const body = document.createElement("div");
  body.className = "dialog__body";
  body.id = bodyId;
  // Message may contain newlines — render as text nodes for safety.
  const lines = String(message ?? "").split("\n");
  lines.forEach((line, i) => {
    if (i > 0) body.appendChild(document.createElement("br"));
    body.appendChild(document.createTextNode(line));
  });
  dialog.appendChild(body);

  // Prompt input
  let inputEl = null;
  if (isPrompt) {
    inputEl = document.createElement("input");
    inputEl.type = "text";
    inputEl.className = "dialog__input";
    inputEl.value = promptValue;
    inputEl.setAttribute("aria-label", title || tr("input", "Input"));
    dialog.appendChild(inputEl);
  }

  // Actions
  const actions = document.createElement("div");
  actions.className = "dialog__actions";
  dialog.appendChild(actions);

  return { dialog, actions, inputEl };
}

function ensureStyles() {
  if (document.getElementById("dialog-utils-styles")) return;
  const style = document.createElement("style");
  style.id = "dialog-utils-styles";
  style.textContent = `
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: dialog-fade-in 0.15s ease-out;
}
.dialog {
  background: var(--background-color, #fff);
  color: var(--text-color, #222);
  border-radius: 8px;
  max-width: 480px;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
  padding: 20px;
  animation: dialog-slide-up 0.18s ease-out;
}
.dialog__title {
  margin: 0 0 12px;
  font-size: 1.15rem;
  font-weight: 600;
}
.dialog__body {
  margin: 0 0 16px;
  font-size: 1rem;
  line-height: 1.45;
}
.dialog__input {
  width: 100%;
  padding: 10px 12px;
  font-size: 1rem;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 6px;
  margin-bottom: 16px;
  box-sizing: border-box;
}
.dialog__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.dialog__btn {
  min-height: 44px;
  min-width: 88px;
  padding: 10px 18px;
  border-radius: 6px;
  border: 1px solid transparent;
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.dialog__btn--primary {
  background: var(--primary-color, #2563eb);
  color: #fff;
}
.dialog__btn--primary:hover { filter: brightness(0.95); }
.dialog__btn--danger {
  background: var(--danger-color, #dc2626);
  color: #fff;
}
.dialog__btn--danger:hover { filter: brightness(0.95); }
.dialog__btn--secondary {
  background: transparent;
  color: var(--text-color, #222);
  border-color: var(--border-color, #d1d5db);
}
.dialog__btn--secondary:hover { background: rgba(0, 0, 0, 0.04); }
.dialog__btn:focus-visible {
  outline: 2px solid var(--focus-color, #2563eb);
  outline-offset: 2px;
}
@keyframes dialog-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes dialog-slide-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 480px) {
  .dialog { padding: 16px; }
  .dialog__actions { flex-direction: column-reverse; }
  .dialog__btn { width: 100%; }
}
`;
  document.head.appendChild(style);
}

function trapFocus(container, event) {
  const focusable = Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.disabled && el.offsetParent !== null,
  );
  if (focusable.length === 0) return;
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

function openDialog({
  title,
  message,
  kind = "info",
  buttons,
  isPrompt = false,
  promptValue = "",
  defaultButtonIndex = 0,
  cancelValue = null,
}) {
  // If a dialog is already open, close it first.
  if (activeDialog) {
    activeDialog.cancel();
  }

  ensureStyles();

  const previousFocus = document.activeElement;
  const overlay = buildOverlay();
  const { dialog, actions, inputEl } = buildDialog({
    title,
    message,
    kind,
    isPrompt,
    promptValue,
  });
  overlay.appendChild(dialog);

  return new Promise((resolve) => {
    let settled = false;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      activeDialog = null;
      document.removeEventListener("keydown", onKeydown, true);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (previousFocus && typeof previousFocus.focus === "function") {
        try {
          previousFocus.focus();
        } catch (_) {
          // ignore
        }
      }
    };

    const settle = (value) => {
      cleanup();
      resolve(value);
    };

    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(cancelValue);
      } else if (event.key === "Enter" && (event.target?.tagName !== "TEXTAREA")) {
        // For prompt, only submit on Enter if the input is focused.
        const primary = buttons[defaultButtonIndex];
        if (primary) {
          event.preventDefault();
          settle(primary.resolve(inputEl?.value));
        }
      } else if (event.key === "Tab") {
        trapFocus(dialog, event);
      }
    };

    buttons.forEach((btn, idx) => {
      const buttonEl = document.createElement("button");
      buttonEl.type = "button";
      buttonEl.textContent = btn.label;
      buttonEl.className = `dialog__btn dialog__btn--${btn.variant || "secondary"}`;
      buttonEl.addEventListener("click", () => {
        settle(btn.resolve(inputEl?.value));
      });
      actions.appendChild(buttonEl);
      if (idx === defaultButtonIndex) buttonEl.dataset.dialogDefault = "true";
    });

    // Click outside the dialog closes it (cancel)
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        settle(cancelValue);
      }
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKeydown, true);

    activeDialog = { cancel: () => settle(cancelValue) };

    // Focus management
    requestAnimationFrame(() => {
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      } else {
        const defaultBtn = dialog.querySelector('[data-dialog-default="true"]');
        if (defaultBtn) defaultBtn.focus();
      }
    });
  });
}

/**
 * Show a confirmation dialog. Resolves true if user confirms, false otherwise.
 *
 * @param {string|object} options - Message string, or options object.
 * @param {string} [options.message] - Body text.
 * @param {string} [options.title] - Optional heading.
 * @param {string} [options.confirmLabel] - Override confirm button label.
 * @param {string} [options.cancelLabel] - Override cancel button label.
 * @param {boolean} [options.danger] - Render confirm button as destructive.
 * @returns {Promise<boolean>}
 */
export function confirm(options) {
  const opts = typeof options === "string" ? { message: options } : options || {};
  const confirmLabel = opts.confirmLabel || tr("confirm", "Confirm");
  const cancelLabel = opts.cancelLabel || tr("cancel", "Cancel");
  return openDialog({
    title: opts.title || "",
    message: opts.message || "",
    kind: opts.danger ? "danger" : "info",
    cancelValue: false,
    defaultButtonIndex: 1,
    buttons: [
      { label: cancelLabel, variant: "secondary", resolve: () => false },
      {
        label: confirmLabel,
        variant: opts.danger ? "danger" : "primary",
        resolve: () => true,
      },
    ],
  });
}

/**
 * Show an alert dialog. Resolves when the user acknowledges.
 *
 * @param {string|object} options
 * @returns {Promise<void>}
 */
export function alert(options) {
  const opts = typeof options === "string" ? { message: options } : options || {};
  const okLabel = opts.okLabel || tr("ok", "OK");
  return openDialog({
    title: opts.title || "",
    message: opts.message || "",
    kind: opts.kind || "info",
    cancelValue: undefined,
    defaultButtonIndex: 0,
    buttons: [{ label: okLabel, variant: "primary", resolve: () => undefined }],
  }).then(() => undefined);
}

/**
 * Show a prompt dialog. Resolves with the entered string, or null on cancel.
 *
 * @param {string|object} options
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
export function prompt(options, defaultValue = "") {
  const opts = typeof options === "string" ? { message: options } : options || {};
  const confirmLabel = opts.confirmLabel || tr("ok", "OK");
  const cancelLabel = opts.cancelLabel || tr("cancel", "Cancel");
  const initialValue = opts.defaultValue ?? defaultValue ?? "";

  return openDialog({
    title: opts.title || "",
    message: opts.message || "",
    kind: "info",
    isPrompt: true,
    promptValue: initialValue,
    cancelValue: null,
    defaultButtonIndex: 1,
    buttons: [
      { label: cancelLabel, variant: "secondary", resolve: () => null },
      {
        label: confirmLabel,
        variant: "primary",
        resolve: (value) => (value === undefined ? "" : value),
      },
    ],
  });
}

/**
 * Convenience: a destructive confirm (red confirm button).
 *
 * @param {string|object} options
 * @returns {Promise<boolean>}
 */
export function confirmDestructive(options) {
  const opts = typeof options === "string" ? { message: options } : options || {};
  return confirm({ ...opts, danger: true });
}

export default { confirm, alert, prompt, confirmDestructive };
