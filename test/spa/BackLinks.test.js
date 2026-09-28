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
  'spa/modules/walk-in/WalkInChildren.js': '${renderBackLink()}',
  'spa/modules/parent-invitations/ParentInvitations.js': '${renderBackLink()}',
  'spa/modules/participant-duplicates/ParticipantDuplicates.js': '${renderBackLink()}',
  'spa/modules/family-access/FamilyAccess.js': '${renderBackLink()}',
  'spa/modules/parent-onboarding/ParentOnboarding.js': '${renderBackLink()}',
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

test('the health form opens with the back link in every state, and keeps no small link at the bottom', () => {
  const source = fs.readFileSync(path.join(ROOT, 'spa/fiche_sante.js'), 'utf8');
  const lines = source.split('\n');

  // Each rendered page (form and error) has the link as its first line.
  const pageStarts = lines
    .map((line, index) => [line, index])
    .filter(([line]) => /const (content|errorMessage) = `$/.test(line.trim()));
  expect(pageStarts).toHaveLength(2);
  for (const [, index] of pageStarts) {
    expect(lines[index + 1].trim()).toBe('${renderBackLink()}');
  }

  // The old 18px text link at the foot of the page is gone.
  expect(source).not.toContain('retour_tableau_bord');
});
