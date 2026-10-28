/**
 * Every screen follows the same conventions (CLAUDE.md §7): the shared back
 * link, the `button` classes, and no server message on screen.
 *
 * Screens written before a convention are listed below and fixed when they are
 * touched. The lists only shrink: a listed file that now complies fails the
 * test, so the entry is removed with the fix.
 *
 * @module test/spa/ScreenConventions
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

/** Screens that still write their back link by hand. */
const HAND_WRITTEN_BACK_LINKS = [
  'spa/modules/TabbedPage.js',
  'spa/modules/account-info.js',
  'spa/modules/activities/Activities.js',
  'spa/modules/meetings/MeetingPrep.js',
  'spa/modules/scout-year/ScoutYearTransition.js',
  'spa/modules/unit-settings/unit-settings.js',
  'spa/modules/yearly-planner/YearlyPlanner.js',
];

/** Screens that still use the older `btn btn-*` classes: none are left; it stays empty. */
const OLD_BUTTON_CLASSES = [];

/** Screens that still give a button a variant without its `button` base class. */
const VARIANTS_WITHOUT_BASE = [
  'spa/modules/participants/ManageUsersParticipants.js',
];

const HAND_WRITTEN_BACK_LINK = /button--ghost[^>]*>\s*←/;
// A `btn` token inside a class attribute; hook classes such as `edit-offer-btn` are not styling.
const OLD_BUTTON_CLASS = /class="[^"]*(?<![\w-])btn(?:-(?:primary|secondary|danger|sm|small|lg|link|icon|success)|--[\w$]+)?(?![\w-])/;
// Unprefixed modifiers (`button primary`) style nothing; the variants are `button--*`.
const UNPREFIXED_MODIFIER = /class="button(?:\s+[^"\s]+)*\s+(?:primary|secondary|danger|small)(?=[\s"])/;
// The `*-button` and `*-btn` families (`ghost-button`, `primary-btn`) predate the `button` classes.
const OLDER_BUTTON_FAMILY = /class="[^"]*(?<![\w-])(?:primary|secondary|ghost|danger)-(?:button|btn)(?![\w-])/;
// A variant without its base class: the base rule is what styles a link as a button.
const VARIANT_WITHOUT_BASE = /class="(?![^"]*(?<![\w-])button(?![\w-]))[^"$]*(?<![\w-])button--/;

/**
 * @param {string} dir - Directory relative to the repository root
 * @returns {string[]} Every .js file below it, relative to the root
 */
function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      return jsFiles(relative);
    }
    return entry.name.endsWith('.js') ? [relative] : [];
  });
}

const SCREENS = jsFiles('spa/modules');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test.each(SCREENS.filter((file) => !HAND_WRITTEN_BACK_LINKS.includes(file)))(
  '%s opens with the shared back link, not one written by hand',
  (file) => {
    expect(source(file)).not.toMatch(HAND_WRITTEN_BACK_LINK);
  },
);

test.each(SCREENS.filter((file) => !OLD_BUTTON_CLASSES.includes(file)))(
  '%s styles its buttons with the button classes',
  (file) => {
    expect(source(file)).not.toMatch(OLD_BUTTON_CLASS);
    expect(source(file)).not.toMatch(UNPREFIXED_MODIFIER);
    expect(source(file)).not.toMatch(OLDER_BUTTON_FAMILY);
  },
);

test.each(SCREENS.filter((file) => !VARIANTS_WITHOUT_BASE.includes(file)))(
  '%s gives every button variant its base class',
  (file) => {
    expect(source(file)).not.toMatch(VARIANT_WITHOUT_BASE);
  },
);

test('the lists of older screens only shrink: a screen brought into line leaves them', () => {
  const stillHandWritten = HAND_WRITTEN_BACK_LINKS.filter((file) => HAND_WRITTEN_BACK_LINK.test(source(file)));
  const stillOldButtons = OLD_BUTTON_CLASSES.filter((file) => OLD_BUTTON_CLASS.test(source(file)));

  expect(stillHandWritten).toEqual(HAND_WRITTEN_BACK_LINKS);
  expect(stillOldButtons).toEqual(OLD_BUTTON_CLASSES);
  expect(VARIANTS_WITHOUT_BASE.filter((file) => VARIANT_WITHOUT_BASE.test(source(file)))).toEqual(VARIANTS_WITHOUT_BASE);
});

test('every button variant a screen uses has a rule in the shared stylesheet', () => {
  const styles = source('css/styles.css');
  for (const variant of ['primary', 'secondary', 'danger', 'ghost', 'small', 'success', 'icon']) {
    expect(styles).toMatch(new RegExp(`\\.button--${variant}\\b`));
  }
  // The base rule reaches links styled as buttons, not only <button> elements.
  expect(styles).toMatch(/\.btn,\n\.button \{\n {2}display: inline-flex;/);
});
