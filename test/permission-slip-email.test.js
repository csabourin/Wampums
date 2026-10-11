const { buildPermissionSlipEmailContent } = require('../utils/permission-slip-email');

describe('Permission slip email content', () => {
  test('includes participant name in subject and escapes HTML content', () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: '<b>Camp & Co</b>',
      activityDescription: 'Bring & snacks',
      meetingDate: '2026-06-01',
      deadlineDate: '2026-05-20',
      participantFirstName: '<i>Eva</i>',
      participantLastName: "O'Neil",
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'en',
      isReminder: false,
    });

    expect(result.subject).toBe(
      "Parent permission required - Camp & Co - Eva O'Neil",
    );
    expect(result.htmlBody).toContain('Camp &amp; Co');
    expect(result.htmlBody).toContain('Bring &amp; snacks');
    expect(result.textBody).toContain('Camp & Co');
  });

  test('uses localized fallbacks when participant name is missing', () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: '',
      activityDescription: '',
      meetingDate: '2026-06-01',
      deadlineDate: null,
      participantFirstName: '',
      participantLastName: '',
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'fr',
      isReminder: false,
    });

    expect(result.subject).toBe(
      'Autorisation parentale requise - Activité - Participant',
    );
  });

  test('builds reminder content with localized reminder strings', () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: 'Camp',
      activityDescription: '',
      meetingDate: '2026-06-01',
      deadlineDate: '2026-05-20',
      participantFirstName: 'Alex',
      participantLastName: 'Rivers',
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'en',
      isReminder: true,
    });

    expect(result.subject).toBe(
      'Reminder: Parent permission required - Camp - Alex Rivers',
    );
    expect(result.htmlBody).toContain('Reminder: Parent permission required');
    expect(result.htmlBody).toContain('We have not yet received your signature.');
    expect(result.htmlBody).toContain('Sign the permission slip now');
  });

  test('falls back to localized subjects without participant when missing', () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: 'Camp',
      activityDescription: '',
      meetingDate: '2026-06-01',
      deadlineDate: null,
      participantFirstName: 'Alex',
      participantLastName: 'Rivers',
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'id',
      isReminder: false,
    });

    // Indonesian has no subject with the participant's name, so the
    // Indonesian subject without it wins over the English one with it.
    expect(result.subject).toBe('Diperlukan izin orang tua - Camp');
  });

  test("uses the Ukrainian subject with the participant's name", () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: 'Camp',
      activityDescription: '',
      meetingDate: '2026-06-01',
      deadlineDate: null,
      participantFirstName: 'Alex',
      participantLastName: 'Rivers',
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'uk',
      isReminder: false,
    });

    expect(result.subject).toBe('Потрібен дозвіл батьків - Camp - Alex Rivers');
  });

  test('sends a formatted description as sanitized HTML and its plain text in the text part', () => {
    const result = buildPermissionSlipEmailContent({
      activityTitle: 'Camp',
      activityDescription: 'Bring:\n\n- boots',
      activityDescriptionHtml: '<p>Bring:</p><ul><li><strong>boots</strong></li></ul><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
      meetingDate: '2026-06-01',
      deadlineDate: null,
      participantFirstName: 'Alex',
      participantLastName: 'Rivers',
      signLink: 'https://example.com/permission-slip/token',
      languageCode: 'en',
      isReminder: false,
    });

    expect(result.htmlBody).toContain('<div><p>Bring:</p><ul><li><strong>boots</strong></li></ul>x</div>');
    expect(result.htmlBody).not.toMatch(/onerror|javascript:|<img/);
    expect(result.textBody).toContain('Bring:\n\n- boots');
  });
});
