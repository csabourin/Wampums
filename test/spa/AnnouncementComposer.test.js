/**
 * @jest-environment jsdom
 */
jest.mock('../../spa/utils/AIUtils.js', () => ({ canUseAI: () => true, aiActionLabel: (key) => `${key} IA` }));


/**
 * "Write to families": the message is written in the basic rich-text editor,
 * and the announcement carries both its formatting and its plain text.
 *
 * @module test/spa/AnnouncementComposer
 */

import axe from 'axe-core';

jest.mock('../../spa/app.js', () => ({
  translate: (key) => ({
    announcement_email_sent: 'Email sent. Recipients: {sent}.',
    announcement_email_partial: '{sent} sent; {failed} failed. Message kept. Check history before sending again.',
    announcement_email_failed: 'No emails sent; {failed} failed. Message kept.',
  }[key] || key),
}));
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
jest.mock('../../spa/api/api-ai.js', () => ({ aiGenerateText: jest.fn() }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ canSendCommunications: () => true }));
jest.mock('../../spa/utils/DialogUtils.js', () => ({ prompt: jest.fn(), alert: jest.fn() }));

const ajax = {
  ...require('../../spa/ajax-functions.js'),
  ...require('../../spa/api/api-endpoints.js'),
};
const { aiGenerateText } = require('../../spa/api/api-ai.js');
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
  ajax.createAnnouncement.mockResolvedValue({ success: true, data: {
    id: 1, status: 'sent', subject: 'Camp', delivery: { email: { total: 2, sent: 2, failed: 0 } },
  } });
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
  expect(document.activeElement).toBe(document.getElementById('announcement-feedback'));
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

describe('sending feedback', () => {
  async function writeMessage() {
    const page = await renderPage({ groups: [{ id: 7, name: 'Red den' }] });
    document.getElementById('announcement-subject').value = 'Camp';
    messageArea().innerHTML = '<p>Bring <strong>boots</strong>.</p>';
    document.querySelector('input[name="recipient-group"]').checked = true;
    return page;
  }

  test('a confirmed email send leaves a focused persistent result beside the send button', async () => {
    const page = await writeMessage();
    const form = document.getElementById('announcement-form');
    const feedback = document.getElementById('announcement-feedback');

    submit();
    await flush();

    expect(document.getElementById('announcement-form')).toBe(form);
    expect(document.getElementById('announcement-feedback')).toBe(feedback);
    expect(form.contains(feedback)).toBe(true);
    expect(feedback.textContent).toContain('Email sent. Recipients: 2.');
    expect(feedback.classList.contains('success')).toBe(true);
    expect(document.activeElement).toBe(feedback);
    expect(feedback.querySelector('a').getAttribute('href')).toBe('/communication-history');
    expect(page.app.showMessage).toHaveBeenCalledWith('Email sent. Recipients: 2.', 'success');
    expect(messageArea().textContent).toBe('');
    expect(form.getAttribute('aria-busy')).not.toBe('true');
  });

  test.each([
    { status: 'partial', email: { total: 2, sent: 1, failed: 1 }, result: '1 sent; 1 failed.' },
    { status: 'failed', email: { total: 2, sent: 0, failed: 2 }, result: 'No emails sent; 2 failed.' },
    { status: 'failed', email: { total: 0, sent: 0, failed: 0 }, result: 'announcement_email_no_recipients' },
  ])('$status email results keep the message and recipient choices', async ({ status, email, result }) => {
    await writeMessage();
    ajax.createAnnouncement.mockResolvedValue({ success: true, data: { id: 1, status, delivery: { email } } });

    submit();
    await flush();

    const feedback = document.getElementById('announcement-feedback');
    expect(feedback.textContent).toContain(result);
    expect(feedback.classList.contains('success')).toBe(false);
    expect(document.activeElement).toBe(feedback);
    expect(document.getElementById('announcement-subject').value).toBe('Camp');
    expect(messageArea().innerHTML).toBe('<p>Bring <strong>boots</strong>.</p>');
    expect(document.querySelector('input[name="recipient-group"]').checked).toBe(true);
  });

  test.each([
    { success: true, queued: true },
    { success: true, data: { status: 'sending' } },
    { success: true, data: { status: 'sent' } },
  ])('an unconfirmed response keeps the draft and never claims that email was sent', async (response) => {
    await writeMessage();
    ajax.createAnnouncement.mockResolvedValue(response);

    submit();
    await flush();

    expect(document.getElementById('announcement-feedback').textContent).toContain('announcement_send_unconfirmed');
    expect(messageArea().innerHTML).toBe('<p>Bring <strong>boots</strong>.</p>');
  });

  test('a lost response keeps the draft and asks the leader to check history before retrying', async () => {
    await writeMessage();
    ajax.createAnnouncement.mockRejectedValue(Object.assign(new Error('network lost'), { code: 'operation_unconfirmed' }));

    submit();
    await flush();

    expect(document.getElementById('announcement-feedback').textContent).toContain('announcement_send_unconfirmed');
    expect(messageArea().innerHTML).toBe('<p>Bring <strong>boots</strong>.</p>');
    expect(document.getElementById('send-announcement').disabled).toBe(false);
  });

  test.each(['draft', 'scheduled'])('a saved %s is confirmed without claiming an email send', async (status) => {
    await writeMessage();
    ajax.createAnnouncement.mockResolvedValue({ success: true, data: { status } });

    submit();
    await flush();

    const key = status === 'draft' ? 'announcement_saved' : 'announcement_scheduled';
    expect(document.getElementById('announcement-feedback').textContent).toContain(key);
    expect(messageArea().textContent).toBe('');
  });

  test.each(['sent', 'draft', 'scheduled'])('after an alumni %s the reset audience has visible matching recipient controls', async (status) => {
    await writeMessage();
    const alumni = document.querySelector('input[name="announcement-audience"][value="alumni"]');
    alumni.checked = true;
    alumni.dispatchEvent(new Event('change'));
    expect(document.getElementById('announcement-member-filters').hidden).toBe(true);
    ajax.createAnnouncement.mockResolvedValue({
      success: true, data: { status, delivery: { email: { total: 2, sent: 2, failed: 0 } } },
    });

    submit();
    await flush();

    expect(document.querySelector('input[name="announcement-audience"]:checked').value).toBe('members');
    expect(document.getElementById('announcement-member-filters').hidden).toBe(false);
    expect(document.getElementById('announcement-group-filters').hidden).toBe(false);
  });

  test('while sending, one pending request locks the form and a second click sends nothing', async () => {
    await writeMessage();
    let resolve;
    ajax.createAnnouncement.mockImplementation(() => new Promise((done) => { resolve = done; }));

    submit();
    submit();

    expect(ajax.createAnnouncement).toHaveBeenCalledTimes(1);
    expect(document.getElementById('announcement-form').getAttribute('aria-busy')).toBe('true');
    expect(document.getElementById('send-announcement').disabled).toBe(true);
    expect(document.getElementById('announcement-feedback').textContent).toContain('announcement_sending');
    resolve({ success: true, data: { status: 'failed', delivery: { email: { total: 1, sent: 0, failed: 1 } } } });
    await flush();
    expect(document.getElementById('send-announcement').disabled).toBe(false);
  });

  test('a late send response cannot erase the next screen', async () => {
    const page = await writeMessage();
    let resolve;
    ajax.createAnnouncement.mockImplementation(() => new Promise((done) => { resolve = done; }));
    submit();
    page.destroy();
    document.getElementById('app').innerHTML = '<h1>Next screen</h1>';
    resolve({ success: true, data: { status: 'sent', delivery: { email: { total: 1, sent: 1, failed: 0 } } } });
    await flush();
    expect(document.getElementById('app').textContent).toBe('Next screen');
  });
});
