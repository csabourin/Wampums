# Volunteering (#1251)

`/volunteers` lists what each activity or camp needs, by time slot ("shifts"), and lets members
take or give up a place. Migration `069_volunteer_shifts.sql`.

## Who can do what

| Permission | Grants |
|---|---|
| `volunteers.view` | List upcoming shifts with places left; take or give up one's own place. Other volunteers' names are not returned. |
| `volunteers.manage` | Create, edit and delete shifts; see who signed up and remove someone. |

The built-in **volunteer** role (`role_label_volunteer`, data scope `organization`) holds only
`volunteers.view` and `tasks.view`: a cook or driver takes part without any youth, family or
health permission. Invite them with that role from `/invitations`. Migration 069 also gives both
keys to `unitadmin` (and roles customized from it), `volunteers.view` to `leader`, and both to
`demoadmin` (read-only through `blockDemoRoles`). The district role receives them through its trigger.

## Types and requirements

Each shift has a type from a fixed bilingual list in `config/volunteer_shifts.json` (read by the
server and the SPA; migration 069 checks the same keys, `test/volunteer-types.test.js`):

| Type | Requires |
|---|---|
| `camp_aide` (aide de camp) | background check, safety training |
| `cook` (cuisine) | nothing |
| `driver` (transport) | driver's licence |
| `night_watch` (veille de nuit) | background check, safety training |
| `first_aid` (premiers soins) | first-aid certificate, background check |
| `other` (autre) | nothing; the shift's title says what it is (required) |

A listed type may add a precision in its title ("Cuisine · Souper"). To change what a type requires,
edit the JSON; adding a type or requirement also needs a migration extending the check and labels in
both languages (`volunteer_type_<key>`, `volunteer_requirement_<key>`).

A place is **confirmed** when its holder meets every requirement of the shift's type on the shift's
day, and otherwise **pending**: it holds the seat, and the person sees what is still to verify.
Managers record what they verified (`PUT /api/v1/volunteer-shifts/requirements/:userId`, the
complete record: requirement keys with an optional `valid_until`); the person's upcoming places
then follow, confirmed when complete, pending again when something is withdrawn or expires before
the shift. Changing a shift's type or day re-evaluates its places. Only the fact and the expiry are
stored (`volunteer_requirements`), never a document; a member reads their own record
(`/requirements/me`), managers anyone's in the unit.

## Rules (`services/volunteerShifts.js`)

- A shift belongs to one active activity of the unit (a camp is an activity) and its day falls
  within that activity's dates. Places are 1 to 50 (`config/volunteer_shifts.json`, shared with the SPA).
- Taking a place locks the shift row, counts its places and inserts in one transaction: when two
  people take the last place at once, one is confirmed and the other receives 409
  `volunteer_shift_full`. A pending place counts as taken; taking it again answers 200.
- The volunteer is always the authenticated user, never a request field.
- Places cannot be lowered below the sign-ups already recorded (409 `volunteer_slots_below_signups`).
- Writes need a connection (`volunteer-shifts` is in `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES`).

## Camp readiness

"Ready for camp" shows a Volunteers line and section (with `volunteers.view`): places still open
over the total and places still to verify, each shift linking to `/volunteers`. A camp without shifts reads "nothing recorded
yet", never as done.

## Tests

`test/volunteer-shifts.integration.test.js` (the last-place race, the volunteer role refused youth,
medication and form reads, unit isolation), `test/routes-volunteer-shifts.test.js`,
`test/spa/Volunteers.test.js` (axe, keyboard, escaping), and `/volunteers` in
`e2e/accessibility.spec.mjs` on the seeded "Camp d'hiver".
