/**
 * @jest-environment jsdom
 */

/**
 * The unit's camp reviews, year after year (#1257, third slice), and the
 * lessons of earlier camps shown while preparing a camp.
 *
 * Held here: closed reviews listed newest first with what they kept and
 * fixed, their words shown as text; a site or a season narrows the list, the
 * filter keeping the focus; an empty history and an empty filter say what
 * would fill them; a failed load says so, with a retry; the screen meets WCAG
 * A/AA. "Last time" names what it draws on, is drawn only in a page still
 * shown, says when it could not be read, and is not asked for without the
 * right to read reviews.
 *
 * @module test/spa/CampReviews
 */

import axe from 'axe-core';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn(), debugInfo: jest.fn(),
}));
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/api/api-camp-reviews.js', () => ({
  getCampReviewHistory: jest.fn(), getPreviousLessons: jest.fn(),
}));

const api = require('../../spa/api/api-camp-reviews.js');
const { hasPermission } = require('../../spa/utils/PermissionUtils.js');
const { CampReviews } = require('../../spa/modules/camp-review/CampReviews.js');
const { mountPreviousLessons, previousLessonsMarkup } = require('../../spa/modules/camp-review/CampLessons.js');

const AXE_OPTIONS = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  rules: { 'color-contrast': { enabled: false } },
};
const AUTUMN = {
  camp: { id: 12, theme: 'Camp d’automne', date_from: '2025-10-03', date_to: '2025-10-05', season: 'autumn' },
  site: { id: 4, name: 'Camp du Lac Fictif' },
  counts: { notes: 5, keep: 1, fix: 1 },
  keep: [{ id: 'k', text: 'Le grand jeu de nuit', action_text: 'Le refaire samedi', weight: 4 }],
  fix: [{ id: 'f', text: 'La vaisselle', action_text: 'Deux bacs', weight: 2 }],
};
const WINTER = {
  camp: { id: 9, theme: '<img src=x onerror=alert(1)>', date_from: '2025-02-07', date_to: '2025-02-09', season: 'winter' },
  site: null, counts: { notes: 1, keep: 0, fix: 0 }, keep: [], fix: [],
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector) => document.querySelector(selector);
let screen;

async function open() {
  screen = new CampReviews({ lang: 'fr', showMessage: jest.fn() });
  await screen.init();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = '<main id="app"></main>';
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getCampReviewHistory.mockResolvedValue({ success: true, data: { reviews: [AUTUMN, WINTER], sites: [{ id: 4, name: 'Camp du Lac Fictif' }] } });
  hasPermission.mockReset();
  hasPermission.mockImplementation(() => true);
});

afterEach(() => screen?.destroy());

describe('the history of camp reviews', () => {
  test('lists closed reviews newest first, with what each kept and fixed and a way to open it', async () => {
    await open();
    expect($('a[href="/camp-plans"]')).not.toBeNull();
    const reviews = [...document.querySelectorAll('.camp-lessons__list > li')];
    expect(reviews.map((item) => item.querySelector('h2 a').getAttribute('href'))).toEqual(['/camp-review/12', '/camp-review/9']);
    expect(reviews[0].textContent).toContain('Camp du Lac Fictif');
    expect(reviews[0].textContent).toContain('Le grand jeu de nuit');
    expect(reviews[0].textContent).toContain('camp_review_action_value');
    expect(reviews[1].querySelector('img')).toBeNull();
    expect(reviews[1].querySelector('h2').textContent).toContain('<img src=x onerror=alert(1)>');
    expect(reviews[1].querySelectorAll('.empty-state')).toHaveLength(2);
  });

  test('a site or a season narrows the list, keeping the focus on the filter', async () => {
    await open();
    api.getCampReviewHistory.mockResolvedValue({ success: true, data: { reviews: [AUTUMN], sites: [{ id: 4, name: 'Camp du Lac Fictif' }] } });
    const season = $('#camp-reviews-season');
    expect(season.hasAttribute('data-archive-safe')).toBe(true);
    season.focus();
    season.value = 'autumn';
    season.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();
    expect(api.getCampReviewHistory).toHaveBeenLastCalledWith({ season: 'autumn' });
    expect(document.activeElement.id).toBe('camp-reviews-season');
    expect($('#camp-reviews-season').value).toBe('autumn');
    expect($('#camp-reviews-count').getAttribute('role')).toBe('status');

    api.getCampReviewHistory.mockResolvedValue({ success: true, data: { reviews: [], sites: [] } });
    const site = $('#camp-reviews-site');
    expect([...site.options].map((option) => option.value)).toEqual(['', '4']);
    site.value = '4';
    site.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    await flush();
    expect(api.getCampReviewHistory).toHaveBeenLastCalledWith({ site_id: '4', season: 'autumn' });
    expect($('.empty-state').textContent).toBe('camp_reviews_empty_filtered');
  });

  test('an empty history says what would fill it', async () => {
    api.getCampReviewHistory.mockResolvedValue({ success: true, data: { reviews: [], sites: [] } });
    await open();
    expect($('.empty-state').textContent).toBe('camp_reviews_empty');
  });

  test('a failed load says so, with a retry, never as an empty history', async () => {
    api.getCampReviewHistory.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    await open();
    expect($('[role="alert"]')).not.toBeNull();
    expect($('.camp-lessons__list')).toBeNull();
    $('#camp-reviews-retry').click();
    await flush();
    await flush();
    expect(document.querySelectorAll('.camp-lessons__list > li')).toHaveLength(2);
  });

  test('the screen has no WCAG A/AA violation', async () => {
    await open();
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);
  });

  test('an answer arriving after the screen was left does not draw over the next one', async () => {
    let resolve;
    api.getCampReviewHistory.mockReturnValue(new Promise((done) => { resolve = done; }));
    screen = new CampReviews({ lang: 'fr' });
    const loading = screen.init();
    screen.destroy();
    document.getElementById('app').textContent = 'next screen';
    resolve({ success: true, data: { reviews: [AUTUMN], sites: [] } });
    await loading;
    expect(document.getElementById('app').textContent).toBe('next screen');
  });
});

describe('lessons of earlier camps while preparing one', () => {
  test('names what they draw on and links each earlier review and the history', () => {
    document.body.innerHTML = `<main id="app">${previousLessonsMarkup({ basis: 'season', reviews: [AUTUMN] }, 'fr', 'test-lessons')}</main>`;
    expect($('#test-lessons-title').textContent).toBe('camp_lessons_title');
    expect($('.camp-lessons').textContent).toContain('camp_lessons_basis_season');
    expect($('a[href="/camp-review/12"]')).not.toBeNull();
    expect($('a[href="/camp-reviews"]')).not.toBeNull();
    expect(previousLessonsMarkup({ basis: null, reviews: [] }, 'fr', 'x')).toBe('');
  });

  test('is drawn into its container, and not asked for without the right to read reviews', async () => {
    document.body.innerHTML = '<main id="app"><div id="lessons"></div></main>';
    api.getPreviousLessons.mockResolvedValue({ success: true, data: { basis: 'site', reviews: [AUTUMN] } });
    await mountPreviousLessons($('#lessons'), 12, 'fr', 'plan-lessons');
    expect(api.getPreviousLessons).toHaveBeenCalledWith(12);
    expect($('#lessons').textContent).toContain('Le grand jeu de nuit');
    const results = await axe.run(document.getElementById('app'), AXE_OPTIONS);
    expect(results.violations).toEqual([]);

    api.getPreviousLessons.mockClear();
    hasPermission.mockImplementation(() => false);
    await mountPreviousLessons($('#lessons'), 12, 'fr', 'plan-lessons');
    expect(api.getPreviousLessons).not.toHaveBeenCalled();
  });

  test('says when it could not be read, and draws nothing in a page that has moved on', async () => {
    document.body.innerHTML = '<main id="app"><div id="lessons"></div></main>';
    api.getPreviousLessons.mockRejectedValueOnce(new Error('boom'));
    await mountPreviousLessons($('#lessons'), 12, 'fr', 'plan-lessons');
    expect($('#lessons').textContent).toBe('camp_lessons_load_failed');

    const container = $('#lessons');
    let resolve;
    api.getPreviousLessons.mockReturnValue(new Promise((done) => { resolve = done; }));
    const loading = mountPreviousLessons(container, 12, 'fr', 'plan-lessons');
    document.getElementById('app').textContent = 'next screen';
    resolve({ success: true, data: { basis: 'site', reviews: [AUTUMN] } });
    await loading;
    expect(document.getElementById('app').textContent).toBe('next screen');
  });
});
