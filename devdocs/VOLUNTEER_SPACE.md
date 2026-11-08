# Volunteer space (#1360)

`/volunteer-space` gathers, for one member, what they need for the camps they take part in:
a cook, a driver or a camp aide finds everything in one place without any youth or health record.
Migration `075_volunteer_space.sql`.

## Who sees what

| Permission | Grants |
|---|---|
| `volunteer_space.view` | Open the space. Migration 075 gives it to every role holding `volunteers.view` (the built-in volunteer role, leaders, the unit's management, the demo admin, and roles customized from them); migration 084 to the parent role, the roles customized from it and the demo parent; the district role receives it through its trigger. |

**Which camps open comes from taking part, never from a role's name** (`services/volunteerSpace.js`,
`TAKES_PART_SQL`): a place on one of the camp's volunteer shifts, or a seat on the team of its planned
camp (`camp_team_members`, not cancelled). Any other camp, of this unit or another, answers 404
`volunteer_space_camp_not_found`, so its existence is not revealed. A camp is an activity with
`is_camp`; the space addresses it by its activity id (`/volunteer-space/:activityId`), because shifts
belong to the activity and the team to its planned camp.

The camp's fresh contacts endpoint names only consenting adults at the same camp (see `devdocs/MEMBER_PROFILE.md`). Nothing returned names a youth. The on-site lead is named (never a contact),
as on the camp site page. Phone numbers are the site's, the hospital's and public lines, as recorded
on the camp site (`devdocs/CAMP_SITES.md`).

## Screens

- **`/volunteer-space`** (tile "Volunteer space", moment "This week"): my camps that are not over
  (dates, "Under way", my seat on the team, my places and how many are still to verify), my upcoming
  places on any activity, up to five open tasks with a link to `/tasks`, and my profile: certifications
  and allergies through one My profile entry (`/account-info#my-profile`), with contacts and health information.
- **`/volunteer-space/:activityId`**: one camp, with quick links to each part (they move focus to it):
  - **My shifts**, each confirmed or still to verify, in words;
  - **Daily schedule** from the year plan (titles and times only), today's day open;
  - **what my shift types call for**, listed per type in `config/volunteer_shifts.json` (`space_panels`):
    `menus` (cook: the notes of every cook shift of the camp, in large type, until menus have their own
    place, #1260), `transport` (driver: meeting place and times going and back, the carpool with
    `carpools.view`, directions), `emergency_first` (night watch, first aid: the site and emergencies
    come right after the shifts);
  - **Site and emergencies**: site, address, on-site lead, the number to reach the team, hospital,
    poison centre, other numbers, directions, and the plan's "In case of emergency";
  - **Team instructions**: rules of life, camp rules, code of ethics, the camp's own text or the unit's
    template (`devdocs/CAMP_PLAN_SECTIONS.md`);
  - **My tasks for this camp**.

  A camp not yet in the year plan says its site and schedule are not given, never that there are none;
  its instructions are then the unit's templates.

The space only reads: places are taken on `/volunteers`, tasks changed on `/tasks`. Each read goes to
the server; the last answer is kept on the device (`CONFIG.CACHE_DURATION.CAMP_MODE`), so a camp opened
once can be read again without a connection.

## Not in this first version

- Other adults' consented contacts and the adult health form are now available (#1359; `devdocs/MEMBER_PROFILE.md`).
- **Structured menus, recipes, groceries** (#1260); allergies the kitchen needs, in numbers without
  names, are still to confirm.

## Tests

`test/volunteer-space.integration.test.js` (which camps open, by shift or by team seat; another camp
and another unit's camp refused; panels by type; nobody else named), `test/routes-volunteer-space.test.js`,
`test/spa/VolunteerSpace.test.js` (axe, escaping, states, focus), and both screens in
`e2e/accessibility.spec.mjs` on the seeded "Camp d'hiver".

Contacts are loaded separately, network-only: an offline schedule never includes an old consent.
