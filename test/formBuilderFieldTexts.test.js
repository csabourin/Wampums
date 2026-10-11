/**
 * Shape check for a form field's own texts (routes/formBuilder.js).
 *
 * `labelText` and `infoHtml` map language codes to text. The SPA sanitizes
 * the HTML when it renders it; the server only rejects shapes nothing could
 * render.
 */

const { validateFieldTexts } = require('../routes/formBuilder');

const structure = (field) => ({ fields: [field] });

describe('validateFieldTexts', () => {
  it('accepts texts in any two-letter language', () => {
    expect(validateFieldTexts(structure({
      type: 'text',
      label: 'autres_langues_label',
      labelText: { fr: 'Autres langues', en: 'Other languages', uk: 'Інші мови' },
    }))).toBeNull();
    expect(validateFieldTexts(structure({ type: 'infoText', infoHtml: { it: '<p>Ciao</p>' } }))).toBeNull();
  });

  it('accepts fields without texts of their own', () => {
    expect(validateFieldTexts(structure({ type: 'text', label: 'ville_label' }))).toBeNull();
  });

  it.each([
    ['a string', 'Autres langues'],
    ['an array', ['fr']],
    ['null', null],
    ['a bad language code', { francais: 'Autres langues' }],
    ['a non-string text', { fr: 42 }],
  ])('rejects labelText given as %s', (_case, labelText) => {
    expect(validateFieldTexts(structure({ type: 'text', labelText }))).toMatch(/labelText/);
  });

  it('rejects an oversized text', () => {
    expect(validateFieldTexts(structure({ type: 'infoText', infoHtml: { fr: 'x'.repeat(20001) } })))
      .toMatch(/too long/);
  });
});
