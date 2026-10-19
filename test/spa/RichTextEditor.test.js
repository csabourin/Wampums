/**
 * @jest-environment jsdom
 */

/**
 * The rich-text editor used for announcements, activity descriptions and form
 * information texts.
 *
 * Held here: what it starts with, returns and pastes is limited to the
 * formatting it offers; a link must be a web or mail address; the toolbar is
 * one Tab stop moved through with the arrow keys; Ctrl+K asks for a link; and
 * the editor is a labelled text box with no WCAG A/AA violation.
 *
 * @module test/spa/RichTextEditor
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/utils/DialogUtils.js', () => ({
  prompt: jest.fn(),
  alert: jest.fn(() => Promise.resolve()),
}));

const { prompt, alert } = require('../../spa/utils/DialogUtils.js');
const {
  richTextEditorHTML,
  attachRichTextEditor,
  getRichTextValue,
  setRichTextValue,
  setRichTextDisabled,
} = require('../../spa/modules/rich-text/RichTextEditor.js');
const { setContent } = require('../../spa/utils/DOMUtils.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } },
};

/** @returns {Promise<void>} Let pending promises settle */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Render and wire one editor.
 *
 * @param {Object} [options] - richTextEditorHTML options
 * @returns {{root: HTMLElement, area: HTMLElement, buttons: HTMLButtonElement[]}}
 */
function mount(options = {}) {
  setContent(document.getElementById('app'), `
    <span id="message-label">Message</span>
    <p id="message-help">Help</p>
    ${richTextEditorHTML({ id: 'message-text', labelId: 'message-label', ...options })}
  `);
  const root = document.querySelector('[data-rte]');
  attachRichTextEditor(root);
  return {
    root,
    area: root.querySelector('.rte__area'),
    buttons: Array.from(root.querySelectorAll('.rte__button')),
  };
}

/**
 * @param {HTMLElement} target - Where the key is pressed
 * @param {string} key - Key name
 * @param {Object} [modifiers] - ctrlKey, metaKey…
 * @returns {KeyboardEvent} The dispatched event
 */
function press(target, key, modifiers = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  document.execCommand = jest.fn();
  prompt.mockReset();
  alert.mockClear();
});

describe('what the editor holds', () => {
  test('starting text keeps its formatting but loses scripts, handlers and styles', () => {
    const { area } = mount({
      html: '<p style="color:red" onclick="steal()"><strong>Camp</strong> <em>soon</em><script>steal()</script></p>',
    });

    expect(area.querySelector('strong').textContent).toBe('Camp');
    expect(area.querySelector('em').textContent).toBe('soon');
    expect(area.querySelector('script')).toBeNull();
    expect(area.innerHTML).not.toMatch(/onclick|style=/);
  });

  test('the value read back is cleaned, and empty when nothing visible remains', () => {
    const { area } = mount();

    setRichTextValue(area, '<p><b>Bring</b> boots<img src=x onerror=steal()></p>');
    expect(getRichTextValue(area)).not.toMatch(/img|onerror/);
    expect(getRichTextValue(area)).toContain('boots');

    setRichTextValue(area, '<p> </p><p><br></p>');
    expect(getRichTextValue(area)).toBe('');
  });

  test('pasted markup from a word processor is cleaned before it is inserted', () => {
    const { area } = mount();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = {
      getData: (type) => (type === 'text/html'
        ? '<p class="MsoNormal" style="font-family:Calibri"><b>Hello</b><script>steal()</script></p>'
        : 'Hello'),
    };

    area.dispatchEvent(paste);

    expect(paste.defaultPrevented).toBe(true);
    const [command, , html] = document.execCommand.mock.calls.find(([name]) => name === 'insertHTML');
    expect(command).toBe('insertHTML');
    expect(html).toContain('Hello');
    expect(html).not.toMatch(/script|style=|class=/);
  });

  test('plain pasted text is inserted as text', () => {
    const { area } = mount();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: (type) => (type === 'text/plain' ? '<b>not markup</b>' : '') };

    area.dispatchEvent(paste);

    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, '<b>not markup</b>');
  });
});

describe('links', () => {
  test('a web address becomes a link', async () => {
    prompt.mockResolvedValue('https://example.org/camp');
    const { buttons } = mount();

    buttons.find((button) => button.dataset.rteCommand === 'link').click();
    await flush();

    expect(document.execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.org/camp');
  });

  test('a javascript: address is refused with an explanation, and no link is made', async () => {
    prompt.mockResolvedValue('javascript:alert(1)');
    const { buttons } = mount();

    buttons.find((button) => button.dataset.rteCommand === 'link').click();
    await flush();

    expect(alert).toHaveBeenCalledWith('rte_link_invalid');
    expect(document.execCommand).not.toHaveBeenCalledWith('createLink', expect.anything(), expect.anything());
  });

  test('clearing the address removes the link; cancelling changes nothing', async () => {
    const { buttons } = mount();
    const linkButton = buttons.find((button) => button.dataset.rteCommand === 'link');

    prompt.mockResolvedValueOnce('');
    linkButton.click();
    await flush();
    expect(document.execCommand).toHaveBeenCalledWith('unlink', false, undefined);

    document.execCommand.mockClear();
    prompt.mockResolvedValueOnce(null);
    linkButton.click();
    await flush();
    expect(document.execCommand).not.toHaveBeenCalledWith('unlink', false, undefined);
    expect(document.execCommand).not.toHaveBeenCalledWith('createLink', expect.anything(), expect.anything());
  });

  test('Ctrl+K in the text asks for a link', async () => {
    prompt.mockResolvedValue(null);
    const { area } = mount();

    const event = press(area, 'k', { ctrlKey: true });
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(prompt).toHaveBeenCalledWith(expect.objectContaining({ message: 'rte_link_prompt' }));
  });
});

describe('keyboard and screen readers', () => {
  test('the toolbar is one Tab stop; arrows, Home and End move along it and wrap', () => {
    const { buttons } = mount();
    const tabbable = () => buttons.filter((button) => button.getAttribute('tabindex') === '0');

    expect(tabbable()).toEqual([buttons[0]]);

    buttons[0].focus();
    press(buttons[0], 'ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    expect(tabbable()).toEqual([buttons[1]]);

    press(buttons[1], 'End');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);

    press(document.activeElement, 'ArrowRight');
    expect(document.activeElement).toBe(buttons[0]);

    press(buttons[0], 'ArrowLeft');
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);

    press(document.activeElement, 'Home');
    expect(document.activeElement).toBe(buttons[0]);
  });

  test('the text area is a labelled, described, multi-line text box that can be required', () => {
    const { area } = mount({ describedBy: 'message-help', required: true });

    expect(area.getAttribute('role')).toBe('textbox');
    expect(area.getAttribute('aria-multiline')).toBe('true');
    expect(area.getAttribute('aria-labelledby')).toBe('message-label');
    expect(area.getAttribute('aria-describedby')).toBe('message-help');
    expect(area.getAttribute('aria-required')).toBe('true');
    expect(area.getAttribute('contenteditable')).toBe('true');
  });

  test('every toolbar button has a name, and toggles report their state', () => {
    const { buttons } = mount();

    buttons.forEach((button) => expect(button.getAttribute('aria-label')).toMatch(/^rte_/));
    const toggles = buttons.filter((button) => button.dataset.rteCommand !== 'link');
    toggles.forEach((button) => expect(button.getAttribute('aria-pressed')).toBe('false'));
  });

  test('disabled, the text and every button refuse input and say so', () => {
    const { root, area, buttons } = mount();

    setRichTextDisabled(root, true);

    expect(area.getAttribute('contenteditable')).toBe('false');
    expect(area.getAttribute('aria-disabled')).toBe('true');
    buttons.forEach((button) => expect(button.disabled).toBe(true));
  });

  test('the editor meets WCAG A/AA', async () => {
    mount({ html: '<p>Hello</p>', describedBy: 'message-help' });

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);

    expect(results.violations).toEqual([]);
  });
});
