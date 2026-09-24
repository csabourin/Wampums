/**
 * Routing for the family access pages.
 *
 * The pages an emailed link opens are for people who may not have an account
 * yet. If they fall off the router's logged-out allow-list, every invited
 * parent is sent to a login form they cannot use, and nothing else in the test
 * suite would notice. The admin pages are the opposite: they must stay behind
 * the permission that guards their endpoints.
 *
 * Read from the router's source, as the den-management suite does, because the
 * router cannot be instantiated under Jest without the whole application.
 *
 * @module test/spa/FamilyAccessRoutes
 */

import fs from 'fs';
import path from 'path';

const routerSource = fs.readFileSync(path.join(__dirname, '../../spa/router.js'), 'utf8');

/**
 * The route names the router lets through without a session.
 *
 * @returns {Array<string>} Route names
 */
function loggedOutRoutes() {
  const match = /if \(!this\.app\.isLoggedIn && !\[([^\]]+)\]\.includes\(routeName\)\)/.exec(routerSource);
  if (!match) throw new Error('logged-out allow-list not found in router');
  return match[1].split(',').map((name) => name.trim().replace(/^"|"$/g, ''));
}

test('the emailed-link pages have routes', () => {
  expect(routerSource).toContain('"/complete-registration": "completeRegistration"');
  expect(routerSource).toContain('"/family-link": "familyLink"');
});

test('the emailed-link pages open without a session', () => {
  expect(loggedOutRoutes()).toEqual(expect.arrayContaining(['completeRegistration', 'familyLink']));
});

test('the admin pages do not', () => {
  expect(loggedOutRoutes()).not.toContain('parentInvitations');
  expect(loggedOutRoutes()).not.toContain('participantDuplicates');
});

test('the admin pages are guarded by the permission their endpoints require', () => {
  expect(routerSource).toMatch(
    /case "parentInvitations":\s*if \(!guard\(hasPermission\('users\.invite'\)\)\)/
  );
  expect(routerSource).toMatch(
    /case "participantDuplicates":\s*if \(!guard\(hasPermission\('participants\.edit'\)\)\)/
  );
});

test('the links in the emails point at these routes', () => {
  const invitations = fs.readFileSync(path.join(__dirname, '../../services/parentInvitations.js'), 'utf8');
  const familyLinks = fs.readFileSync(path.join(__dirname, '../../services/familyLinks.js'), 'utf8');

  expect(invitations).toContain('/complete-registration?token=');
  expect(familyLinks).toContain('/family-link?token=');
});
