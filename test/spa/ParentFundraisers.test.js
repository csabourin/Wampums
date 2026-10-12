/**
 * @jest-environment jsdom
 */

/**
 * The parent fundraisers screen.
 *
 * The parent dashboard's "finances and fundraisers" button sent people back to
 * a dashboard. It now opens this page, which has to answer, for each of the
 * family's children, what they received, what was handed in and what is left
 * -- for a calendar sale at 10 $ where each child received 12, that is 120 $.
 *
 * The page is held to WCAG 2.2 AA in every state it can render: axe finds no
 * violation, each state is named by role, focus lands on the title once the
 * page settles, and everything operable is reached with Tab in reading order.
 *
 * @module test/spa/ParentFundraisers
 */

import fs from 'fs';
import path from 'path';
import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

jest.mock('../../spa/config.js', () => ({
  CONFIG: { DEFAULT_LANG: 'fr', DEFAULT_CURRENCY: 'CAD' },
}));

jest.mock('../../spa/utils/DOMUtils.js', () => {
  const actual = jest.requireActual('../../spa/utils/DOMUtils.js');
  return { ...actual, loadStylesheet: jest.fn(() => Promise.resolve()) };
});

const mockHeld = new Set();
jest.mock('../../spa/utils/PermissionUtils.js', () => ({
  canViewFundraisers: () => mockHeld.has('fundraisers.view'),
}));

jest.mock('../../spa/api/api-family.js', () => ({
  getFamilyFundraisers: jest.fn(),
}));

import { getFamilyFundraisers } from '../../spa/api/api-family.js';
import { getTodayISO } from '../../spa/utils/DateUtils.js';
import { formatCurrency } from '../../spa/utils/NumberUtils.js';
import {
  ParentFundraisers,
  campaignStatus,
  childStatus,
} from '../../spa/modules/fundraising/ParentFundraisers.js';
import en from '../../lang/en.json';
import fr from '../../lang/fr.json';

const ROOT = path.join(__dirname, '../..');
const DAY_MS = 24 * 60 * 60 * 1000;

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom does no layout, so contrast cannot be computed here. The ratios are
  // recorded in css/parent-fundraisers.css and checked in a real browser.
  rules: { 'color-contrast': { enabled: false } },
};

/**
 * A date some days from today, as the API sends it.
 *
 * @param {number} days - Offset from today; negative is the past
 * @returns {string} `YYYY-MM-DD`
 */
function dayFromToday(days) {
  return new Date(Date.now() + (days * DAY_MS)).toLocaleDateString('en-CA');
}

/**
 * An amount as the page writes it in French, with ordinary spaces.
 *
 * @param {number} amount - Amount of money
 * @returns {string} For example `120,00 $`, with the currency suffix of the locale
 */
function money(amount) {
  return formatCurrency(amount, 'fr').replace(/\s/g, ' ');
}

/**
 * One child's entry.
 *
 * @param {Object} [overrides] - Fields to change
 * @returns {Object} Entry as the API sends it
 */
function childEntry(overrides = {}) {
  return {
    participant_id: 4,
    first_name: 'Léa',
    last_name: 'Parent',
    quantity: 12,
    hours: null,
    amount_due: 120,
    amount_paid: 40,
    balance: 80,
    paid: false,
    ...overrides,
  };
}

/**
 * The calendar sale: 10 $ each, twelve per child.
 *
 * @param {Object} [overrides] - Fields to change
 * @returns {Object} Campaign as the API sends it
 */
function calendarSale(overrides = {}) {
  return {
    id: 1,
    name: 'Vente de calendriers',
    start_date: dayFromToday(-10),
    end_date: dayFromToday(30),
    campaign_type: 'fixed_price_sale',
    unit_price: 10,
    unit_label: 'calendriers',
    unit_progress: { objective: 600, collected: 220 },
    children: [
      childEntry(),
      childEntry({ participant_id: 5, first_name: 'Théo', amount_paid: 120, balance: 0, paid: true }),
    ],
    ...overrides,
  };
}

/**
 * Open the page over an API answer.
 *
 * @param {Object|Error} answer - `data` of the response, or the error it throws
 * @returns {Promise<ParentFundraisers>} The page, settled
 */
async function openPage(answer) {
  if (answer instanceof Error) {
    getFamilyFundraisers.mockRejectedValue(answer);
  } else {
    getFamilyFundraisers.mockResolvedValue({ success: true, data: answer });
  }
  const page = new ParentFundraisers({ lang: 'fr' });
  await page.init();
  return page;
}

/**
 * The figures of one child's block, by label.
 *
 * @param {Element} block - The child's section
 * @returns {Object<string, string>} Label key to displayed value
 */
function figures(block) {
  return Object.fromEntries([...block.querySelectorAll('dt')].map((term) => [
    term.textContent.trim(),
    term.nextElementSibling.textContent.replace(/\s/g, ' ').trim(),
  ]));
}

/**
 * The elements Tab stops on, in order.
 *
 * @returns {Array<Element>} Tabbable elements
 */
function tabStops() {
  return [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter((element) => !element.disabled && element.getAttribute('tabindex') !== '-1');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockHeld.clear();
  document.body.innerHTML = '<main id="app"></main>';
});

describe('where a campaign and a child stand', () => {
  test('a campaign is under way from its first day through its last', () => {
    const campaign = { start_date: '2026-10-01', end_date: '2026-11-15' };

    expect(campaignStatus(campaign, '2026-09-30')).toBe('upcoming');
    expect(campaignStatus(campaign, '2026-10-01')).toBe('active');
    expect(campaignStatus(campaign, '2026-11-15')).toBe('active');
    expect(campaignStatus(campaign, '2026-11-16')).toBe('ended');
    expect(campaignStatus({ start_date: null, end_date: null }, '2026-10-01')).toBe('active');
  });

  test('today is the reader\'s own day', () => {
    expect(campaignStatus({ start_date: getTodayISO(), end_date: getTodayISO() })).toBe('active');
  });

  test('a child owes, has handed everything in, or has nothing to hand in', () => {
    expect(childStatus({ amount_due: 120, amount_paid: 40, balance: 80 })).toBe('owing');
    expect(childStatus({ amount_due: 120, amount_paid: 120, balance: 0 })).toBe('paid');
    expect(childStatus({ amount_due: 0, amount_paid: 0, balance: 0 })).toBe('none');
  });
});

describe('the calendar sale', () => {
  test('twelve calendars at 10 $ show as 120 $, with what was handed in and what is left', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    const campaign = document.querySelector('article');
    expect(campaign.querySelector('h2').textContent).toBe('Vente de calendriers');
    expect(campaign.textContent).toContain('parent_fundraisers_status_active');

    const [lea, theo] = campaign.querySelectorAll('.parent-fundraisers__child');
    expect(lea.querySelector('h3').textContent).toBe('Léa Parent');
    expect(figures(lea)).toEqual({
      quantity: '12 calendriers',
      parent_fundraisers_amount_due: money(120),
      parent_fundraisers_amount_paid: money(40),
      parent_fundraisers_balance: money(80),
    });
    expect(money(120)).toMatch(/^120,00 \$/);
    expect(lea.textContent).toContain('parent_fundraisers_child_owing');
    expect(figures(theo).parent_fundraisers_balance).toBe(money(0));
    expect(theo.textContent).toContain('parent_fundraisers_child_paid');
  });

  test('the family\'s total adds every child and every campaign', async () => {
    await openPage({
      campaigns: [
        calendarSale(),
        calendarSale({ id: 2, name: 'Bouteilles', children: [childEntry({ amount_due: 35, amount_paid: 20, balance: 15 })] }),
      ],
      children_count: 2,
    });

    const total = document.querySelector('.parent-fundraisers__total');
    expect(total.textContent.replace(/\s/g, ' ')).toContain(money(95));
  });

  test('the unit\'s progress is a named progress bar, capped at its objective', async () => {
    await openPage({
      campaigns: [calendarSale({ unit_progress: { objective: 600, collected: 750 } })],
      children_count: 2,
    });

    const bar = document.querySelector('progress');
    expect(bar.labels[0].textContent).toBe('parent_fundraisers_unit_objective');
    expect(bar.max).toBe(600);
    expect(bar.value).toBe(600);
  });

  test('no progress bar without an objective, and no unit price when the campaign has none', async () => {
    await openPage({
      campaigns: [calendarSale({ unit_progress: null, campaign_type: 'donation', unit_price: null, unit_label: null })],
      children_count: 2,
    });

    expect(document.querySelector('progress')).toBeNull();
    expect(document.querySelector('article').textContent).not.toContain('parent_fundraisers_unit_price');
    // A donation campaign records money, not units.
    expect(figures(document.querySelector('.parent-fundraisers__child')).quantity).toBeUndefined();
  });

  test('a child with nothing recorded is one line, not a column of zeros', async () => {
    await openPage({
      campaigns: [calendarSale({ children: [childEntry({ quantity: 0, amount_due: 0, amount_paid: 0, balance: 0 })] })],
      children_count: 1,
    });

    const child = document.querySelector('.parent-fundraisers__child');
    expect(child.textContent).toContain('parent_fundraisers_child_none');
    expect(child.querySelector('dl')).toBeNull();
  });

  test('what needs attention comes first: under way, then ended and owed, then upcoming', async () => {
    await openPage({
      campaigns: [
        calendarSale({ id: 3, name: 'Sapins', start_date: dayFromToday(20), end_date: dayFromToday(40), children: [] }),
        calendarSale({ id: 2, name: 'Bouteilles', start_date: dayFromToday(-60), end_date: dayFromToday(-5) }),
        calendarSale({ id: 1 }),
      ],
      children_count: 2,
    });

    expect([...document.querySelectorAll('h2')].map((title) => title.textContent))
      .toEqual(['Vente de calendriers', 'Bouteilles', 'Sapins']);
    expect([...document.querySelectorAll('article > .parent-fundraisers__row > span')].map((pill) => pill.textContent))
      .toEqual([
        'parent_fundraisers_status_active',
        'parent_fundraisers_status_ended',
        'parent_fundraisers_status_upcoming',
      ]);
  });

  test('names typed by people are shown as text, never as markup', async () => {
    await openPage({
      campaigns: [calendarSale({
        name: '<img src=x onerror=alert(1)>',
        unit_label: '<b>calendriers</b>',
        children: [childEntry({ first_name: '<script>alert(1)</script>' })],
      })],
      children_count: 1,
    });

    expect(document.querySelector('article img, article script, article b')).toBeNull();
    expect(document.querySelector('h2').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('what the page says when there is little to show', () => {
  test('no campaign under way', async () => {
    await openPage({ campaigns: [], children_count: 2 });

    expect(document.querySelector('.empty-state').textContent).toBe('parent_fundraisers_empty');
    expect(document.querySelector('.parent-fundraisers__total')).toBeNull();
  });

  test('a campaign with nothing recorded for the family\'s children', async () => {
    await openPage({ campaigns: [calendarSale({ children: [] })], children_count: 2 });

    expect(document.querySelector('.parent-fundraisers__note').textContent).toBe('parent_fundraisers_no_entry');
  });

  test('an account with no child in the unit is told so, once', async () => {
    await openPage({
      campaigns: [calendarSale({ children: [] }), calendarSale({ id: 2, children: [] })],
      children_count: 0,
    });

    const notes = [...document.querySelectorAll('.parent-fundraisers__note')];
    expect(notes.map((note) => note.textContent)).toEqual(['parent_fundraisers_no_children']);
    expect(notes[0].closest('article')).toBeNull();
  });

  test('only staff are offered the unit-wide campaign screens', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });
    expect(document.querySelector('a[href="/fundraisers"]')).toBeNull();

    mockHeld.add('fundraisers.view');
    await openPage({ campaigns: [calendarSale()], children_count: 2 });
    expect(document.querySelector('a[href="/fundraisers"]').textContent).toBe('tile_fundraisers');
  });
});

describe('accessibility (WCAG 2.2 AA)', () => {
  const STATES = {
    'campaigns with every kind of child': () => openPage({
      campaigns: [
        calendarSale(),
        calendarSale({
          id: 2,
          name: 'Emballage',
          campaign_type: 'hours_worked',
          unit_price: 5,
          unit_label: null,
          unit_progress: null,
          children: [childEntry({ quantity: null, hours: 3, amount_due: 15, amount_paid: 0, balance: 15 })],
        }),
        calendarSale({ id: 3, name: 'Sapins', children: [childEntry({ quantity: 0, amount_due: 0, amount_paid: 0, balance: 0 })] }),
        calendarSale({ id: 4, name: 'Dons', children: [] }),
      ],
      children_count: 2,
    }),
    'no campaign': () => openPage({ campaigns: [], children_count: 0 }),
    'the request failed': () => openPage(new Error('offline')),
  };

  test.each(Object.keys(STATES))('no violation: %s', async (state) => {
    mockHeld.add('fundraisers.view');
    await STATES[state]();

    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('no violation while loading, and the wait is announced', async () => {
    getFamilyFundraisers.mockReturnValue(new Promise(() => {}));
    new ParentFundraisers({ lang: 'fr' }).init();

    const section = document.querySelector('.parent-fundraisers');
    expect(section.getAttribute('aria-busy')).toBe('true');
    expect(section.querySelector('[role="status"]').textContent).toBe('loading');
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('headings go title, campaign, child without skipping a level', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => heading.tagName);
    expect(levels).toEqual(['H1', 'H2', 'H3', 'H3']);
  });

  test('each campaign and each child is a region named by its heading', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    const named = [...document.querySelectorAll('article, .parent-fundraisers__child')];
    expect(named).toHaveLength(3);
    named.forEach((region) => {
      const heading = document.getElementById(region.getAttribute('aria-labelledby'));
      expect(region.contains(heading)).toBe(true);
      expect(heading.textContent.trim()).not.toBe('');
    });
    // Two children in one campaign must not share an id.
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('a state is never carried by color alone: every pill has its own words', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    const pills = [...document.querySelectorAll('.parent-fundraisers__pill')];
    expect(pills).toHaveLength(3);
    pills.forEach((pill) => expect(pill.textContent.trim()).toMatch(/^parent_fundraisers_(status|child)_/));
  });

  test('focus lands on the page title once the page has settled', async () => {
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    const title = document.querySelector('h1');
    expect(document.activeElement).toBe(title);
    expect(title.textContent).toBe('parent_fundraisers_title');
    // Focusable by script, but not an extra Tab stop.
    expect(title.getAttribute('tabindex')).toBe('-1');
  });

  test('Tab reaches the way back first, then the staff link; nothing else stops it', async () => {
    mockHeld.add('fundraisers.view');
    await openPage({ campaigns: [calendarSale()], children_count: 2 });

    expect(tabStops().map((element) => element.getAttribute('href'))).toEqual(['/parent-dashboard', '/fundraisers']);
    expect(document.querySelector('.parent-fundraisers').firstElementChild.getAttribute('href')).toBe('/parent-dashboard');
  });

  test('a failed load is announced, and the retry is a real button that keeps focus on the page', async () => {
    await openPage(new Error('offline'));

    expect(document.querySelector('[role="alert"]').textContent).toBe('error_loading_data');
    expect(document.activeElement).toBe(document.querySelector('h1'));

    const retry = document.getElementById('parent-fundraisers-retry');
    // A native button: Enter and Space activate it without any script.
    expect(retry.tagName).toBe('BUTTON');
    expect(retry.type).toBe('button');
    expect(tabStops()).toEqual([document.querySelector('a[href="/parent-dashboard"]'), retry]);

    getFamilyFundraisers.mockResolvedValue({ success: true, data: { campaigns: [calendarSale()], children_count: 2 } });
    retry.focus();
    retry.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelectorAll('article')).toHaveLength(1);
    // The retry button is gone; focus did not fall back to the document.
    expect(document.activeElement).toBe(document.querySelector('h1'));
  });
});

describe('how the page is reached', () => {
  const routerSource = fs.readFileSync(path.join(ROOT, 'spa/router.js'), 'utf8');
  const dashboardSource = fs.readFileSync(path.join(ROOT, 'spa/parent_dashboard.js'), 'utf8');

  test('the route exists and opens for the accounts that reach the parent dashboard', () => {
    expect(routerSource).toContain("'/parent-fundraisers': 'parentFundraisers'");
    expect(routerSource).toMatch(/case 'parentFundraisers':[^}]*if \(!guard\(canAccessParentTools\(\)\)\)/);
    expect(routerSource).toContain("import('./modules/fundraising/ParentFundraisers.js')");
  });

  test('a signed-out visitor is sent to sign in', () => {
    const match = /if \(!this\.app\.isLoggedIn && !\[([^\]]+)\]\.includes\(routeName\)\)/.exec(routerSource);
    expect(match[1]).not.toContain('parentFundraisers');
  });

  test('the parent dashboard no longer links back to a dashboard', () => {
    expect(dashboardSource).toContain('href="/parent-fundraisers"');
    expect(dashboardSource).not.toContain('/main-dashboard');
  });

  test('every text of the page exists in French and in English', () => {
    const source = fs.readFileSync(path.join(ROOT, 'spa/modules/fundraising/ParentFundraisers.js'), 'utf8');
    const keys = new Set([...source.matchAll(/translate\(\s*'([\w.]+)'/g)].map((match) => match[1]));
    ['active', 'upcoming', 'ended'].forEach((status) => keys.add(`parent_fundraisers_status_${status}`));
    ['owing', 'paid', 'none'].forEach((status) => keys.add(`parent_fundraisers_child_${status}`));

    expect(keys.size).toBeGreaterThan(15);
    keys.forEach((key) => {
      expect(fr[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    });
  });
});
