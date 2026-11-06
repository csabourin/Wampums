/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: () => 'fictional-scope' }));
jest.mock('../../spa/api/api-camp-reviews.js', () => ({ getCampReviewHistory: jest.fn() }));
const { CampReviews } = require('../../spa/modules/camp-review/CampReviews');
const { getCampReviewHistory } = require('../../spa/api/api-camp-reviews');
const reply = (camps = [], more = false) => ({ data: { camps, sites: [{ id: 3, name: 'Forêt fictive', archived: true }] },
  pagination: { total: camps.length, hasNext: more, hasPrev: false } });
const CAMP = { id: 12, theme: '<img src=x onerror=alert(1)>', site_name: 'Forêt fictive', date_from: '2025-07-10', date_to: '2025-07-12', closed_at: '2025-07-13T12:00:00Z', keep_count: 1, fix_count: 2 };
let screen;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  getCampReviewHistory.mockReset().mockResolvedValue(reply([CAMP]));
  screen = new CampReviews({ lang: 'fr' });
});
afterEach(() => screen.destroy());

test('closed reviews show their source dates and escaped names, with labelled filters safe in archives', async () => {
  await screen.init();
  expect(document.querySelector('.camp-history h1').textContent).toBe('camp_history_title');
  expect(document.querySelector('.camp-history h3').textContent).toBe(CAMP.theme);
  expect(document.querySelector('.camp-history img')).toBeNull();
  expect(document.querySelector('a[href="/camp-review/12"]')).not.toBeNull();
  expect([...document.querySelectorAll('select,button')].every((el) => el.hasAttribute('data-archive-safe'))).toBe(true);
  expect((await axe.run(document.getElementById('app'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});

test('filtering and clearing use the selected site, season and accommodation without recreating the form', async () => {
  await screen.init();
  const form = document.getElementById('camp-history-filters');
  document.getElementById('camp-history-site').value = '3';
  document.getElementById('camp-history-season').value = 'winter';
  document.getElementById('camp-history-accommodation').value = 'cabin';
  form.requestSubmit();
  await flush();
  expect(getCampReviewHistory).toHaveBeenLastCalledWith({ site_id: '3', season: 'winter', accommodation: 'cabin', page: 1 });
  expect(document.getElementById('camp-history-filters')).toBe(form);
  form.reset(); await flush();
  expect(getCampReviewHistory).toHaveBeenLastCalledWith({ page: 1 });
});

test('the next page is requested explicitly and moves focus to the results heading', async () => {
  getCampReviewHistory.mockResolvedValue(reply([CAMP], true));
  await screen.init();
  document.querySelector('[data-history-page]').click(); await flush();
  expect(getCampReviewHistory).toHaveBeenLastCalledWith({ page: 2 });
  expect(document.activeElement).toBe(document.querySelector('#camp-history-results h2'));
});

test('an empty history and a failed read are different, and retry keeps the filters', async () => {
  getCampReviewHistory.mockResolvedValueOnce(reply());
  await screen.init();
  expect(document.getElementById('app').textContent).toContain('camp_history_empty');
  getCampReviewHistory.mockRejectedValueOnce(new Error('fictional failure'));
  document.getElementById('camp-history-filters').requestSubmit(); await flush();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  document.querySelector('[data-history-retry]').click(); await flush();
  expect(document.querySelector('a[href="/camp-review/12"]')).not.toBeNull();
});

test('an older filter response does not replace newer results', async () => {
  let finish;
  getCampReviewHistory.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const opening = screen.init();
  getCampReviewHistory.mockResolvedValue(reply([{ ...CAMP, id: 22, theme: 'Nouveau résultat' }]));
  document.getElementById('camp-history-filters').requestSubmit(); await flush();
  finish(reply([CAMP])); await opening;
  expect(document.querySelector('.camp-history h3').textContent).toBe('Nouveau résultat');
});
