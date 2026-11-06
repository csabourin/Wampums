/**
 * @jest-environment jsdom
 */

/**
 * Every screen opens with the same way back: "← Back", first in the page,
 * above the title, outside any header row that would set it beside the title.
 *
 * The family-access and walk-in screens call `renderBackLink()`; this holds
 * each of their render states to it, so a new state cannot forget the link.
 *
 * @module test/spa/BackLinks
 */

import fs from 'fs';
import path from 'path';

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn(),
}));

jest.mock('../../spa/app.js', () => ({
  translate: (key) => key,
}));

import { renderBackLink } from '../../spa/utils/BackLinkUtils.js';
import { buildNotFoundMarkup } from '../../spa/utils/NotFoundUtils.js';

const ROOT = path.join(__dirname, '../..');

const SCREENS = {
  // Opened from attendance, back leads to attendance; otherwise to the dashboard.
  'spa/modules/walk-in/WalkInChildren.js': '${renderBackLink(this.backHref)}',
  'spa/modules/parent-invitations/ParentInvitations.js': '${renderBackLink()}',
  'spa/modules/display-settings/DisplaySettings.js': '${renderBackLink()}',
  'spa/modules/participant-duplicates/ParticipantDuplicates.js': '${renderBackLink()}',
  'spa/modules/family-access/FamilyAccess.js': '${renderBackLink()}',
  'spa/modules/parent-onboarding/ParentOnboarding.js': '${renderBackLink()}',
  // A parent page: back means the parent dashboard, for staff previewing it too.
  'spa/modules/fundraising/ParentFundraisers.js': "${renderBackLink('/parent-dashboard')}",
  // Reached from an email, possibly signed out: the link shows only with a session.
  'spa/modules/family-access/CompleteRegistration.js': '${this.backLink()}',
  'spa/modules/family-access/FamilyLinkReview.js': '${this.backLink()}',
};

test.each(Object.entries(SCREENS))('every render state of %s opens with the back link', (file, call) => {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n');
  const sections = lines
    .map((line, index) => [line, index])
    .filter(([line]) => /<section class="page /.test(line));

  expect(sections.length).toBeGreaterThan(0);
  for (const [, index] of sections) {
    expect(lines[index + 1].trim()).toBe(call);
  }
});

test('the back link is the ghost button every older screen writes by hand', () => {
  expect(renderBackLink()).toBe('<a href="/dashboard" class="button button--ghost">← back</a>');
  expect(renderBackLink('/incident-reports')).toContain('href="/incident-reports"');
});

test('not-found and not-authorized pages open with it too, outside the centred card', () => {
  document.body.innerHTML = buildNotFoundMarkup({ titleKey: 'error_403_not_authorized' });

  const first = document.body.firstElementChild;
  expect(first.tagName).toBe('A');
  expect(first.getAttribute('href')).toBe('/dashboard');
  expect(document.querySelector('.not-found-state__card a')).toBeNull();
});

test('a not-authorized page is titled by its own heading, which focus and the tab title use', () => {
  document.body.innerHTML = buildNotFoundMarkup({ titleKey: 'error_403_not_authorized' });

  const headings = document.querySelectorAll('h1');
  expect(headings).toHaveLength(1);
  expect(headings[0].textContent).toBe('error_403_not_authorized');
});


test('the not-found and not-authorized pages speak plainly and offer a way home', () => {
  const en = JSON.parse(fs.readFileSync(path.join(__dirname, '../../lang/en.json'), 'utf8'));
  const fr = JSON.parse(fs.readFileSync(path.join(__dirname, '../../lang/fr.json'), 'utf8'));
  // A status code reads as a breakdown to someone who is not technical (#1370).
  ['error_403_not_authorized', 'error_403_not_authorized_message', 'error_404_not_found', 'error_404_not_found_message']
    .forEach((key) => {
      expect(en[key]).not.toMatch(/\b40[34]\b/);
      expect(fr[key]).not.toMatch(/\b40[34]\b/);
    });

  document.body.innerHTML = buildNotFoundMarkup({
    titleKey: 'error_403_not_authorized',
    messageKey: 'error_403_not_authorized_message',
    homeButton: true,
  });
  const home = document.querySelector('.not-found-state__card a.not-found-state__home');
  expect(home.getAttribute('href')).toBe('/');
  expect(home.className).toContain('button button--primary');
  expect(home.textContent).toBe('not_found_home_button');
  // Still the page's first element: the back link, then one heading.
  expect(document.body.firstElementChild.getAttribute('href')).toBe('/dashboard');
  expect(document.querySelectorAll('h1')).toHaveLength(1);
});

test('the router shows both pages with the plain message and the way home', () => {
  const router = fs.readFileSync(path.join(__dirname, '../../spa/router.js'), 'utf8');
  const notFound = router.slice(router.indexOf('loadNotFoundPage() {'), router.indexOf('loadNotAuthorizedPage() {'));
  const notAuthorized = router.slice(router.indexOf('loadNotAuthorizedPage() {'), router.indexOf('async loadRegisterPage'));
  expect(notFound).toContain("messageKey: 'error_404_not_found_message'");
  expect(notFound).toContain('homeButton: true');
  expect(notAuthorized).toContain('homeButton: true');
});
