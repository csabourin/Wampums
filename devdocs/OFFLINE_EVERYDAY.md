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

- `getCachedData` never deletes an expired record: freshness decides whether to ask the server,
  not whether the copy survives. After a failed request, `getCachedDataIgnoreExpiration` serves it.
- A copy stays readable offline until `OFFLINE_READS.RETENTION_MS` (14 days) after the server
  confirmed it, or its own expiry if later (`offlineReadableUntil`). `pruneOfflineCache` removes
  older copies at each launch; sign-out still deletes everything.
- A body the service worker answered from its own copy (`X-From-Cache`) is never stored again, so
  it cannot pass for a fresh confirmation.

## Automatic preparation

`spa/modules/offline/OfflineBaseline.js` reads again, through the screens' own API functions and
each behind the permission its endpoint requires: my tasks, the next meeting, the parent contact
list (`reports.view`, unit scope) and the volunteer space with its first camps. It runs at launch,
right after sign-in (`OFFLINE_READS.SIGNED_IN_EVENT`), on reconnection and on return to the app, at
most once per `BASELINE_MIN_INTERVAL_MS` per account, unit and year. It asks the browser for
persistent storage. Camp contacts stay network-only (`devdocs/MEMBER_PROFILE.md`).

## Tests

`test/service-worker-offline-readiness.test.js`, `test/service-worker-config.test.js`,
`test/spa/OfflineCacheRetention.test.js`, `test/spa/OfflineBaseline.test.js`,
`test/spa/UpdateCacheUtils.test.js`, `test/spa/StaleClientRecovery.test.js`, and in the built PWA
`e2e/first-launch.offline.mjs`.
