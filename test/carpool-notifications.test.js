/**
 * Cancellation emails reach each family in its own language: a French-speaking
 * parent reads French, an English-speaking parent English, and a parent using
 * an optional language gets the unit's fallback language wherever that bundle
 * has no text yet.
 */
jest.mock('../utils/index', () => ({
  ...jest.requireActual('../utils/index'),
  sendEmail: jest.fn().mockResolvedValue(true),
  getUserEmailLanguage: jest.fn(),
}));
jest.mock('../services/emailSender', () => ({
  resolveOrganizationEmailSender: jest.fn().mockResolvedValue({ email: 'unit@example.test', name: 'Meute' }),
}));

const { sendEmail, getUserEmailLanguage } = require('../utils/index');
const {
  sendRideCancellationNotifications,
  sendActivityCancellationNotifications,
} = require('../utils/carpool-notifications');

const LANGUAGES = {
  'lea.parent@example.test': 'fr',
  'ada.parent@example.test': 'en',
  'oksana.parent@example.test': 'uk',
};

/** A pool that answers the unit's language setting and, when asked, the people to tell. */
function poolWith({ fallback = 'fr', recipients = [] } = {}) {
  return {
    query: jest.fn((sql) => {
      if (sql.includes("setting_key = 'interface_languages'")) {
        return Promise.resolve({ rows: [{ setting_value: { enabled: ['uk'], fallback } }] });
      }
      return Promise.resolve({ rows: recipients });
    }),
  };
}

/** @returns {Object} The email sent to that address: subject, text and html */
function emailTo(address) {
  const call = sendEmail.mock.calls.find(([to]) => to === address);
  return call && { subject: call[1], text: call[2], html: call[3] };
}

const ride = (guardianEmail, guardianName) => ({
  guardian_email: guardianEmail,
  guardian_name: guardianName,
  participant_name: 'Léa Tremblay',
  activity_name: 'Sortie canot',
  activity_date: '2026-11-22',
});

beforeEach(() => {
  jest.clearAllMocks();
  getUserEmailLanguage.mockImplementation((pool, email) => Promise.resolve(LANGUAGES[email]));
});

describe('a cancelled carpool ride', () => {
  test('a French-speaking parent is told in French, an English-speaking parent in English', async () => {
    await sendRideCancellationNotifications(poolWith(), [
      ride('lea.parent@example.test', 'Marie Tremblay'),
      ride('ada.parent@example.test', 'Ada Lovelace'),
    ], 1);

    const french = emailTo('lea.parent@example.test');
    expect(french.subject).toBe('Covoiturage annulé - Sortie canot');
    expect(french.text).toContain('Bonjour Marie Tremblay,');
    expect(french.text).toContain('Le covoiturage de Léa Tremblay pour « Sortie canot », le 22 novembre 2026, a été annulé.');
    expect(french.text).toContain('Veuillez prévoir un autre transport pour votre enfant.');
    expect(french.text).not.toMatch(/Hello|cancelled|Please/);

    const english = emailTo('ada.parent@example.test');
    expect(english.subject).toBe('Carpool ride cancelled - Sortie canot');
    expect(english.text).toContain('Hello Ada Lovelace,');
    expect(english.text).toContain('The carpool ride for Léa Tremblay to "Sortie canot" on November 22, 2026 has been cancelled.');
    expect(english.text).not.toMatch(/Bonjour|annulé/);
  });

  test('an optional language without these texts falls back to the unit\'s fallback language', async () => {
    await sendRideCancellationNotifications(poolWith({ fallback: 'fr' }), [ride('oksana.parent@example.test', 'Oksana Koval')], 1);

    expect(emailTo('oksana.parent@example.test').subject).toBe('Covoiturage annulé - Sortie canot');
  });

  test('names from people are escaped in the HTML email', async () => {
    await sendRideCancellationNotifications(poolWith(), [
      { ...ride('ada.parent@example.test', 'Ada'), activity_name: '<img src=x onerror=alert(1)>Canot' },
    ], 1);

    const { html } = emailTo('ada.parent@example.test');
    expect(html).not.toContain('<img');
    expect(html).toContain('Canot');
  });

  test('one email that fails does not stop the others', async () => {
    sendEmail.mockRejectedValueOnce(new Error('provider down'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await sendRideCancellationNotifications(poolWith(), [
      ride('lea.parent@example.test', 'Marie Tremblay'),
      ride('ada.parent@example.test', 'Ada Lovelace'),
    ], 1);

    expect(sendEmail).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});

describe('a cancelled activity', () => {
  test('each family is told in its own language', async () => {
    const recipients = [
      { email: 'lea.parent@example.test', guardian_name: 'Marie Tremblay', activity_name: 'Sortie canot', activity_date: '2026-11-22' },
      { email: 'ada.parent@example.test', guardian_name: 'Ada Lovelace', activity_name: 'Sortie canot', activity_date: '2026-11-22' },
    ];
    await sendActivityCancellationNotifications(poolWith({ recipients }), 7, 1);

    expect(emailTo('lea.parent@example.test').subject).toBe('Activité annulée - Sortie canot');
    expect(emailTo('lea.parent@example.test').text).toContain('Les covoiturages prévus pour cette activité sont annulés eux aussi.');
    expect(emailTo('ada.parent@example.test').subject).toBe('Activity cancelled - Sortie canot');
    expect(emailTo('ada.parent@example.test').text).toContain('All carpools planned for this activity are cancelled as well.');
  });
});
