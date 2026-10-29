/**
 * WCAG 2.2 AA in a real browser, for the screens a parent, a leader and an
 * admin use, at phone and desktop size: axe (contrast included), no sideways
 * scroll, titles, the skip link, focus after navigation, visible and
 * unobscured focus, and a dialog driven from the keyboard.
 */
import { test, expect } from '@playwright/test';
import { ACCOUNTS, APP_NAME, storageStateFor, openScreen, settleScreen, axeViolations, waitForAnimations,seededActivityId, seededParticipantId, seededProgrammeDate, seededRecord } from './helpers.mjs';

/**
 * Screens each person reaches from their dashboard or from an emailed link.
 * Paths are canonical (no redirects); a query names a tab or the record a
 * screen opens on.
 */
const SCREENS = {
  public: [
    '/login', '/register', '/reset-password',
    // Opened from emails. Without a token each shows its "invalid link" state.
    '/alumni-consent', '/alumni-unsubscribe', '/reactivate-account', '/complete-registration', '/family-link',
    `/permission-slip/${seededRecord('slipToken')}`,
  ],
  parent: [
    '/personal-equipment', `/personal-equipment/${seededRecord('campMeetingId')}`,
    '/parent-dashboard', '/parent-finance', '/parent-fundraisers', '/family-access',
    '/messages', '/account-info', '/parent-program-progress', '/activities',
    '/parent-onboarding', `/messages/${seededRecord('messageId')}`,
    `/medication-authorizations/${seededParticipantId()}`,
  ],
  leader: [
    '/dashboard', '/attendance', '/manage-points', '/progression', '/walk-in-children', '/display-settings',
    '/activities', '/manageHonors', '/reunions',
    '/progression?tab=programme', '/reunions?tab=preparation',
  ],
  admin: [
    '/dashboard', '/manage-participants', '/invitations',
    '/unit-settings', '/roles', '/finance', '/budgets', '/expenses', '/reports',
    `/personal-equipment/${seededRecord('campMeetingId')}/manage`,
    '/tasks', '/messages', '/yearly-planner', '/medication-management', '/material', '/material?tab=articles', '/permission-slips',
    `/permission-slips/${seededActivityId()}`,
    '/carpool', '/form-builder', '/manage-groups', '/mailing-list', '/communication-history',
    '/incident-reports', '/scout-year', '/participant-duplicates', '/fundraisers', '/resources',
    '/external-revenue', '/revenue-dashboard', '/roles?tab=formulaires', '/district',
    '/parent-contact-list', '/view-participant-documents', '/account-info',
    '/time-since-registration', '/formulaire-inscription', `/carpool/${seededActivityId()}`,
    '/material-management', '/equipment-loans',
    '/medication-dispensing', '/medication-reception',
    '/create-organization', '/units',
    `/badge-form/${seededParticipantId()}`,
    '/prepare-offline', '/communications',
    '/main-dashboard', '/manage-users-participants', '/group-participant-report',
    `/guardian-management?participant_id=${seededParticipantId()}&participant_name=Lea`,
    '/district?tab=outils', '/district?tab=roles', '/roles?tab=permissions',
    '/incident-reports/new',
    `/incident-reports/${seededRecord('incidentId')}`,
    `/incident-reports/${seededRecord('incidentId')}/edit`,
    `/medication-planning/${seededParticipantId()}`,
    `/medication-authorizations/${seededParticipantId()}`,
    `/preparation-reunions/${seededProgrammeDate()}`,
    `/yearly-planner/${seededRecord('yearPlanId')}`,
    '/yearly-planner/starter-activities',
    `/camp-material/${seededRecord('campMeetingId')}`,
    `/camp-readiness/${seededRecord('campMeetingId')}`,
    `/camp-lots/${seededRecord('campMeetingId')}`,
    `/my-camp-lots/${seededRecord('campMeetingId')}`,
    `/calendars/${seededRecord('fundraiserId')}`,
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

        const expected = new URL(target, page.url());
        const reached = new URL(page.url());
        expect(reached.pathname, 'the screen is reachable, not redirected').toBe(expected.pathname);
        for (const [name, value] of expected.searchParams) {
          expect(reached.searchParams.get(name), `the screen keeps ?${name}`).toBe(value);
        }
        // A 404 or 403 page passes axe too: the screen itself must be what was audited.
        await expect(page.locator('#app .not-found-state'), 'the screen opens, not a 404 or 403 page').toHaveCount(0);

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

    test('when the app cannot start, it says so in French with a reload button, and meets WCAG 2.2 AA', async ({ page }) => {
      // The worst start: the unit cannot be found and no translation arrives.
      await page.route(/\/lang\/|\/api\/v1\/.*organization/, (route) => route.fulfill({ status: 503, body: '{}' }));
      await page.goto('/login');

      await expect(page.locator('#app h1')).toHaveText('Erreur d’application');
      await expect(page.locator('#app [role="alert"]')).toContainText('Un problème est survenu');
      await expect(page).toHaveTitle(`Erreur d’application - ${APP_NAME}`);
      expect(await page.locator('#app').innerText()).not.toMatch(/\b[a-z]+(?:_[a-z]+)+\b/);
      expect(await axeViolations(page)).toEqual([]);

      await page.locator('body').focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Recharger' })).toBeFocused();
    });

    test('the skip link stays readable under the mouse', async ({ page }) => {
      await openScreen(page, '/login');
      await page.locator('body').focus();
      await page.keyboard.press('Tab');
      await page.locator('.skip-link').hover();
      expect(await axeViolations(page)).toEqual([]);
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

    test('the dashboard and attendance screens each name themselves with one <h1>, where focus lands', async ({ page }) => {
      await openScreen(page, '/dashboard');
      await expect(page.locator('#app h1')).toHaveCount(1);
      await page.locator('#app a[href="/attendance"]').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/attendance');
      await settleScreen(page);

      const heading = page.locator('#app h1');
      await expect(heading).toHaveCount(1);
      await expect(heading).toBeFocused();
      await expect(page).toHaveTitle(`${(await heading.innerText()).trim()} - ${APP_NAME}`);
    });

    test('focus is visible and never hidden while tabbing through the dashboard', async ({ page }) => {
      await openScreen(page, '/dashboard');
      expect(await focusProblemsWhileTabbing(page, 15)).toEqual([]);
    });

    test('the display tile opens the theme choice, which the arrow keys change', async ({ page }) => {
      await openScreen(page, '/dashboard');
      await page.locator('#app a[href="/display-settings"]').first().focus();
      await page.keyboard.press('Enter');
      await page.waitForURL('**/display-settings');
      await settleScreen(page);

      const checked = page.locator('input[name="display_palette"]:checked');
      const before = await checked.getAttribute('value');
      await checked.focus();
      await page.keyboard.press('ArrowDown');
      await expect(checked).not.toHaveAttribute('value', before);
      await expect(page.locator('#display-settings-status')).not.toBeEmpty();
      expect(await axeViolations(page)).toEqual([]);
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

test.describe('calendar subscription', () => {
  // One link per account: the two sizes run at once, so each uses its own
  // account (a parent on desktop, an admin on the phone) and neither revokes
  // the other's link.
  test('from Activities, a member creates a link, and the link serves the unit\'s calendar until turned off', async ({ browser }, testInfo) => {
    const account = testInfo.project.name === 'phone' ? ACCOUNTS.admin : ACCOUNTS.parent;
    const context = await browser.newContext({ ...testInfo.project.use, storageState: storageStateFor(account) });
    const page = await context.newPage();
    await openScreen(page, '/activities');
    await page.locator('#app a[href="/account-info#calendar-feed"]').click();
    await page.waitForURL('**/account-info#calendar-feed');
    await settleScreen(page);
    const section = page.locator('#calendar-feed');
    await expect(section.locator('h2')).toBeFocused();

    // A link made by an earlier run would be replaced after a confirmation.
    const turnOff = section.locator('[data-calendar-feed="revoke"]');
    if (await turnOff.count()) {
      await turnOff.click();
      await page.getByRole('alertdialog').getByRole('button', { name: /désactiver/i }).click();
      await expect(section.locator('[data-calendar-feed="create"]')).toBeVisible();
    }

    await section.locator('[data-calendar-feed="create"]').click();
    const field = page.locator('#calendar-feed-url');
    await expect(field).toBeFocused();
    expect(await axeViolations(page)).toEqual([]);

    const feedPath = new URL(await field.inputValue()).pathname;
    const feed = await page.request.get(feedPath);
    expect(feed.status()).toBe(200);
    expect(feed.headers()['content-type']).toMatch(/^text\/calendar/);
    expect(await feed.text()).toContain('SUMMARY:Sortie canot');

    await section.locator('[data-calendar-feed="revoke"]').click();
    await page.getByRole('alertdialog').getByRole('button', { name: /désactiver/i }).click();
    await expect(section.locator('[data-calendar-feed="create"]')).toBeVisible();
    expect((await page.request.get(feedPath)).status()).toBe(404);
    await context.close();
  });
});

test.describe('the leaders\' programme bar', () => {
  test.use({ storageState: storageStateFor(ACCOUNTS.leader) });

  test('during a planned meeting it says what is on and what is next, never hides a focused control, and opens the day', async ({ page }) => {
    // seed.mjs plans tomorrow's meeting from 18:45; the page's clock is set inside it.
    const [year, month, day] = seededProgrammeDate().split('-').map(Number);
    await page.clock.install({ time: new Date(year, month - 1, day, 19, 13) });
    await openScreen(page, '/dashboard');

    const bar = page.getByRole('complementary', { name: 'Programme en cours' });
    await expect(bar).toContainText('Jeu de la tanière');
    await expect(bar).toContainText('12 min');
    await expect(bar).toContainText('Histoire de la jungle · Akela');
    expect(await axeViolations(page)).toEqual([]);

    // At the very end of the page, its last control, focused, sits above the
    // bar: the page keeps room for it (WCAG 2.4.11).
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    const last = page.locator('#app a[href]:visible, #app button:visible').last();
    await last.focus();
    const barTop = (await bar.boundingBox()).y;
    await expect.poll(async () => {
      const box = await last.boundingBox();
      return box.y + box.height;
    }).toBeLessThanOrEqual(barTop);

    const open = bar.getByRole('button');
    await open.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Programme de la réunion');
    await expect(dialog).toContainText('Matériel : Foulards, 4 cônes');
    // Contrast is measured once the dialog has finished fading in.
    await waitForAnimations(page);
    expect(await axeViolations(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    // At 19:25 the bar moves on by itself.
    await page.clock.runFor(12 * 60 * 1000);
    await expect(bar).toContainText('Histoire de la jungle');
    await expect(bar).toContainText('20 min');
  });
});

test.describe('task assignment', () => {
  signedInAs('admin');

  test('material reminder settings are accessible and keep keyboard focus', async ({ page }, testInfo) => {
    await openScreen(page, '/tasks');
    const opener = page.locator('[data-equipment-reminder]').first();
    await opener.click();
    await expect(page.locator('#equipment-reminder-materials')).toBeVisible();
    await waitForAnimations(page);
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('material-reminder.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('the task form is accessible on phones and returns focus after Escape', async ({ page }) => {
    await openScreen(page, '/tasks');
    await expect(page.getByRole('heading', { name: 'Vérifier les pagaies' })).toBeVisible();
    const opener = page.locator('#tasks-create');
    await opener.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#tasks-title')).toBeVisible();
    // Contrast is measured once the dialog has finished fading in.
    await waitForAnimations(page);
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});


test.describe('personal packing lists', () => {
  signedInAs('parent');
  test('a parent keeps checkmarks on reload without sending them to the server', async ({ page }, testInfo) => {
    const writes = [];
    page.on('request', (request) => {
      if (request.url().includes('/personal-equipment/') && !['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); }
    });
    await openScreen(page, `/personal-equipment/${seededRecord('campMeetingId')}`);
    await expect(page.locator('#personal-translate')).toHaveCount(0);
    await expect(page.locator('#packing-translate-all')).toHaveCount(0);
    const checkbox = page.locator('input[data-child]').first();
    await checkbox.check();
    await page.reload(); await settleScreen(page);
    await expect(page.locator('input[data-child]').first()).toBeChecked();
    expect(writes).toEqual([]);
    expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('material-personal-family.png'), fullPage: true });
  });
  test('parents cannot spend AI through either the packing or general endpoint', async ({ page }) => {
    await openScreen(page, `/personal-equipment/${seededRecord('campMeetingId')}`);
    const statuses = await page.evaluate(async (meetingId) => {
      const packing = await import('/spa/api/api-personal-equipment.js');
      const ai = await import('/spa/api/api-ai.js');
      const status = async (call) => { try { await call(); return 200; } catch (error) { return error.status; } };
      return [await status(() => packing.translatePersonalEquipment(meetingId, 'es')),
        await status(() => ai.aiGenerateText('translate', { text: 'Fictional common instructions', targetLocale: 'es' }))];
    }, seededRecord('campMeetingId'));
    expect(statuses).toEqual([403, 403]);
  });

});

test.describe('preparing personal packing lists', () => {
  signedInAs('admin');
  test('multiline additions become editable effects before publication', async ({ page }, testInfo) => {
    await openScreen(page, `/personal-equipment/${seededRecord('campMeetingId')}/manage`);
    await page.locator('.packing-bulk > summary').click();
    await page.locator('#personal-bulk').fill('Sac étanche\nTuque de rechange');
    await page.locator('#personal-add-bulk').click();
    await expect(page.locator('[data-item-key]')).toHaveCount(4);
    await expect(page.locator('.packing-items-table')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('material-personal-editor.png'), fullPage: true });
  });
});
