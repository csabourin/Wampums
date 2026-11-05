# Volunteering (#1251)

`/volunteers` lists what each activity or camp needs, by time slot ("shifts"), and lets members
take or give up a place. Migration `069_volunteer_shifts.sql`.

## Who can do what

| Permission | Grants |
|---|---|
| `volunteers.view` | List upcoming shifts with places left; take or give up one's own place. Other volunteers' names are not returned. |
| `volunteers.manage` | Create, edit and delete shifts; see who signed up and remove someone. |

The built-in **volunteer** role (`role_label_volunteer`, data scope `organization`) holds only
`volunteers.view`, `tasks.view` and, since migration 075, `volunteer_space.view` (`devdocs/VOLUNTEER_SPACE.md`):
a cook or driver takes part without any youth, family or health permission. Invite them with that role from `/invitations`. Migration 069 also gives both
keys to `unitadmin` (and roles customized from it), `volunteers.view` to `leader`, and both to
`demoadmin` (read-only through `blockDemoRoles`). The district role receives them through its trigger.

## Types and requirements

Each shift has a type from a fixed bilingual list in `config/volunteer_shifts.json` (read by the
server and the SPA; migration 069 checks the same keys, `test/volunteer-types.test.js`):

| Type | Requires |
|---|---|
| `camp_aide` (aide de camp) | background check, safety training |
| `cook` (cuisine) | background check |
| `driver` (transport) | background check, driver's licence |
| `night_watch` (veille de nuit) | background check, safety training |
| `first_aid` (premiers soins) | background check, first-aid certificate |
| `other` (autre) | background check; the shift's title says what it is (required) |

**Every adult needs a background check**, valid three years from the day it was done
(`validity_years`). A manager records the day of the check; the server sets its expiry, whatever the
request says (a check done on 29 February lasts until 28 February). Managers follow everyone's
checks under "Vérification des antécédents" on `/volunteers` (`GET /api/v1/volunteer-shifts/checks`,
`volunteers.manage`): every active member holding a role beyond a family's own children (leaders,
finance, equipment, district…) and anyone with a place on an upcoming shift, most urgent first:
missing, expired, expiring within `expiring_soon_days` (60), valid. A parent who takes no shift is
not listed.

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

The verify dialog also lists the **certifications the person declared** (#1319, migration 073:
first aid, wilderness first aid, winter camping), with their dates. They belong to the person, not to
the unit: ticking one verifies it for every unit of theirs (`PUT /api/v1/member-certifications/:userId/:key/verification`),
and the person changing its dates withdraws it. The unit requirement `first_aid_certificate` of a
first-aid shift is still recorded per unit, as above. See `devdocs/CAMP_ROSTERS.md`.

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

## Rules summary

The binding rules for this area, formerly in CLAUDE.md.

`/volunteers` (`volunteers.view`; managing shifts takes `volunteers.manage`, migration 069) lists
each activity's or camp's needs by time slot. Writes go through `services/volunteerShifts.js`, which
locks the shift so its last place goes to one person (409 `volunteer_shift_full` for the other). The
built-in `volunteer` role holds only `volunteers.view`, `tasks.view` and `volunteer_space.view`: no youth,
family or health record. What a member needs at the camps they take part in is gathered in the volunteer
space (`devdocs/VOLUNTEER_SPACE.md`). Other volunteers' names go to managers only. Each shift has a type (`config/volunteer_shifts.json`); a type's
requirements keep a place pending until a manager records them. Every adult of the team and every
volunteer needs a background check, valid three years from the day it was done (the server sets the
expiry); managers follow them on `/volunteers`. See `devdocs/VOLUNTEERS.md`.
