/**
 * WCAG 2.2 AA in a real browser, for the screens a parent, a leader and an
 * admin use, at phone and desktop size: axe (contrast included), no sideways
 * scroll, titles, the skip link, focus after navigation, visible and
 * unobscured focus, and a dialog driven from the keyboard.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, APP_NAME, storageStateFor, openScreen, settleScreen, axeViolations, seededActivityId, seededParticipantId } from './helpers.mjs';

/** Screens each person reaches from their dashboard. Paths are canonical (no redirects). */
const SCREENS = {
  public: ['/login', '/register', '/reset-password'],
  parent: [
    '/parent-dashboard', '/parent-finance', '/parent-fundraisers', '/family-access',
    '/messages', '/account-info', '/parent-program-progress', '/activities',
  ],
  leader: [
    '/dashboard', '/attendance', '/manage-points', '/progression', '/walk-in-children',
    '/activities', '/manage-honors', '/reunions',
  ],
  admin: [
    '/dashboard', '/manage-participants', '/parent-invitations', '/leader-invitations',
    '/unit-settings', '/role-management', '/finance', '/budgets', '/expenses', '/reports',
    '/messages', '/yearly-planner', '/medication-management', '/inventory', '/permission-slips',
    `/permission-slips/${seededActivityId()}`,
    '/carpool', '/form-builder', '/manage-groups', '/mailing-list', '/communication-history',
    '/incident-reports', '/scout-year', '/participant-duplicates', '/fundraisers', '/resources',
    '/external-revenue', '/revenue-dashboard', '/form-permissions', '/district',
    '/parent-contact-list', '/view-participant-documents', '/account-info',
    '/time-since-registration', '/formulaire-inscription', `/carpool/${seededActivityId()}`,
    '/material-management',
    '/medication-dispensing', '/medication-reception',
    '/create-organization',
    `/badge-form/${seededParticipantId()}`,
  ],
};

/**
 * Violations that predate this suite: each rule lists the exact elements
 * (axe targets) that break it, so a new element breaking the same rule on the
 * same screen still fails. Fix an entry when you touch its screen
 * (CLAUDE.md §7) and delete it here. A listed element that no longer fails
 * fails the test, so this list only shrinks; it is empty now. The seeded unit
 * speaks French, so targets name French labels.
 */
const KNOWN_VIOLATIONS = {};

/** Screens that stay marked busy after loading, for the same reason. */
const KNOWN_STAYS_BUSY = {};

/**
 * @param {string} who - Key of SCREENS
 */
function signedInAs(who) {
  if (who !== 'public') {
    test.use({ storageState: storageStateFor(ACCOUNTS[who]) });
  }
}

for (const [who, paths] of Object.entries(SCREENS)) {
  test.describe(`${who} screens`, () => {
    signedInAs(who);

    for (const target of paths) {
      test(`${target} meets WCAG 2.2 AA for ${who}`, async ({ page }, testInfo) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        await openScreen(page, target);

        expect(new URL(page.url()).pathname, 'the screen is reachable, not redirected').toBe(target);

        const known = KNOWN_VIOLATIONS[target] || {};
        const violations = await axeViolations(page);
        const unexpected = violations
          .map((violation) => ({
            ...violation,
            targets: violation.targets.filter((element) => !known[violation.id]?.targets.includes(element)),
          }))
          .filter((violation) => violation.targets.length > 0);
        expect(unexpected, 'axe WCAG 2.2 A/AA violations').toEqual([]);
        const fixed = Object.entries(known).flatMap(([id, entry]) => entry.targets
          .filter((element) => !violations.some((violation) => violation.id === id && violation.targets.includes(element)))
          .map((element) => `${id} ${element}`));
        expect(fixed, 'fixed: remove these from KNOWN_VIOLATIONS').toEqual([]);

        const busy = await page.locator('#app [aria-busy="true"]').count();
        if (KNOWN_STAYS_BUSY[target]) {
          expect(busy, 'fixed: remove this screen from KNOWN_STAYS_BUSY').toBeGreaterThan(0);
        } else {
          expect(busy, 'nothing is still announced as loading').toBe(0);
        }

        const heading = page.locator('#app h1').first();
        if (await heading.count()) {
          const text = (await heading.innerText()).replace(/\s+/g, ' ').trim();
          await expect(page).toHaveTitle(`${text} - ${APP_NAME}`);
        } else {
          await expect(page).toHaveTitle(new RegExp(` - ${APP_NAME}$|^${APP_NAME}$`));
        }

        if (testInfo.project.name === 'phone') {
          const scrollsSideways = await page.evaluate(
            () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
          );
          expect(scrollsSideways, 'nothing scrolls the page sideways at 390px').toBe(false);
        }

        expect(pageErrors).toEqual([]);
      });
    }
  });
}

/**
 * Where the focused element is, whether focus changes how it is drawn, and
 * whether something else covers it (WCAG 2.4.7, 2.4.11). The indicator is
 * what differs between the focused and unfocused element, so a shadow the
 * element always has does not count as a focus ring.
 *
 * @param {import('@playwright/test').Page} page
 */
function describeFocus(page) {
  return page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    // Measure settled states: no transition on the ring, no scroll moving.
    const settle = async () => {
      await frame();
      // An endless animation (an urgent badge's pulse) never finishes: wait
      // only for those that end, such as the focus ring's transition.
      const ending = document.getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime));
      await Promise.all(ending.map((animation) => animation.finished.catch(() => {})));
      let previous = -1;
      while (previous !== window.scrollY) {
        previous = window.scrollY;
        // eslint-disable-next-line no-await-in-loop -- waits frame by frame until scrolling stops
        await frame();
      }
    };
    // The ring may be drawn by a pseudo-element (a stretched link's ::after).
    const ring = (element) => [null, '::before', '::after'].map((pseudo) => {
      const box = getComputedStyle(element, pseudo);
      const outline = box.outlineStyle !== 'none' && parseFloat(box.outlineWidth) > 0
        ? `${box.outlineStyle} ${box.outlineWidth} ${box.outlineColor} ${box.outlineOffset}` : '';
      const shadow = box.boxShadow && box.boxShadow !== 'none' ? box.boxShadow : '';
      return { outline, shadow };
    });

    await settle();
    const element = document.activeElement;
    if (!element || element === document.body) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const points = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + 2, rect.top + 2],
      [rect.right - 2, rect.bottom - 2],
    ].filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight);
    const unobscured = points.some(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return hit && (hit === element || element.contains(hit) || hit.contains(element));
    });

    const focused = ring(element);
    element.blur();
    await settle();
    const unfocused = ring(element);
    element.focus({ preventScroll: true });
    await settle();
    const indicator = focused.some((layer, index) => (layer.outline || layer.shadow)
      && (layer.outline !== unfocused[index].outline || layer.shadow !== unfocused[index].shadow));

    return {
      name: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''} "${(element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 40)}"`,
      indicator,
      unobscured,
    };
  });
}

/**
 * Press Tab `steps` times from the top of the page, and list every stop whose
 * focus is not visible or is covered.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} steps
 * @returns {Promise<Array<Object>>} Problems found
 */
async function focusProblemsWhileTabbing(page, steps) {
  await page.locator('body').focus();
  const problems = [];
  for (let step = 0; step < steps; step += 1) {
    // eslint-disable-next-line no-await-in-loop -- each key press moves on from the previous one
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop -- measured where that key press left focus
    const focus = await describeFocus(page);
    if (focus && (!focus.indicator || !focus.unobscured)) {
      problems.push(focus);
    }
  }
  return problems;
}

test.describe('keyboard', () => {
  test.describe('signed out', () => {
    test('focus is visible and never hidden while tabbing through the sign-in screen', async ({ page }) => {
      await openScreen(page, '/login');
      expect(await focusProblemsWhileTabbing(page, 8)).toEqual([]);
    });
  });

  test.describe('leader', () => {
    signedInAs('leader');

    test('the first Tab reaches the skip link, which leads to the screen heading', async ({ page }) => {
      await openScreen(page, '/activities');
      await page.locator('body').focus();
      await page.keyboard.press('Tab');

      const skip = page.locator('.skip-link');
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      const focus = await describeFocus(page);
      expect(focus.indicator).toBe(true);
      expect(focus.unobscured).toBe(true);

      await page.keyboard.press('Enter');
      await expect(page.locator('#app h1').first()).toBeFocused();
    });

    test('following a link puts focus on the new screen and names the tab after it', async ({ page }) => {
      await openScreen(page, '/dashboard');
      await page.locator('#app a[href="/activities"]').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/activities');
      await settleScreen(page);

      const heading = page.locator('#app h1').first();
      await expect(heading).toBeFocused();
      await expect(page).toHaveTitle(`${(await heading.innerText()).trim()} - ${APP_NAME}`);
    });

    test('focus is visible and never hidden while tabbing through the dashboard', async ({ page }) => {
      await openScreen(page, '/dashboard');
      expect(await focusProblemsWhileTabbing(page, 15)).toEqual([]);
    });

    test('the dashboard settings dialog keeps focus inside, closes with Escape, and returns focus', async ({ page }) => {
      await openScreen(page, '/dashboard');
      const opener = page.locator('#dashboard-settings-btn');
      await opener.focus();
      await page.keyboard.press('Enter');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(':focus')).toHaveCount(1);

      for (let step = 0; step < 25; step += 1) {
        // eslint-disable-next-line no-await-in-loop -- each key press moves on from the previous one
        await page.keyboard.press('Tab');
        // eslint-disable-next-line no-await-in-loop -- checked after every press
        await expect(dialog.locator(':focus'), 'Tab stays in the dialog').toHaveCount(1);
      }

      expect(await axeViolations(page)).toEqual([]);

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
    });
  });

  test.describe('parent', () => {
    signedInAs('parent');

    test('focus is visible and never hidden while tabbing through the parent dashboard', async ({ page }) => {
      await openScreen(page, '/parent-dashboard');
      expect(await focusProblemsWhileTabbing(page, 15)).toEqual([]);
    });
  });
});

test.describe('permission slips for a parent', () => {
  signedInAs('parent');

  test('the activities screen offers a parent no way into the unit\'s slip screen', async ({ page }) => {
    await openScreen(page, '/activities');
    await expect(page.getByText('Sortie canot').first()).toBeVisible();
    await expect(page.locator('.view-permission-slips-btn')).toHaveCount(0);
  });

  for (const target of ['/permission-slips', `/permission-slips/${seededActivityId()}`]) {
    test(`${target} tells a parent it is not for them, instead of a blank page`, async ({ page }) => {
      await openScreen(page, target);
      const heading = page.locator('#app h1');
      await expect(heading).toHaveCount(1);
      await expect(heading).not.toBeEmpty();
      await expect(page.locator('#app a').first()).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });
  }

  test('the parent dashboard still offers the pending slip to sign', async ({ page }) => {
    await openScreen(page, '/parent-dashboard');
    await expect(page.locator('.permission-slip-section .permission-slip-sign-btn').first()).toBeVisible();
  });
});
