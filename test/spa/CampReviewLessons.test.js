/** @jest-environment jsdom */
import axe from 'axe-core';
jest.mock('../../spa/app.js', () => ({ translate: (key) => key }));
jest.mock('../../spa/config.js', () => ({ CONFIG: {}, getStorageKey: (key) => key }));
jest.mock('../../spa/utils/DebugUtils.js', () => ({ debugLog: jest.fn(), debugError: jest.fn(), debugWarn: jest.fn() }));
let mockScope = 'unit-1';
jest.mock('../../spa/utils/OfflineCacheKeys.js', () => ({ buildScopedCacheKey: () => mockScope }));
jest.mock('../../spa/utils/PermissionUtils.js', () => ({ hasPermission: jest.fn(() => true) }));
jest.mock('../../spa/api/api-camp-reviews.js', () => ({ getCampReviewLessons: jest.fn(), getCampReview: jest.fn() }));
const { CampReviewLessons } = require('../../spa/modules/camp-review/CampReviewLessons');
const api = require('../../spa/api/api-camp-reviews');
const { hasPermission } = require('../../spa/utils/PermissionUtils');
const NOTE = { id: 'fictional-note', text: '<img src=x onerror=alert(1)>', outcome: 'keep', action_text: 'Le reprendre', weight: 3,
  source_meeting_id: 12, source_name: 'Camp fictif', source_date: '2025-07-10', same_site: true, same_profile: true };
let panel;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
  document.body.innerHTML = '<main><input id="draft" value="Un brouillon"><div id="lessons"></div></main>';
  mockScope = 'unit-1'; hasPermission.mockReturnValue(true);
  api.getCampReviewLessons.mockReset().mockResolvedValue({ data: { notes: [NOTE] }, pagination: { hasNext: false } });
  api.getCampReview.mockReset().mockResolvedValue({ data: { camp: { theme: 'Camp source', date_from: '2025-07-10' }, review: { status: 'closed' }, notes: [NOTE] } });
  panel = new CampReviewLessons({ lang: 'fr' }, { element: document.getElementById('lessons'), meetingId: 22 });
});
afterEach(() => panel.destroy());

test('lessons name the matching reason and source, escape text and preserve the surrounding draft and focus', async () => {
  const input = document.getElementById('draft'); input.focus();
  await panel.init();
  expect(document.querySelector('.camp-lessons strong').textContent).toBe(NOTE.text);
  expect(document.querySelector('.camp-lessons img')).toBeNull();
  expect(document.querySelector('.camp-lessons').textContent).toContain('camp_history_match_both');
  expect(document.querySelector('a[href="/camp-review/12"]')).not.toBeNull();
  expect(input.value).toBe('Un brouillon'); expect(document.activeElement).toBe(input);
  expect((await axe.run(document.querySelector('.camp-lessons'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] }, rules: { 'color-contrast': { enabled: false } } })).violations).toEqual([]);
});

test('without permission no observations are requested or displayed', async () => {
  hasPermission.mockReturnValue(false); await panel.init();
  expect(api.getCampReviewLessons).not.toHaveBeenCalled();
  expect(document.querySelector('.camp-lessons')).toBeNull();
});

test('a failed panel can retry without changing the surrounding form', async () => {
  api.getCampReviewLessons.mockRejectedValueOnce(new Error('fictional failure'));
  await panel.init(); expect(document.querySelector('[role="alert"]')).not.toBeNull();
  document.querySelector('[data-lessons-retry]').click(); await flush();
  expect(document.querySelector('.camp-lessons strong')).not.toBeNull();
  expect(document.getElementById('draft').value).toBe('Un brouillon');
});

test('a late source response cannot replace a different source or a different unit', async () => {
  let finish;
  api.getCampReviewLessons.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const opening = panel.init();
  mockScope = 'unit-2'; finish({ data: { notes: [NOTE] } }); await opening;
  expect(document.querySelector('.camp-lessons strong')).toBeNull();
});

test('the copy preview reads only a closed source and a detached preview ignores a late reply', async () => {
  panel.destroy();
  panel = new CampReviewLessons({ lang: 'fr' }, { element: document.getElementById('lessons'), meetingId: 12, source: true });
  api.getCampReview.mockResolvedValueOnce({ data: { review: { status: 'open' }, notes: [NOTE] } });
  await panel.init();
  expect(document.querySelector('.camp-lessons').textContent).toContain('camp_history_source_empty');
  expect(api.getCampReviewLessons).not.toHaveBeenCalled();
  let finish;
  api.getCampReview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = panel.load(); document.getElementById('lessons').remove();
  finish({ data: { review: { status: 'closed' }, camp: {}, notes: [NOTE] } }); await pending;
  expect(document.querySelector('.camp-lessons')).toBeNull();
});
