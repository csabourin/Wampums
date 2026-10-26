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
  sendActivityUpdateNotifications,
  findActivityCancellationRecipients,
  sendActivityCancellationNotifications,
} = require('../utils/carpool-notifications');

const LANGUAGES = {
  'lea.parent@example.test': 'fr',
  'ada.parent@example.test': 'en',
  'oksana.parent@example.test': 'uk',
  'akela@example.test': 'fr',
  'baloo@example.test': 'en',
};

const AKELA = { id: 'a1', full_name: 'Julie Gagnon', email: 'akela@example.test' };
const BALOO = { id: 'b2', full_name: 'Grace Hopper', email: 'baloo@example.test' };

const CANOE_TRIP = {
  activity_name: 'Sortie canot',
  activity_date: '2026-11-22',
  meeting_location_going: 'Local scout',
  meeting_time_going: '08:00',
  departure_time_going: '08:15',
  meeting_location_return: null,
  meeting_time_return: null,
  departure_time_return: null,
};

/**
 * A pool that answers the unit's language setting, the activity, the unit's
 * activity leaders and, when asked, the families and drivers to tell.
 */
function poolWith({ fallback = 'fr', recipients = [], leaders = [], activity = CANOE_TRIP } = {}) {
  return {
    query: jest.fn((sql) => {
      if (sql.includes("setting_key = 'interface_languages'")) {
        return Promise.resolve({ rows: [{ setting_value: { enabled: ['uk'], fallback } }] });
      }
      if (sql.includes("r.data_scope = 'organization'")) {
        return leaders instanceof Error ? Promise.reject(leaders) : Promise.resolve({ rows: leaders });
      }
      if (/FROM activities\s+WHERE id = \$1/.test(sql)) {
        return Promise.resolve({ rows: activity ? [activity] : [] });
      }
      return Promise.resolve({ rows: recipients });
    }),
  };
}

/** @returns {string[]} Every address an email was sent to, in order */
const addressees = () => sendEmail.mock.calls.map(([to]) => to);

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

const FAMILIES = [
  { email: 'lea.parent@example.test', name: 'Marie Tremblay' },
  { email: 'ada.parent@example.test', name: 'Ada Lovelace' },
];

describe('an updated activity', () => {
  test('the unit\'s leaders are told as well as the families, each in their own language', async () => {
    await sendActivityUpdateNotifications(poolWith({ recipients: FAMILIES, leaders: [AKELA, BALOO] }), 7, 1);

    expect(addressees().sort()).toEqual([
      'ada.parent@example.test', 'akela@example.test', 'baloo@example.test', 'lea.parent@example.test',
    ]);
    expect(emailTo('akela@example.test').text).toContain('Bonjour Julie Gagnon,');
    expect(emailTo('baloo@example.test').text).toContain('Hello Grace Hopper,');
    expect(emailTo('baloo@example.test').text).toContain('Local scout');
  });

  test('a leader who is also a parent of the activity gets one email', async () => {
    const parentLeader = { ...AKELA, email: 'Lea.Parent@example.test' };
    await sendActivityUpdateNotifications(poolWith({ recipients: FAMILIES, leaders: [parentLeader] }), 7, 1);

    expect(addressees()).toHaveLength(2);
    expect(emailTo('lea.parent@example.test').text).toContain('Marie Tremblay');
  });

  test('the leaders are told even when no family is concerned yet', async () => {
    await sendActivityUpdateNotifications(poolWith({ leaders: [AKELA] }), 7, 1);

    expect(addressees()).toEqual(['akela@example.test']);
  });

  test('the families are still told when the leaders cannot be listed', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    await sendActivityUpdateNotifications(poolWith({ recipients: FAMILIES, leaders: new Error('db down') }), 7, 1);

    expect(addressees().sort()).toEqual(['ada.parent@example.test', 'lea.parent@example.test']);
    consoleError.mockRestore();
  });

  test('an activity of another unit emails no one', async () => {
    await sendActivityUpdateNotifications(poolWith({ recipients: FAMILIES, leaders: [AKELA], activity: null }), 7, 1);

    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('a cancelled activity', () => {
  /** Find who to tell, then tell them, as DELETE /activities/:id does. */
  async function cancel(pool) {
    const notice = await findActivityCancellationRecipients(pool, 7, 1);
    await sendActivityCancellationNotifications(pool, 1, notice);
    return notice;
  }

  test('the unit\'s leaders are told as well as the families', async () => {
    await cancel(poolWith({ recipients: FAMILIES, leaders: [AKELA] }));

    expect(addressees().sort()).toEqual(['ada.parent@example.test', 'akela@example.test', 'lea.parent@example.test']);
    expect(emailTo('akela@example.test').subject).toBe('Activité annulée - Sortie canot');
  });

  test('each family is told in its own language', async () => {
    await cancel(poolWith({ recipients: FAMILIES }));

    expect(emailTo('lea.parent@example.test').subject).toBe('Activité annulée - Sortie canot');
    expect(emailTo('lea.parent@example.test').text).toContain('Les covoiturages prévus pour cette activité sont annulés eux aussi.');
    expect(emailTo('ada.parent@example.test').subject).toBe('Activity cancelled - Sortie canot');
    expect(emailTo('ada.parent@example.test').text).toContain('All carpools planned for this activity are cancelled as well.');
  });

  test('an activity open to every participant is announced to the whole unit', async () => {
    const pool = poolWith({ recipients: FAMILIES, activity: { ...CANOE_TRIP, invites_everyone: true } });
    await findActivityCancellationRecipients(pool, 7, 1);
    const concernedCall = pool.query.mock.calls.find(([sql]) => sql.includes('WITH recipients AS'));
    expect(concernedCall[1]).toEqual([7, 1, true]);
  });

  test('an activity for some participants is announced only to those it concerns', async () => {
    const pool = poolWith({ recipients: FAMILIES, activity: { ...CANOE_TRIP, invites_everyone: false } });
    await findActivityCancellationRecipients(pool, 7, 1);
    const concernedCall = pool.query.mock.calls.find(([sql]) => sql.includes('WITH recipients AS'));
    expect(concernedCall[1]).toEqual([7, 1, false]);
  });

  test('an activity of another unit has no one to tell', async () => {
    expect(await findActivityCancellationRecipients(poolWith({ leaders: [AKELA], activity: null }), 7, 1)).toBeNull();
  });
});
