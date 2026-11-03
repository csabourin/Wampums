# Camp sites

Issue #1317, part of the camp plan (#1316). The camp permit asks where a camp is held, who owns
the site, how one sleeps and keeps warm there, whether the site's insurance covers the unit, and
how to reach help from it. Units go back to the same sites year after year, so a site is recorded
once and chosen for each camp.

## Screens

- **`/camp-sites`** (`meetings.view`): the unit's sites, each saying what its emergency
  information lacks. Adding, editing and archiving take `camp_sites.manage` (migration 070, given
  to every unit-wide role holding `meetings.manage`; the district role receives it through its trigger).
- **`/camp-site/:meetingId`** (`meetings.view`): where one planned camp is held. With
  `meetings.manage`, the camp chooses its site, season, accommodation, the unit lead on site (an
  active member) and the number families call; with `camp_sites.manage`, a site can be added or
  edited from here too. Opened from the camp schedule and the camp overview.

## Rules

- `camp_sites` holds no personal data: its numbers are the site's, the hospital's and public
  lines. Users have no profile phone, so the issue's "lead's number from their profile" became
  `camp_details.contact_phone`: a number entered for the camp, shown to families, the site's phone
  when empty.
- Sites are **archived, never deleted**. A camp keeps an archived site; an archived site cannot be
  chosen for another camp (400 `camp_site_unavailable`). One active name per unit (409).
- Edits name the version they loaded (`expected_version`); a change made since is refused (409
  `camp_site_version_conflict`). Saving a camp's site locks the camp row; a cancelled camp answers 409.
- Allowed values (accommodation, heating, season, province) and limits are in
  `config/camp_sites.json`, read by the server and the SPA; the migration's checks list the same values.
- **Poison centre:** choosing a province suggests one when the field is empty. Health Canada's
  1-844-POISON-X (1-844-764-7669) reaches the local centre everywhere except Quebec (Centre
  antipoison du Québec, 1-800-463-5060) and Nunavut (local health centre; no suggestion).
- Emergency gaps (`emergencyGaps` in `services/campSites.js`): site phone, address, hospital name,
  phone and travel time, poison centre, directions to the site. `/camp-readiness` shows them in a
  "Site and emergencies" section; a camp with no site says so instead of reading as ready.
- A new personal packing list starts from the camp's season (autumn and spring map to `shoulder`)
  and accommodation (tent, cabin).
- Reusing an earlier camp (#1256) has a `site` part: site, season, accommodation and contact number
  are copied; the lead on site is chosen again; an archived site is not chosen again.
- Writes need a connection (`camp-sites` is in `CONFIG.ONLINE_REQUIRED_MUTATION_RESOURCES`).

Tests: `test/camp-sites.integration.test.js`, `test/routes-camp-sites.test.js`,
`test/spa/CampSites.test.js`, `test/spa/CampSite.test.js`, and both screens in
`e2e/accessibility.spec.mjs` (seeded site: `campSiteId`).
