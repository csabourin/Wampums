/**
 * @jest-environment jsdom
 */

/**
 * "Write to families": the message is written in the basic rich-text editor,
 * and the announcement carries both its formatting and its plain text.
 *
 * @module test/spa/AnnouncementComposer
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/config.js', () => ({ CONFIG: { DEFAULT_LANG: 'fr' } }));
jest.mock('../../spa/ajax-functions.js', () => ({
  getMailingList: jest.fn(),
  getAnnouncements: jest.fn(),
  createAnnouncement: jest.fn(),
  getGroups: jest.fn(),
}));
jest.mock('../../spa/api/api-endpoints.js', () => ({ sendAnnouncementTest: jest.fn() }));
jest.mock('../../spa/modules/AI.js', () => ({ aiGenerateText: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canSendCommunications: () => true }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ prompt: jest.fn(), alert: jest.fn() }));

const ajax = {
  ...require('../../spa/ajax-functions.js'),
  ...require('../../spa/api/api-endpoints.js'),
};
const { aiGenerateText } = require('../../spa/modules/AI.js');
const { MailingList } = require('../../spa/modules/mailing-list/MailingList.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Render the page with one template.
 * @param {{groups?: Array<Object>}} [options] - The unit's dens
 * @returns {Promise<MailingList>}
 */
async function renderPage({ groups = [] } = {}) {
  document.body.innerHTML = '<main id="app"></main>';
  ajax.getMailingList.mockResolvedValue({ success: true, emails_by_role: {} });
  ajax.getGroups.mockResolvedValue({ data: groups });
  ajax.getAnnouncements.mockResolvedValue({
    data: [],
    templates: [{ title: 'Rappel', subject: 'Rappel', body: 'Bonjour\n\nÀ <bientôt>' }],
    roles: [{ role_name: 'parent' }],
  });
  ajax.createAnnouncement.mockResolvedValue({ success: true, data: { id: 1, status: 'sent', subject: 'Camp', logs: [] } });
  const page = new MailingList({ lang: 'fr', router: { navigate: jest.fn() }, showMessage: jest.fn() });
  await page.init();
  return page;
}

const messageArea = () => document.getElementById('announcement-message');
const submit = () => document.getElementById('announcement-form')
  .dispatchEvent(new Event('submit', { cancelable: true }));

beforeEach(() => jest.clearAllMocks());

test('the message is a labelled, required rich-text editor with its toolbar', async () => {
  await renderPage();

  const area = messageArea();
  expect(area.getAttribute('role')).toBe('textbox');
  expect(area.getAttribute('contenteditable')).toBe('true');
  expect(area.getAttribute('aria-required')).toBe('true');
  expect(document.getElementById(area.getAttribute('aria-labelledby')).textContent).toBe('announcement_message');
  expect(document.querySelector('#announcement-form [role="toolbar"]')).not.toBeNull();
  expect(document.querySelector('textarea#announcement-message')).toBeNull();
});

test('sends the formatted message with its plain text', async () => {
  await renderPage();
  document.getElementById('announcement-subject').value = 'Camp';
  messageArea().innerHTML = '<p>Apportez :</p><ul><li><strong>des bottes</strong></li></ul>';

  submit();
  await flush();

  expect(ajax.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
    subject: 'Camp',
    message: 'Apportez :\n\n- des bottes',
    message_html: '<p>Apportez :</p><ul><li><strong>des bottes</strong></li></ul>',
  }));
});

test('an empty message is refused with an error tied to the editor', async () => {
  await renderPage();
  document.getElementById('announcement-subject').value = 'Camp';
  messageArea().innerHTML = '<p><br></p>';

  submit();
  await flush();

  expect(ajax.createAnnouncement).not.toHaveBeenCalled();
  const area = messageArea();
  expect(area.getAttribute('aria-invalid')).toBe('true');
  expect(area.getAttribute('aria-describedby')).toBe('announcement-message-error');
  expect(document.getElementById('announcement-message-error').textContent).toBe('announcement_message_required');
  expect(document.activeElement).toBe(area);

  area.innerHTML = '<p>Bonjour</p>';
  area.dispatchEvent(new Event('input'));
  expect(area.hasAttribute('aria-invalid')).toBe(false);
  expect(document.getElementById('announcement-message-error').textContent).toBe('');
});

test('a template fills the editor with its text as paragraphs, escaped', async () => {
  await renderPage();
  const select = document.getElementById('announcement-template');
  select.value = '0';
  select.dispatchEvent(new Event('change'));

  expect(messageArea().innerHTML).toBe('<p>Bonjour</p><p>À &lt;bientôt&gt;</p>');
});

test('the writing assistant gets the plain text and its answer becomes paragraphs', async () => {
  await renderPage();
  messageArea().innerHTML = '<p>Salut <em>tout le monde</em></p>';
  // The API's own shape: the model's answer sits under data.data.
  aiGenerateText.mockResolvedValue({
    success: true,
    data: { data: { text: 'Bonjour à tous\n\nMerci' }, usage: {}, budget: {} },
  });

  document.getElementById('ai-rewrite-btn').click();
  await flush();

  expect(aiGenerateText).toHaveBeenCalledWith('rewrite', { text: 'Salut tout le monde', tone: 'professional' });
  expect(messageArea().innerHTML).toBe('<p>Bonjour à tous</p><p>Merci</p>');
  expect(document.getElementById('announcement-feedback').textContent).toBe('rewrite_success');
});

test('a translation replaces the message with the translated text', async () => {
  await renderPage();
  messageArea().innerHTML = '<p>Bonjour</p>';
  aiGenerateText.mockResolvedValue({ success: true, data: { data: { text: 'Hello' } } });

  document.getElementById('ai-translate-btn').click();
  await flush();

  expect(aiGenerateText).toHaveBeenCalledWith('translate', expect.objectContaining({
    text: 'Bonjour', from: 'fr', to: 'en',
  }));
  expect(messageArea().innerHTML).toBe('<p>Hello</p>');
});

test('a translation carries the unit\'s own terms in both languages', async () => {
  const page = await renderPage();
  page.app.waitForOrganizationSettings = () => Promise.resolve({
    unit_vocabulary: {
      locales: {
        fr: { youth_plural: 'Louveteaux', subgroup_plural: 'Tanières' },
        en: { youth_plural: 'Cubs', subgroup_plural: 'Dens' },
      },
    },
  });
  messageArea().innerHTML = '<p>Les Louveteaux et leurs Tanières</p>';
  aiGenerateText.mockResolvedValue({ success: true, data: { data: { text: 'The Cubs and their Dens' } } });

  document.getElementById('ai-translate-btn').click();
  await flush();

  const [, payload] = aiGenerateText.mock.calls[0];
  expect(payload.sourceVocabulary).toEqual(expect.objectContaining({ youth_plural: 'Louveteaux', subgroup_plural: 'Tanières' }));
  expect(payload.targetVocabulary).toEqual(expect.objectContaining({ youth_plural: 'Cubs', subgroup_plural: 'Dens' }));
  expect(messageArea().innerHTML).toBe('<p>The Cubs and their Dens</p>');
});

test('an answer without text leaves the message as written and says so', async () => {
  await renderPage();
  messageArea().innerHTML = '<p>Salut</p>';
  aiGenerateText.mockResolvedValue({ success: true, data: { data: {} } });

  document.getElementById('ai-rewrite-btn').click();
  await flush();

  expect(messageArea().innerHTML).toBe('<p>Salut</p>');
  expect(document.getElementById('announcement-feedback').textContent).toBe('ai_text_empty_result');
});

test('a message to one den alone is sent to that den, with no role', async () => {
  await renderPage({ groups: [{ id: 7, name: 'Tanière rouge' }] });
  document.getElementById('announcement-subject').value = 'Sortie';
  messageArea().innerHTML = '<p>Bonjour</p>';
  document.querySelectorAll('input[name="recipient-role"]').forEach((box) => { box.checked = false; });
  document.querySelector('input[name="recipient-group"][value="7"]').checked = true;

  submit();
  await flush();

  expect(ajax.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({
    recipient_roles: [],
    recipient_group_ids: [7],
  }));
});

test('without any role or den, nothing is sent and the leader is told why', async () => {
  await renderPage({ groups: [{ id: 7, name: 'Tanière rouge' }] });
  document.getElementById('announcement-subject').value = 'Sortie';
  messageArea().innerHTML = '<p>Bonjour</p>';
  document.querySelectorAll('input[name="recipient-role"]').forEach((box) => { box.checked = false; });

  submit();
  await flush();

  expect(ajax.createAnnouncement).not.toHaveBeenCalled();
  expect(document.getElementById('announcement-feedback').textContent).toBe('announcement_recipients_required');
  expect(document.activeElement).toBe(document.querySelector('input[name="recipient-role"]'));
});

test('the dens are a named group of checkboxes, their names escaped', async () => {
  await renderPage({ groups: [{ id: 7, name: '<img src=x onerror=alert(1)>' }] });

  const fieldset = document.querySelector('input[name="recipient-group"]').closest('fieldset');
  expect(fieldset.querySelector('legend').textContent).toBe('select_groups');
  expect(fieldset.getAttribute('aria-describedby')).toBe('announcement-groups-help');
  expect(fieldset.querySelector('img')).toBeNull();
  expect(fieldset.textContent).toContain('<img src=x onerror=alert(1)>');
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});

test('"send me a test" emails the message as written to the leader, saving nothing', async () => {
  await renderPage();
  ajax.sendAnnouncementTest.mockResolvedValue({ success: true, data: { email: 'akela@unit.test' } });
  document.getElementById('announcement-subject').value = 'Camp';
  messageArea().innerHTML = '<p>Bonjour <strong>familles</strong></p>';

  document.getElementById('send-announcement-test').click();
  await flush();

  expect(ajax.sendAnnouncementTest).toHaveBeenCalledWith({
    subject: 'Camp',
    message: 'Bonjour familles',
    message_html: '<p>Bonjour <strong>familles</strong></p>',
    audience: 'members',
  });
  expect(ajax.createAnnouncement).not.toHaveBeenCalled();
  const feedback = document.getElementById('announcement-feedback');
  expect(feedback.textContent).toBe('test_email_sent');
  expect(feedback.getAttribute('role')).toBe('status');
});

test('a test of an empty message is refused like a send', async () => {
  await renderPage();
  document.getElementById('announcement-subject').value = 'Camp';
  document.getElementById('send-announcement-test').click();
  await flush();

  expect(ajax.sendAnnouncementTest).not.toHaveBeenCalled();
  expect(messageArea().getAttribute('aria-invalid')).toBe('true');
});

test('the composer has no WCAG A/AA violations', async () => {
  await renderPage();
  const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
  expect(results.violations).toEqual([]);
});
