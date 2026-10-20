const fs = require('fs');
const path = require('path');

const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

/** Every rule whose selector list is exactly `selectors`, as written. */
function rulesFor(selectors) {
  const rules = [];
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match = pattern.exec(stylesheet);
  while (match) {
    const list = match[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((part) => part.trim());
    if (list.includes(selectors)) {
      rules.push(match[2]);
    }
    match = pattern.exec(stylesheet);
  }
  return rules;
}

describe('manage points: the action bar and group headers stay readable', () => {
  test('a bar button at rest is neither faded nor ringed as if focused', () => {
    // A selector list missing `:disabled` / `:focus-visible` on its first entry
    // once dimmed every bar button and drew a focus ring around all of them.
    const atRest = rulesFor('.points-action-bar .point-btn').join('\n');
    expect(atRest).not.toMatch(/opacity/);
    expect(atRest).not.toMatch(/outline\s*:/);
  });

  test('a bar button shows the focus ring only when focused, and fades only while busy', () => {
    expect(rulesFor('.points-action-bar .point-btn:focus-visible').join('\n'))
      .toMatch(/outline:\s*3px solid var\(--color-focus-ring\)/);
    expect(rulesFor('.points-action-bar .point-btn:disabled').join('\n')).toMatch(/opacity/);
  });

  test('an unselected group header uses dark text on its pale background; a selected one, white', () => {
    expect(rulesFor('.manage-points-page .group-header').join('\n'))
      .toMatch(/color:\s*var\(--color-text\)/);
    expect(rulesFor('.manage-points-page .group-header.selected').join('\n'))
      .toMatch(/color:\s*white/);
  });
});
