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
- **Offline, read-only** (#1327): `/camp-site/:meetingId` is kept on the device
  (`spa/modules/camp-sites/CampSiteOffline.js`), scoped to the account, unit and scout year, without the
  members a manager chooses from. It is stored on each online visit and by camp preparation
  (`POST /api/v1/offline/prepare-activity` returns `campSites` to `meetings.view` holders; the screen is
  preloaded with the camp's others). Known to be offline, the screen shows that copy with when it was kept
  and no form; never a service-worker answer, which would show an old page as editable. With no copy, it
  says so. A confirmed write to the camp sites clears the copy in every mode: it is kept under `/api/v1/camp-sites/camps/:id/offline-copy`, which writes clear by path prefix in camp mode and offline, and by `sources` otherwise. It is scoped to the session that read it. The dashboard's "Site and
  emergencies" shortcut is offered offline. Browser test: `e2e/camp-site.offline.mjs` (built PWA).

Tests: `test/camp-sites.integration.test.js`, `test/routes-camp-sites.test.js`,
`test/spa/CampSites.test.js`, `test/spa/CampSite.test.js`, and both screens in
`e2e/accessibility.spec.mjs` (seeded site: `campSiteId`).

## Rules summary

The binding rules for this area, formerly in CLAUDE.md.

`/camp-sites` (`meetings.view`; editing takes `camp_sites.manage`, migration 070) lists the places a
unit camps at, with what the camp permit asks: owner, accommodation, heating, the site's insurance,
nearest hospital, poison centre, directions. Sites are archived, never deleted, and hold no personal
data. `/camp-site/:id` chooses a planned camp's site, season, accommodation, unit lead on site (an
active member) and the number families call (`camp_details`, `meetings.manage`, version-checked,
camp row locked). Writes go through `services/campSites.js`; allowed values are
`config/camp_sites.json`, shared with the SPA. `/camp-readiness` lists the emergency information
still missing; a new packing list starts from the camp's season and accommodation; reusing a camp
copies its site but not its lead. See `devdocs/CAMP_SITES.md`.
