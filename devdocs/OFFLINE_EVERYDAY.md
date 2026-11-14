# Everyday use without signal

A leader or a parent must be able to open Wampums with no network, with no step to take before
leaving and whether or not a camp is planned. Camp preparation (`devdocs/OFFLINE_CAMP_POINTS.md`)
adds a camp's data on top of this.

## Starting the app

- The root `index.html` is in the Workbox precache (`vite.config.mjs`). A worker therefore holds,
  from the moment it finishes installing, the page that names exactly the scripts installed with it.
  The first visit needs no reload, and a deploy cannot leave the device without a page to start.
- Online, navigations still go to the network first (`src-sw.js`, `handleAppNavigation`): the
  precache route answers only `/index.html` itself (`directoryIndex: null`, `cleanURLs: false`).
- Offline, or when the network neither answers nor fails within `NAVIGATION_NETWORK_TIMEOUT_MS`, the
  installed shell answers; the last network page (`offline-shell`) is the fallback for workers
  installed before this change.
- A new server build does not purge anything on a page the worker controls
  (`checkForStaleClient`): the worker installs the build and the update prompt switches. Only a
  missing chunk proves a client broken and purges it.
- Accepting an update clears only the replaced build's HTML and unversioned translations
  (`spa/utils/UpdateCacheUtils.js`). IndexedDB (cached reads, queued changes) is never cleared by
  an update.

## Reading data

- **Every read keeps a copy by default.** `API.get` is cache-first within its freshness;
  `API.getNoCache` always asks the server but now keeps the answer too, so a screen still opens
  without a connection. Online, both still show the server's answer.
- **Exceptions are explicit.** `NETWORK_ONLY_READS` (`spa/config/offline-reads.js`) lists the reads
  never kept, each with its reason: personal contacts, health and certifications, consented camp
  contacts, camp team health, submitted plan versions, secrets and expiring links, and the editors of
  changes only the server can make (roles, invitations, transfers, scout-year change…). `api-core`
  refuses to cache them whichever function asks. A new exception needs a reason of the same weight.
- `getCachedData` never deletes an expired record: freshness decides whether to ask the server,
  not whether the copy survives. After a failed request, `getCachedDataIgnoreExpiration` serves it.
- A copy stays readable offline until `OFFLINE_READS.RETENTION_MS` (14 days) after the server
  confirmed it, or its own expiry if later (`offlineReadableUntil`). `pruneOfflineCache` removes
  older copies at each launch; sign-out still deletes everything.
- A body the service worker answered from its own copy (`X-From-Cache`) is never stored again, so
  it cannot pass for a fresh confirmation.
- Interface languages: every language the unit offers, the visitor's own included, is fetched again
  once a worker controls the page (`cacheLanguagesForOffline`), so a first visit is translated
  offline too.

## Automatic preparation

`spa/modules/offline/OfflineBaseline.js` runs a few seconds after launch, right after sign-in
(`OFFLINE_READS.SIGNED_IN_EVENT`), on reconnection and on return to the app (at most once per
`BASELINE_MIN_INTERVAL_MS`), never offline, signed out or on an archived year. Each read is repeated
once its copy is older than `BASELINE_ENTRY_MAX_AGE_MS`, `BASELINE_CONCURRENCY` at a time. A read the
server refuses (4xx) is not asked again that session. It asks the browser for persistent storage.

1. **Catalogue** (`BASELINE_READS`): the main screens, ready even if never opened on this device, each
   behind the permission its endpoint requires: my tasks, next meeting, parent contact list, parent
   dashboard, participants, groups, attendance dates, points, honors, badges, unit reports (points,
   honors, attendance), activities and the carpools of the next ones, material lists of upcoming camps,
   personal equipment, volunteer space and its camps. For today, the next `BASELINE_DAYS_AHEAD` days and
   the next meeting: the action roster, attendance, guests, honors and programme of that day.
2. **Registry** (`spa/utils/OfflineReadRegistry.js`): every cached read a screen made (endpoint,
   query, cache key), per account, unit and year, most recent first, bounded and forgotten after the
   retention. Any screen the person uses stays ready, a future one (menus, schedules) included, with
   no list to maintain. Sign-out clears it.

**A new screen** is offline-ready by default once visited. If it must work offline without being
visited first, add its main read to `BASELINE_READS` with its endpoint's permission. If it must never
be kept, add it to `NETWORK_ONLY_READS` with the reason. Sections that cannot work offline (writes the
server must confirm) keep refusing with `online_required`.

## Tests

`test/service-worker-offline-readiness.test.js`, `test/service-worker-config.test.js`,
`test/spa/OfflineCacheRetention.test.js`, `test/spa/OfflineBaseline.test.js`,
`test/spa/UpdateCacheUtils.test.js`, `test/spa/StaleClientRecovery.test.js`,
`test/spa/OfflineReadRegistry.test.js`, `test/spa/ApiRequestLifecycle.test.js`, and in the built PWA
`e2e/first-launch.offline.mjs` (every everyday screen opened offline after one online visit).
