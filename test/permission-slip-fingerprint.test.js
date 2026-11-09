/**
 * What a parent answered on a permission slip, and its proof (#1410).
 */
const crypto = require('crypto');
const {
  answeredContent,
  canonicalJson,
  describeSlip,
  fingerprintOf,
  fingerprintStatus,
  presentedFingerprint,
} = require('../services/permissionSlipFingerprint');

const CONTENT = {
  participant_id: 3,
  activity_id: 9,
  meeting_date: '2026-06-01',
  deadline_date: '2026-05-25T04:00:00Z',
  activity_title: 'Sortie canot',
  activity_description: 'Rivière des Outaouais',
  activity_description_html: '<p>Rivière des Outaouais</p>',
  authorization_text: 'Je permets à mon enfant de participer.',
  consent_payload: { swim_test: true, notes: ['gilet', 'chapeau'] },
};

/** A slip answered with the text it presents now. */
function answeredSlip(status = 'signed', content = CONTENT) {
  const frozen = answeredContent(content);
  return {
    id: 41,
    status,
    answered_content: frozen,
    signature_hash: fingerprintOf(frozen),
    slip_content: content,
  };
}

describe('the fingerprint of a permission slip', () => {
  test('is a SHA-256 of the text, the same whatever order its fields come in', () => {
    const reordered = Object.fromEntries(Object.entries(CONTENT).reverse());

    expect(presentedFingerprint(reordered)).toBe(presentedFingerprint(CONTENT));
    expect(presentedFingerprint(CONTENT)).toBe(crypto.createHash('sha256')
      .update(canonicalJson({ version: 1, content: CONTENT })).digest('hex'));
  });

  test('changes when any word of the text changes', () => {
    const edited = { ...CONTENT, authorization_text: 'Je permets à mon enfant de participer à la baignade.' };

    expect(presentedFingerprint(edited)).not.toBe(presentedFingerprint(CONTENT));
  });

  test('a signed slip whose text is unchanged is verified', () => {
    expect(fingerprintStatus(answeredSlip('signed'))).toBe('verified');
  });

  test('a declined slip is verified the same way: it proves which text was refused', () => {
    expect(fingerprintStatus(answeredSlip('declined'))).toBe('verified');
  });

  test('a slip whose text was changed after the answer is reported as altered', () => {
    const slip = { ...answeredSlip(), slip_content: { ...CONTENT, activity_title: 'Sortie vélo' } };

    expect(fingerprintStatus(slip)).toBe('altered');
  });

  test('a frozen text edited in the database no longer matches its fingerprint', () => {
    const slip = answeredSlip();
    slip.answered_content = answeredContent({ ...CONTENT, authorization_text: 'Autre texte' });
    slip.slip_content = slip.answered_content.content;

    expect(fingerprintStatus(slip)).toBe('altered');
  });

  test('a slip answered before fingerprints is never shown as verified, whatever its old value', () => {
    const old = {
      status: 'signed',
      answered_content: null,
      signature_hash: presentedFingerprint(CONTENT),
      slip_content: CONTENT,
    };

    expect(fingerprintStatus(old)).toBe('not_verifiable');
    expect(fingerprintStatus({ ...old, signature_hash: 'legacy-value' })).toBe('not_verifiable');
  });

  test('a slip not yet answered has no verification, and offers the fingerprint of the text it shows', () => {
    const slip = describeSlip({ id: 41, status: 'pending', slip_content: CONTENT, answered_content: null });

    expect(slip.fingerprint_status).toBeNull();
    expect(slip.presented_fingerprint).toBe(presentedFingerprint(CONTENT));
    expect(slip).not.toHaveProperty('slip_content');
    expect(slip).not.toHaveProperty('answered_content');
  });

  test('an answered slip offers no fingerprint to answer with again', () => {
    expect(describeSlip(answeredSlip()).presented_fingerprint).toBeNull();
  });
});
