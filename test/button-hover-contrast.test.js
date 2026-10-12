const fs = require('fs');
const path = require('path');

const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

describe('global button hover', () => {
  test('a self-styled button keeps its own background on hover, so its dark text stays readable', () => {
    // A bare `button:hover` at (0,2,1) beat component classes and painted a dark
    // green gradient behind their dark text (sticky after a tap on touch screens).
    expect(stylesheet).not.toMatch(/^button:hover:not\(:disabled\)/m);
    expect(stylesheet).toMatch(/:where\(button:hover:not\(:disabled\)/);
  });

  test('the ghost button never takes the green gradient', () => {
    const rule = stylesheet.match(/^\.ghost-button \{[^}]*\}/m)[0];
    expect(rule).toMatch(/background-image:\s*none/);
    expect(stylesheet).toMatch(/\.ghost-button:hover:not\(:disabled\)\s*\{[^}]*background-image:\s*none/);
  });
});
