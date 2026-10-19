/**
 * A receipt is written to a temp file for the Veryfi SDK. The client's file
 * name never reaches that path: only an extension from a fixed list does.
 *
 * @module test/veryfi-temp-file
 */
const { receiptExtension } = require('../services/veryfi');

test.each([
  ['receipt.JPG', '.jpg'],
  ['facture.pdf', '.pdf'],
  ['photo.heic', '.heic'],
])('a receipt named %s keeps its format (%s)', (name, extension) => {
  expect(receiptExtension(name)).toBe(extension);
});

test.each([
  '../../etc/passwd',
  '..\\..\\windows\\win.ini',
  'receipt.jpg/../../x.sh',
  'archive.tar.gz',
  'no-extension',
  '',
  undefined,
])('a name like %p adds nothing to the temp path', (name) => {
  expect(receiptExtension(name)).toBe('');
});
