# Camp review (#1257)

At the end of a camp, the unit goes round the circle: what was liked, less liked, what to
improve (the "Evaluated" of the V.C.P.R.E.F.). A leader notes it as it is said, often without a
network. An idea said again weighs more. The first slice covers noting and weighing; the second,
sorting (keep / fix), merging, removing one particular "+1" and closing the review; the third,
reading closed reviews year after year and "last time" while preparing a camp.

## Rules

- `/camp-review/:meetingId` takes `camp_reviews.view`; writing takes `camp_reviews.manage`
  (migration `077_camp_reviews.sql`, given to unit-wide roles holding `meetings.view` and
  `meetings.manage`). Notes are free text: `blockDemoRoles` on every write, never the demo sandbox.
- A **note** has a category (`liked`, `disliked`, `improve`), a moment (`youth_council`,
  `team_daily` with one of the camp's days, `team_after`), an optional topic and at most 280
  characters (`config/camp_reviews.json`, shared with the SPA). Notes are collective: the field's
  help asks not to name a youth.
- A **vote** ("+1") is a row, not a counter. Weight = 1 + votes. There is **no vote against**: a
  disagreement is another note, in the other category.
- **Ids are chosen by the device** (UUID), for notes and votes alike, and the primary keys are
  `(organization_id, id)`. So every write is idempotent and may wait in the offline outbox:
  - `PUT /api/v1/camp-reviews/camps/:meetingId/notes/:noteId` creates (201) or, with
    `expected_version`, edits (200). The same content again succeeds; different content without
    the current version is a 409.
  - `DELETE` of a note, `PUT`/`DELETE` of `…/votes/:voteId`: removing what is already gone succeeds.
- Undoing a "+1" deletes that vote's id. The undo offer stays while it holds the focus.
- Every read and write is filtered by the camp's unit: the same camp in two units keeps two reviews.

## Sorting, merging, closing (online only)

- `PATCH …/notes/:noteId` sorts a note: `outcome` `keep` | `fix` | null and a short `action_text`,
  with `expected_version` (409 when stale). A merged note is not sorted: the note it joined is.
- `PUT …/notes/:noteId/merge` `{ into, expected_version }` merges a note into another **of the same
  category**; `DELETE` of the same path undoes it. One level deep: merging into a merged note, or
  merging a note others joined, is refused (409 `camp_review_merge_nested`), so weights never chain.
  Weight = 1 + votes + the weight of every note merged into it. A vote replayed later on a merged
  note still counts, in the note it joined. Removing a note lets the notes merged into it stand alone.
- Votes carry who gave them and when, so sorting can remove one particular "+1".
- `PUT …/camps/:meetingId/status` `{ status: 'open' | 'closed', expected_version }` closes or reopens
  the review (`camp_reviews`, migration 078; a camp without a row is open at version 0). While
  closed, every change is refused with 409 `camp_review_closed`, a replay from the outbox included.
  Writes hold the review's row (`FOR SHARE`), so closing waits for them.
- These calls are never queued (`queueOffline: false`); the screen offers them only online, on the
  server's own copy. The plan's "Evaluated" step links to the review.
- Confirmed sorting, merges, unmerges and vote removals update the retained notes and the device's
  copy before refreshing. Losing the network during that refresh therefore keeps the accepted change.
  Unmerging also removes the child and its weight from its former parent. A confirmed closing or
  reopening invalidates older background reads so they cannot restore the previous status.
  A confirmed deletion also removes a note nested under a merge target, recalculating the target's
  weight, including when an offline vote and deletion are replayed after another device merged it.
  A confirmed parent's merged children also replace any standalone copies retained here, so a vote
  after a merge on another device never counts the same note both inside and outside its parent.
  Note and vote responses include the complete `notes` list already read by the service in the
  write transaction. The client uses this authoritative list when supplied: a child detached on
  another device stays visible with its current version and votes, while a deleted child stays gone.
  Quiet refreshes also redraw status controls when server decisions become available after reconnecting,
  keeping a note being typed and its focus.

## Year after year

- `GET /api/v1/camp-reviews` (`camp_reviews.view`) lists the unit's **closed** reviews, newest camp
  first (at most 100), with the camp, its site and season, counts and its five heaviest notes kept
  and fixed with their actions. `site_id` and `season` narrow it (400 `camp_review_invalid_filter`
  otherwise); `sites` lists every site a closed review was held at, without the list's cap.
  `meeting_id` returns one camp's closed review, however old (the dialog reusing a camp reads the
  chosen camp's this way, camp by camp). Reviews belong to the unit, not to a
  scout year: an archived year shows the same history. Screen: `/camp-reviews`.
- `GET /api/v1/camp-reviews/camps/:meetingId/previous` gives "last time" for a camp: the two latest
  closed reviews of camps that started before it **at the same site** (`basis: 'site'`), or, without
  any, **of the same season** (`basis: 'season'`), keeping only reviews that kept or fixed something.
  Without either, nothing (`basis: null`): another kind of camp would mislead more than help.
- `CampLessons.js` draws it in the camp plan and camp readiness (`mountPreviousLessons`, into a
  container the page owns; a failed read says so), and the dialog reusing an earlier camp shows what
  the chosen camp's closed review kept and fixed. None is asked for without `camp_reviews.view`.
- The camp permit's "camp evaluation" line (#1320) is not linked yet.

## Offline

- Writes are in `SAFE_OFFLINE_MUTATIONS` with kind `camp_review` (`sync.rejected_kind_camp_review`).
  While one waits in the outbox, later review writes queue behind it (`campReviewWaiting` in
  `api-core.js`), so a vote never reaches the server before its note.
- `CampReviewOffline.js` keeps the last **confirmed** review on the device
  (`camp_review_snapshot_<meetingId>`, outside the API resource path so queued writes do not clear
  it). Camp preparation stores it (`campReviews` in `POST /api/v1/offline/prepare-activity`) and
  so does each online visit. A confirmed write or replay applies the server's answer to it, even
  with the screen closed.
- Waiting changes are read from the outbox and laid over the copy, marked "waiting to be sent".
  A refused change leaves the outbox and disappears from the view; the copy never held it, so it
  is not cleared.
- Without a copy on the device, notes can still be added; the page says that notes taken elsewhere
  are not shown.

## Verification

- `test/routes-camp-reviews.test.js`: 401, 403 with `required`/`missing`, `isDemo`, 400 ids, field checks.
- `test/camp-reviews.integration.test.js`: replayed notes and votes count once, undo, versions,
  unit isolation, offline pack; sorting, merge weights and limits, closing; history filters and
  "last time" by site, then season.
- `test/spa/CampReview.test.js` (axe, keyboard, escaping, offline) and `CampReviewOffline.test.js`
  (outbox order, overlay, replay into the copy, refusals, duplicate matching).
- `test/spa/CampReviews.test.js`: the history and the lessons panel (axe, escaping, filters, states).
- `e2e/accessibility.spec.mjs`: `/camp-review/<seeded camp>` and `/camp-reviews` at phone and desktop size.
