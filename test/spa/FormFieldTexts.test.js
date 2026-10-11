/**
 * @jest-environment jsdom
 */

/**
 * A form field's own texts, in every content language
 *
 * The form builder's "Ajouter une traduction" wrote to a global translations
 * table nothing ever read, opened empty, and failed to save. A field now keeps
 * its own label (`labelText`) and information text (`infoHtml`) per language
 * in the unit's form format; the dialog starts each language from the current
 * text, and information texts are edited with a small rich-text editor.
 *
 * @module test/spa/FormFieldTexts
 */

import axe from 'axe-core';

const mockApp = {
  lang: 'fr',
  translations: {},
  loadTranslation: jest.fn((lang) => {
    mockApp.translations[lang] = mockApp.translations[lang] || mockBundles[lang] || {};
    return Promise.resolve();
  }),
};

const mockBundles = {
  fr: {
    consentement_label: 'Consentement',
    consentement_texte: '<p>Tout au long de l’année…</p>',
  },
  en: {
    consentement_label: 'Consent',
    consentement_texte: '<p>Throughout the year…</p>',
  },
  it: { consentement_texte: '<p>Durante l’anno…</p>' },
  uk: {},
  id: {},
};

// A getter: imports are hoisted above mockApp's initialisation.
jest.mock('../../spa/app.js', () => ({
  get app() {
    return mockApp;
  },
  translate: (key) => mockApp.translations[mockApp.lang]?.[key] || key,
}));

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

jest.mock('../../spa/config.js', () => ({ CONFIG: {} }));
jest.mock('../../spa/api/api-core.js', () => ({ API: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));
jest.mock('../../spa/ajax-functions.js', () => ({
  getOrganizationFormFormats: jest.fn(),
  getFormSubmission: jest.fn(),
  saveFormSubmission: jest.fn()
}));
jest.mock('../../spa/utils/DialogUtils.js', () => ({
  confirmDestructive: jest.fn(),
  prompt: jest.fn(),
  alert: jest.fn(),
  hasActiveDialog: jest.fn(() => false),
}));

import { FormBuilder } from '../../spa/formBuilder.js';
import { JSONFormRenderer } from '../../spa/JSONFormRenderer.js';
import { API } from '../../spa/api/api-core.js';
import { closeAllModals } from '../../spa/utils/ModalUtils.js';
import {
  resolveFormText,
  richTextHasContent,
  sanitizeRichText,
} from '../../spa/utils/FormTextUtils.js';
import { FORM_CONTENT_LANGS } from '../../spa/config/languages.js';

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here.
  rules: { 'color-contrast': { enabled: false } }
};

const INFO_FIELD = { type: 'infoText', infoText: 'consentement_texte' };
const LABEL_FIELD = { name: 'consentement', type: 'checkbox', label: 'consentement_label' };

/**
 * A builder holding copies of the given fields, with its list rendered.
 *
 * @param {Object[]} fields - Initial fields
 * @returns {FormBuilder} The builder
 */
function builderWith(fields) {
  document.body.innerHTML = '<div id="fields-container"></div>';
  const builder = new FormBuilder({ showMessage: jest.fn() });
  builder.currentFields = fields.map((field) => JSON.parse(JSON.stringify(field)));
  builder.updateFieldsList();
  return builder;
}

/**
 * Open the translations dialog for the field being edited and wait for it.
 *
 * @param {FormBuilder} builder - The builder
 * @param {string} kind - `labelText` or `infoHtml`
 * @returns {Promise<void>}
 */
async function openTranslations(builder, kind) {
  await builder.showTranslationEditor(kind);
}

/**
 * Submit the translations dialog with its footer button.
 *
 * @returns {void}
 */
function saveTranslations() {
  document.querySelector('#translation-modal .modal-footer button[type="submit"]').click();
}

beforeEach(() => {
  mockApp.lang = 'fr';
  mockApp.translations = { fr: mockBundles.fr, en: mockBundles.en };
});

afterEach(() => {
  closeAllModals();
  document.body.innerHTML = '';
  jest.clearAllMocks();
});

describe('Resolving a field text', () => {
  const translate = (key) => mockBundles.fr[key] || key;

  it('prefers the unit\'s text in the reader\'s language', () => {
    expect(resolveFormText({ fr: 'Notre texte' }, 'consentement_label', 'fr', translate))
      .toEqual({ text: 'Notre texte', own: true });
  });

  it('falls back to the app\'s text for the key', () => {
    expect(resolveFormText({ en: 'Our text' }, 'consentement_label', 'fr', translate))
      .toEqual({ text: 'Consentement', own: false });
  });

  it('never borrows another language\'s text: a page shows one language', () => {
    expect(resolveFormText({ it: 'Il nostro testo' }, 'cle_inconnue', 'fr', translate))
      .toEqual({ text: 'cle_inconnue', own: false });
  });
});

describe('Rich text keeps only the editor\'s formatting', () => {
  it('drops scripts, handlers, styles and unsafe links', () => {
    const html = sanitizeRichText(
      '<p style="color:red" onclick="x()">Hi <strong>you</strong><script>alert(1)</script>'
      + '<a href="javascript:alert(1)">bad</a> <a href="https://scouts.ca">ok</a></p><h1>T</h1>'
    );
    expect(html).toBe('<p>Hi <strong>you</strong><a>bad</a> <a href="https://scouts.ca">ok</a></p>T');
  });

  it('counts only visible text as content', () => {
    expect(richTextHasContent('<p><br></p><p>&nbsp;</p>')).toBe(false);
    expect(richTextHasContent('<p><script>alert(1)</script></p>')).toBe(false);
    expect(richTextHasContent('<p><strong>Oui</strong></p>')).toBe(true);
  });

  it('drops the empty paragraphs a browser leaves around a list', () => {
    expect(sanitizeRichText('<p>Avant</p><p><ul><li>un</li></ul></p><p><br></p>'))
      .toBe('<p>Avant</p><ul><li>un</li></ul>');
  });

  it('keeps lists and mail or phone links', () => {
    const html = '<ul><li><em>a</em></li></ul><ol><li><a href="mailto:a@b.ca">m</a> <a href="tel:+18195550000">t</a></li></ol>';
    expect(sanitizeRichText(html)).toBe(html);
  });
});

describe('The rendered form shows the unit\'s texts', () => {
  it('uses the own label in the reader\'s language, escaped', () => {
    const renderer = new JSONFormRenderer({
      fields: [{ ...LABEL_FIELD, labelText: { fr: 'J’accepte <b>tout</b>', en: 'I agree' } }],
    });
    document.body.innerHTML = renderer.render();
    expect(document.querySelector('label').textContent).toBe('J’accepte <b>tout</b>');
  });

  it('renders own information text as sanitized rich text', () => {
    const renderer = new JSONFormRenderer({
      fields: [{ ...INFO_FIELD, infoHtml: { fr: '<p>Photos <strong>oui</strong></p><img src=x onerror=alert(1)>' } }],
    });
    document.body.innerHTML = renderer.render();
    const info = document.querySelector('.info-text');
    expect(info.querySelector('strong').textContent).toBe('oui');
    expect(info.querySelector('img')).toBeNull();
  });

  it('keeps showing the app\'s text when the field has none of its own', () => {
    const renderer = new JSONFormRenderer({ fields: [INFO_FIELD] });
    document.body.innerHTML = renderer.render();
    expect(document.querySelector('.info-text').textContent).toBe('Tout au long de l’année…');
  });
});

describe('Form builder: the translations dialog', () => {
  it('starts every content language from the current text', async () => {
    const builder = builderWith([INFO_FIELD]);
    builder.renderFieldEditor(0);
    await openTranslations(builder, 'infoHtml');

    FORM_CONTENT_LANGS.forEach((lang) => expect(mockApp.loadTranslation).toHaveBeenCalledWith(lang));
    expect(document.getElementById('trans-fr').textContent).toBe('Tout au long de l’année…');
    expect(document.getElementById('trans-en').textContent).toBe('Throughout the year…');
    expect(document.getElementById('trans-it').textContent).toBe('Durante l’anno…');
    expect(document.getElementById('trans-uk').textContent).toBe('');
  });

  it('stores only the languages the unit changed, and saves them with the field', async () => {
    const builder = builderWith([INFO_FIELD]);
    builder.renderFieldEditor(0);
    await openTranslations(builder, 'infoHtml');

    document.getElementById('trans-fr').innerHTML = '<p>Texte de <strong>notre</strong> unité</p>';
    document.getElementById('trans-uk').innerHTML = '<p>Протягом року</p>';
    saveTranslations();

    expect(document.getElementById('translation-modal')).toBeNull();
    expect(document.getElementById('field-info-text-preview').innerHTML)
      .toBe('<p>Texte de <strong>notre</strong> unité</p>');

    document.querySelector('#field-editor-modal .modal-footer button[type="submit"]').click();
    expect(builder.currentFields[0].infoHtml).toEqual({
      fr: '<p>Texte de <strong>notre</strong> unité</p>',
      uk: '<p>Протягом року</p>',
    });
    expect(API.post).not.toHaveBeenCalled();
  });

  it('edits a label in a plain text box per language', async () => {
    const builder = builderWith([LABEL_FIELD]);
    builder.renderFieldEditor(0);
    await openTranslations(builder, 'labelText');

    expect(document.getElementById('trans-fr').value).toBe('Consentement');
    expect(document.getElementById('trans-it').value).toBe('');
    document.getElementById('trans-it').value = 'Consenso';
    saveTranslations();
    document.querySelector('#field-editor-modal .modal-footer button[type="submit"]').click();

    expect(builder.currentFields[0].labelText).toEqual({ it: 'Consenso' });
    expect(builder.currentFields[0].label).toBe('consentement_label');
  });

  it('keeps quotes in a text when the dialog is reopened', async () => {
    const builder = builderWith([{ ...LABEL_FIELD, labelText: { en: 'The child’s "preferred" name' } }]);
    builder.renderFieldEditor(0);
    await openTranslations(builder, 'labelText');

    expect(document.getElementById('trans-en').value).toBe('The child’s "preferred" name');
    saveTranslations();
    expect(builder.editorTexts.labelText.en).toBe('The child’s "preferred" name');
  });

  it('keeps the key required, since the mobile app reads only the key', async () => {
    const builder = builderWith([{ type: 'infoText' }]);
    builder.renderFieldEditor(0);
    const key = document.getElementById('field-info-text');
    expect(key.required).toBe(true);

    await openTranslations(builder, 'infoHtml');
    document.getElementById('trans-fr').innerHTML = '<p>Bienvenue</p>';
    saveTranslations();

    expect(key.required).toBe(true);
    expect(key.checkValidity()).toBe(false);
    key.value = 'bienvenue_texte';
    document.querySelector('#field-editor-modal .modal-footer button[type="submit"]').click();
    expect(builder.currentFields[0]).toEqual({
      type: 'infoText', required: false, infoText: 'bienvenue_texte', infoHtml: { fr: '<p>Bienvenue</p>' },
    });
  });

  it('flags each interface language where a field would show its bare key', () => {
    builderWith([
      LABEL_FIELD,
      { name: 'autre', type: 'text', label: 'cle_absente' },
      { name: 'propre', type: 'text', label: 'cle_absente', labelText: { fr: 'Le nôtre' } },
      { name: 'complet', type: 'text', label: 'cle_absente', labelText: { fr: 'Le nôtre', en: 'Ours' } },
    ]);
    const badges = Array.from(document.querySelectorAll('.field-item'))
      .map((item) => item.querySelector('.badge-warning .sr-only')?.textContent ?? null);
    const name = (code) => new Intl.DisplayNames(['fr'], { type: 'language' }).of(code).replace(/^./, (c) => c.toUpperCase());

    expect(badges).toEqual([
      null,
      `translation_missing : ${name('en')}, ${name('fr')}`,
      `translation_missing : ${name('en')}`,
      null,
    ]);
  });
});

describe('Rich-text editor accessibility', () => {
  /**
   * Open the information-text dialog for a fresh builder.
   *
   * @returns {Promise<void>}
   */
  async function openRichDialog() {
    const builder = builderWith([INFO_FIELD]);
    builder.renderFieldEditor(0);
    await openTranslations(builder, 'infoHtml');
  }

  it('is a named, multi-line text box the user can type in', async () => {
    await openRichDialog();
    const area = document.getElementById('trans-fr');
    expect(area.getAttribute('role')).toBe('textbox');
    expect(area.getAttribute('aria-multiline')).toBe('true');
    expect(area.getAttribute('contenteditable')).toBe('true');
    expect(area.getAttribute('lang')).toBe('fr');
    const name = document.getElementById(area.getAttribute('aria-labelledby')).textContent;
    expect(name).toBe(new Intl.DisplayNames(['fr'], { type: 'language' }).of('fr').replace(/^./, (c) => c.toUpperCase()));
  });

  it('has a toolbar with one Tab stop and arrow-key navigation', async () => {
    await openRichDialog();
    const toolbar = document.querySelector('#trans-fr').closest('[data-rte]').querySelector('[role="toolbar"]');
    const buttons = Array.from(toolbar.querySelectorAll('button'));

    expect(buttons.map((button) => button.getAttribute('aria-label')))
      .toEqual(['rte_bold', 'rte_italic', 'rte_bullet_list', 'rte_numbered_list', 'rte_link']);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false');

    buttons[0].focus();
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[4]);
    toolbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[0]]);
  });

  it('runs formatting from the toolbar and cleans pasted markup', async () => {
    document.execCommand = jest.fn();
    await openRichDialog();
    const area = document.getElementById('trans-fr');
    const bold = area.closest('[data-rte]').querySelector('[data-rte-command="bold"]');

    bold.click();
    expect(document.execCommand).toHaveBeenCalledWith('bold', false, undefined);

    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: (type) => (type === 'text/html' ? '<p style="font:Arial"><span>Hi</span><script>x()</script></p>' : 'Hi') };
    area.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('insertHTML', false, '<p>Hi</p>');
    delete document.execCommand;
  });

  it('has no WCAG A/AA violations', async () => {
    await openRichDialog();
    const results = await axe.run(document.getElementById('translation-modal'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });
});
