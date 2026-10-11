/**
 * Basic rich text for emailed content (utils/richText.js).
 *
 * The server rebuilds formatted text from scratch: only the editor's tags
 * survive, links keep a checked address, and every piece of text is escaped.
 */

const {
  plainTextToRichText,
  readRichTextField,
  richTextToPlainText,
  sanitizeRichTextHtml,
} = require('../utils/richText');

describe('sanitizeRichTextHtml', () => {
  it('keeps paragraphs, line breaks, bold, italic, lists and links', () => {
    const html = '<p>Hi <b>all</b>, <i>see</i><br><em>you</em> <strong>soon</strong></p>'
      + '<ul><li>One</li></ul><ol><li>Two</li></ol><p><a href="https://example.com/a?b=1&amp;c=2">site</a></p>';
    expect(sanitizeRichTextHtml(html)).toBe(
      '<p>Hi <strong>all</strong>, <em>see</em><br><em>you</em> <strong>soon</strong></p>'
      + '<ul><li>One</li></ul><ol><li>Two</li></ol><p><a href="https://example.com/a?b=1&amp;c=2">site</a></p>',
    );
  });

  it.each([
    ['a script and its content', '<p>a<script>alert(1)</script>b</p>', '<p>ab</p>'],
    ['event handlers', '<p onclick="alert(1)" onmouseover=alert(1)>a</p>', '<p>a</p>'],
    ['an image', '<p>a<img src=x onerror=alert(1)></p>', '<p>a</p>'],
    ['a style block', '<style>p{color:red}</style><p>a</p>', '<p>a</p>'],
    ['an iframe and its content', '<iframe src="https://evil.test">x</iframe><p>a</p>', '<p>a</p>'],
    ['a comment', '<p>a<!-- <script>alert(1)</script> -->b</p>', '<p>ab</p>'],
    ['a javascript: link', '<a href="javascript:alert(1)">a</a>', 'a'],
    ['an entity-encoded javascript: link', '<a href="jav&#x09;ascript:alert(1)">a</a>', 'a'],
    ['a data: link', '<a href="data:text/html,x">a</a>', 'a'],
    ['other attributes on a link', '<a href="https://x.test" target="_blank" style="x">a</a>', '<a href="https://x.test">a</a>'],
    ['a quote breaking out of the address', '<a href=\'https://x.test/"onmouseover="alert(1)\'>a</a>', '<a href="https://x.test/&quot;onmouseover=&quot;alert(1)">a</a>'],
    ['a nested tag trick', '<<script>script>alert(1)<</script>/script>', 'script&gt;alert(1)/script&gt;'],
    ['an unclosed tag', '<p>a<b', '<p>a</p>'],
  ])('drops %s', (_case, html, expected) => {
    expect(sanitizeRichTextHtml(html)).toBe(expected);
  });

  it('escapes text, decoding the entities an editor produces first', () => {
    expect(sanitizeRichTextHtml('<p>&lt;b&gt; &amp; "x"</p>')).toBe('<p>&lt;b&gt; &amp; &quot;x&quot;</p>');
  });

  it('closes elements left open and ignores stray closing tags', () => {
    expect(sanitizeRichTextHtml('<p><strong>a</p></em>b')).toBe('<p><strong>a</strong></p>b');
  });

  it('keeps mail and phone links', () => {
    expect(sanitizeRichTextHtml('<a href="mailto:a@b.test">a</a> <a href="tel:+15551234">b</a>'))
      .toBe('<a href="mailto:a@b.test">a</a> <a href="tel:+15551234">b</a>');
  });

  it('returns an empty string when nothing visible remains', () => {
    expect(sanitizeRichTextHtml('<p><br></p><p>&nbsp;</p>')).toBe('');
    expect(sanitizeRichTextHtml(null)).toBe('');
    expect(sanitizeRichTextHtml({ html: '<p>a</p>' })).toBe('');
  });
});

describe('richTextToPlainText', () => {
  it('keeps paragraphs, line breaks, list markers and link addresses', () => {
    const html = '<p>Hello<br>families</p><ul><li>Boots</li><li>Hat</li></ul>'
      + '<ol><li>First<ol><li>Inner</li></ol></li></ol><p>See <a href="https://example.com">the list</a> '
      + 'or <a href="mailto:a@b.test">a@b.test</a></p>';
    expect(richTextToPlainText(html)).toBe(
      'Hello\nfamilies\n\n- Boots\n- Hat\n\n1. First\n  1. Inner\n\nSee the list (https://example.com) or a@b.test',
    );
  });

  it('decodes entities', () => {
    expect(richTextToPlainText('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3');
  });
});

describe('plainTextToRichText', () => {
  it('makes paragraphs at blank lines and keeps line breaks, escaped', () => {
    expect(plainTextToRichText('a\nb\n\n<c>')).toBe('<p>a<br>b</p><p>&lt;c&gt;</p>');
    expect(plainTextToRichText('  ')).toBe('');
  });
});

describe('readRichTextField', () => {
  it('returns safe HTML with its plain text, or nulls', () => {
    expect(readRichTextField('<p>Hi <b>all</b></p>')).toEqual({ html: '<p>Hi <strong>all</strong></p>', text: 'Hi all' });
    expect(readRichTextField('<p></p>')).toEqual({ html: null, text: null });
    expect(readRichTextField(undefined)).toEqual({ html: null, text: null });
  });
});

test('a list after bare text starts after a blank line', () => {
  expect(richTextToPlainText('Bonjour <strong>familles</strong><ul><li>Bottes</li></ul><p>Merci</p>'))
    .toBe('Bonjour familles\n\n- Bottes\n\nMerci');
});
