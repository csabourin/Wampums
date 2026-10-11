/**
 * A small rich-text editor for a form's information texts.
 *
 * Offers only what an information text needs: bold, italic, bulleted and
 * numbered lists, and links. The output always goes through
 * `sanitizeRichText`, on paste and when read, so nothing else survives.
 *
 * Accessibility (WCAG 2.2 AA):
 * - the editable area is a labelled, multi-line `textbox`;
 * - the toolbar follows the ARIA toolbar pattern: one Tab stop, then
 *   ←/→/Home/End between buttons;
 * - Bold and Italic report their state with `aria-pressed`;
 * - Ctrl/⌘+B, Ctrl/⌘+I (native) and Ctrl/⌘+K (link) work from the text;
 * - nothing is drag-only and no motion is added.
 *
 * @module modules/form-builder/RichTextEditor
 */

import { translate } from '../../app.js';
import { escapeHTML } from '../../utils/SecurityUtils.js';
import { prompt, alert } from '../../utils/DialogUtils.js';
import {
  RICH_TEXT_LINK_PATTERN,
  richTextHasContent,
  sanitizeRichText,
} from '../../utils/FormTextUtils.js';

/** Toolbar commands, in display order. */
const COMMANDS = [
  { command: 'bold', icon: 'fa-bold', labelKey: 'rte_bold', toggle: true },
  { command: 'italic', icon: 'fa-italic', labelKey: 'rte_italic', toggle: true },
  { command: 'insertUnorderedList', icon: 'fa-list-ul', labelKey: 'rte_bullet_list', toggle: true },
  { command: 'insertOrderedList', icon: 'fa-list-ol', labelKey: 'rte_numbered_list', toggle: true },
  { command: 'link', icon: 'fa-link', labelKey: 'rte_link', toggle: false },
];

/**
 * Run a formatting command on the current selection. `execCommand` is
 * deprecated but remains the only cross-browser way to edit a
 * contenteditable without a library; environments without it do nothing.
 *
 * @param {string} command - Command name
 * @param {string} [value] - Command argument
 * @returns {void}
 */
function exec(command, value) {
  if (typeof document.execCommand === 'function') {
    document.execCommand(command, false, value);
  }
}

/**
 * Markup for one editor. Call `attachRichTextEditor` once it is in the page.
 *
 * @param {Object} options
 * @param {string} options.id - Id of the editable area
 * @param {string} options.labelId - Id of the element naming the editor
 * @param {string} [options.html] - Initial rich text
 * @returns {string} HTML
 */
export function richTextEditorHTML({ id, labelId, html = '' }) {
  const buttons = COMMANDS.map(({ command, icon, labelKey, toggle }, index) => `
    <button type="button" class="rte__button" data-rte-command="${command}"
            tabindex="${index === 0 ? '0' : '-1'}"
            aria-label="${escapeHTML(translate(labelKey))}"
            ${toggle ? 'aria-pressed="false"' : ''}>
      <i class="fa-solid ${icon}" aria-hidden="true"></i>
    </button>`).join('');

  return `
    <div class="rte" data-rte>
      <div class="rte__toolbar" role="toolbar" aria-label="${escapeHTML(translate('rte_toolbar'))}" aria-controls="${id}">
        ${buttons}
      </div>
      <div id="${id}" class="rte__area" role="textbox" aria-multiline="true"
           aria-labelledby="${labelId}" tabindex="0">${sanitizeRichText(html)}</div>
    </div>`;
}

/**
 * The editor's content, sanitized; empty string when nothing visible remains.
 *
 * @param {HTMLElement} area - The editable area
 * @returns {string} Rich text
 */
export function getRichTextValue(area) {
  const html = sanitizeRichText(area.innerHTML);
  return richTextHasContent(html) ? html : '';
}

/**
 * Reflect the selection's formatting on the toggle buttons.
 *
 * @param {HTMLElement} toolbar - The toolbar
 * @returns {void}
 */
function refreshPressedStates(toolbar) {
  if (typeof document.queryCommandState !== 'function') {
    return;
  }
  toolbar.querySelectorAll('[aria-pressed]').forEach((button) => {
    const active = document.queryCommandState(button.dataset.rteCommand);
    button.setAttribute('aria-pressed', String(Boolean(active)));
  });
}

/**
 * Ask for a link address and apply it to the selection; an empty answer
 * removes the link. The selection is restored after the dialog took focus.
 *
 * @param {HTMLElement} area - The editable area
 * @returns {Promise<void>}
 */
async function editLink(area) {
  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  const current = range?.commonAncestorContainer?.parentElement?.closest?.('a')?.getAttribute('href') || 'https://';

  const address = await prompt({ message: translate('rte_link_prompt'), defaultValue: current });
  area.focus();
  if (range) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
  if (address === null) {
    return;
  }
  const trimmed = address.trim();
  if (trimmed === '' || trimmed === 'https://') {
    exec('unlink');
    return;
  }
  if (!RICH_TEXT_LINK_PATTERN.test(trimmed)) {
    await alert(translate('rte_link_invalid'));
    area.focus();
    return;
  }
  exec('createLink', trimmed);
}

/**
 * Wire one editor rendered by `richTextEditorHTML`.
 *
 * @param {HTMLElement} root - The `[data-rte]` element
 * @returns {void}
 */
export function attachRichTextEditor(root) {
  const area = root.querySelector('.rte__area');
  const toolbar = root.querySelector('.rte__toolbar');
  const buttons = Array.from(toolbar.querySelectorAll('.rte__button'));
  // Set here: the HTML sanitizer does not keep contenteditable.
  area.setAttribute('contenteditable', 'true');

  const run = (command) => {
    area.focus();
    if (command === 'link') {
      editLink(area);
      return;
    }
    exec(command);
    refreshPressedStates(toolbar);
  };

  buttons.forEach((button) => {
    // Keep the text selection when a button is pressed with the mouse.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => run(button.dataset.rteCommand));
  });

  // ARIA toolbar pattern: one Tab stop, arrows move between buttons.
  toolbar.addEventListener('keydown', (event) => {
    const current = buttons.indexOf(document.activeElement);
    if (current === -1) {
      return;
    }
    const last = buttons.length - 1;
    const targets = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in targets)) {
      return;
    }
    event.preventDefault();
    buttons[current].setAttribute('tabindex', '-1');
    const next = buttons[targets[event.key]];
    next.setAttribute('tabindex', '0');
    next.focus();
  });

  area.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      editLink(area);
    }
  });

  // Pasted text from a word processor carries styles and markup the form
  // must not show: keep only what the editor itself could have produced.
  area.addEventListener('paste', (event) => {
    const html = event.clipboardData?.getData('text/html');
    const text = event.clipboardData?.getData('text/plain') || '';
    event.preventDefault();
    if (html) {
      exec('insertHTML', sanitizeRichText(html));
    } else {
      exec('insertText', text);
    }
  });

  ['keyup', 'mouseup', 'focus'].forEach((type) => {
    area.addEventListener(type, () => refreshPressedStates(toolbar));
  });

  exec('defaultParagraphSeparator', 'p');
}
