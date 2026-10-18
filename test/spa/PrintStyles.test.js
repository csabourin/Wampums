/**
 * The printing rules of the stylesheet, which jsdom cannot lay out: these tests
 * read the rules themselves.
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../css/styles.css'), 'utf8');

/**
 * @param {string} source - Stylesheet text
 * @param {string} at - The at-rule to find, such as `@media print`
 * @returns {string[]} The body of every such block
 */
function blocksOf(source, at) {
  const blocks = [];
  let from = source.indexOf(at);
  while (from !== -1) {
    const open = source.indexOf('{', from);
    let depth = 1;
    let index = open + 1;
    while (depth > 0 && index < source.length) {
      if (source[index] === '{') {depth += 1;}
      if (source[index] === '}') {depth -= 1;}
      index += 1;
    }
    blocks.push(source.slice(open + 1, index - 1));
    from = source.indexOf(at, index);
  }
  return blocks;
}

const printCss = blocksOf(css, '@media print').join('\n');

describe('paper size', () => {
  test('printing uses the paper chosen in the print dialog, not a fixed size', () => {
    // `size: letter` printed an A4 sheet scaled or cropped, and the other way round.
    expect(css).not.toMatch(/@page\s*{[^}]*size:\s*letter/);
    expect(printCss).toMatch(/@page\s*{[^}]*margin:\s*10mm/);
  });
});

describe('printable den list', () => {
  test('keeps each den whole, in two columns, so a dozen dens fit one sheet', () => {
    expect(printCss).toMatch(/\.den-list\s*{[^}]*column-count:\s*2/);
    expect(printCss).toMatch(/\.den-list tbody\s*{[^}]*break-inside:\s*avoid/);
    expect(printCss).toMatch(/\.den-list tr\s*{\s*break-inside:\s*avoid/);
  });

  test('leaves the column headings off the paper, since the den and its youth explain themselves', () => {
    expect(printCss).toMatch(/\.den-list thead\s*{\s*display:\s*none/);
  });

  test('the den cell has no rule under it: the den block closes it', () => {
    expect(printCss).toMatch(/\.den-list td\[rowspan\]\s*{[^}]*border-block-end:\s*0/);
  });

  test('leaves the print button and the page chrome off the sheet', () => {
    expect(printCss).toContain('.den-list-report__actions');
    expect(printCss).toContain('body:has(.den-list-report) #news-widget');
  });

  test('never hides the whole page to print a part of it', () => {
    // The old page used `body * { visibility: hidden }`, which kept the hidden
    // content's space on the sheet and, left in <head>, blanked later prints.
    expect(css).not.toMatch(/body \*\s*{\s*visibility:\s*hidden/);
  });

  test('stays a real table on a phone', () => {
    const phone = blocksOf(css, '@media (width <=600px)').join('\n');
    expect(phone).toMatch(/\.den-list\s*{\s*display:\s*table/);
  });
});
