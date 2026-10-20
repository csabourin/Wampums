const fs = require('fs');
const path = require('path');

const stylesheet = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8');

/** Every rule whose selector list contains `selector`, as written. */
function rulesFor(selector) {
  const rules = [];
  const pattern = /([^{}]+)\{([^}]*)\}/g;
  let match = pattern.exec(stylesheet);
  while (match) {
    if (match[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector) {
      rules.push(match[2]);
    }
    match = pattern.exec(stylesheet);
  }
  return rules;
}

describe('the programme bar never hides a screen\'s own bottom bar', () => {
  test('the points and attendance action bars sit above the programme bar while it shows', () => {
    // Both were pinned to the bottom under the programme bar, so leaders could
    // not reach the point and attendance buttons during the meeting.
    const lifted = stylesheet.match(/html\.has-programme-bar :is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(lifted).not.toBeNull();
    const selectors = lifted[1].split(',').map((part) => part.trim());
    expect(selectors).toEqual(expect.arrayContaining(['.points-action-bar', '.status-buttons', '.fixed-bottom', '.fixed-footer']));
    expect(lifted[2]).toMatch(/inset-block-end:\s*var\(--programme-bar-space\)/);
  });

  test('the badge tracker\'s add button sits above the programme bar too', () => {
    expect(rulesFor('html.has-programme-bar .badge-tracker__fab').join('\n'))
      .toMatch(/bottom:\s*calc\(var\(--programme-bar-space\)/);
  });
});
