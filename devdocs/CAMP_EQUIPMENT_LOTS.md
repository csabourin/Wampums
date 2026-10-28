# Camp equipment lots (#1247)

A unit's material list opens **Equipment lots and responsibilities**. One form names
the lot, selects its articles and quantities, and assigns preparation. Transport and
return can name different active members; left blank, the preparer handles them.
Personal shared tasks open **My camp equipment lots**, without granting access to
youth, families, health records or other people's lots.

## Permissions and domain rules

A lot belongs to one unit and one planned meeting of kind `camp`. Articles come from
that camp's collective list; labels and units are trusted server snapshots. Across
lots, allocations cannot exceed current list quantities when a lot is saved.
Changing the schedule later can change the needs: the editor recomputes available
quantities and refuses stale allocations. Lots do not reserve inventory.

Migration `059_camp_equipment_lots.sql` creates `camp_lots.view` and
`camp_lots.manage`. Administrators explicitly grant them; the existing district
trigger retains its normal behavior. Managing lots also requires `tasks.manage`.
Personal access requires `tasks.view`. Demo accounts cannot write. The unit always
comes from authentication; foreign resources return 404.

Each duty links to a shared task, the single source of assignee, due date and
progress. Preparation/transport use the first camp day; return uses the last.
Generic task writes reject linked tasks with `camp_lot_task_managed` (409).
`equipment_lot_id` and `equipment_lot_role` make navigation explicit.

Content can be edited only in `to_prepare`. Allowed states are
`to_prepare ↔ loaded ↔ returned`; managers can correct mistakes. Personal actions
load or return according to the matching duty (falling back to the preparer) and do
not reset preparation. Loading completes preparation/transport; returning completes
all duties. Reopening derives their matching progress, in the same transaction.
Cancelled camps reject writes. Deletion/archiving of individual lots is outside this
version; no destructive lot action is exposed.

## API

Every path below `/api/v1/camp-equipment-lots` requires authentication.

| Method and path | Permission | Result |
| --- | --- | --- |
| GET `/meetings/:meetingId` | `camp_lots.view` | Unit lots, articles, duties and confirmed history |
| GET `/meetings/:meetingId/options` | Both manage keys | Current articles, allocations and active member id/name choices |
| POST `/meetings/:meetingId` | Both manage keys | Create a lot and its tasks atomically |
| PUT `/meetings/:meetingId/:id` | Both manage keys | Replace preparation-lot content and assignments |
| GET `/mine` | `tasks.view` | Only assigned lots |
| GET `/mine/meetings/:meetingId` | `tasks.view` | Only assigned lots of this camp |
| PATCH `/mine/:id/status` | `tasks.view` + duty ownership | Load or return an assigned lot |
| PATCH `/:id/status` | Both manage keys | Move a unit lot to an adjacent state |

Create: `name` (1–150 characters), UUID v4 `creation_key`, nonempty `items` in the
shared `{catalog_item_id, quantity}` / `{equipment_item_id, quantity}` format, and
unique `roles`, including `{role: "prepare", user_id: "<active member UUID>"}`.
Replace takes the same content plus positive integer `expected_version`.

State writes take `status`, `expected_version` and UUID v4 `mutation_id`; an optional
`previous_mutation_id` identifies a preceding pending change. The client's
`meeting_id` locates its device snapshot only; the server resolves and authorizes
the actual camp from the unit-scoped lot, never trusting this client metadata.

## Device preparation and honest feedback

Opening a lot page online downloads only its permitted lots and stores them in
IndexedDB. Task-only helpers can prepare from their own task link; they never need
the unit's youth/health preparation endpoint. Full camp preparation also includes
packs for its linked planned camps, filtered by current lot/task permissions.

The page verifies the worker's cached application, translations and retained HTML
before announcing that these lots are available offline. It explicitly says this
is readiness of the **lots** on **this device**, not all camp records. Refresh/check
retries preparation. A snapshot has a schema, account/unit/year scope and expiration;
a legacy flag, missing data/assets or another account's preparation cannot enable
queueing. Storage failure never claims successful preparation. Lot content and
assignment edits require a connection; only prepared state writes enter the outbox.

Pending states are derived from the shared token-free outbox and labelled awaiting
upload. They survive navigation and a full offline reload without being inserted
into confirmed history. A queued response is never reported as server-confirmed.
Success/rejection events refresh the page, including events relayed from another
tab. A refused change stays visible and offers the current server result for review.

## Concurrency, chained retries and replay

Camp rows lock before lot/task rows, serializing allocations and committing lot,
task and history together. Stale versions/invalid transitions return 409 with no
partial change. Retrying a create with the same key and identical content returns
the lot; different content with that key conflicts.

State receipt keys are scoped to unit and actor. Body `mutation_id` and the outbox's
`Idempotency-Key` stay identical from first send through every retry, including a
lost first response. Repeating a mutation returns its original result without
repeating history. Ownership is checked before returning a personal receipt.

Successive pending writes name their preceding receipt and expected version. The
server verifies that receipt committed this lot at that version before applying the
next state. A refused earlier change therefore cannot accidentally validate a later
one merely because someone else's edit produced the same version number.

A confirmed replay updates retained lot snapshots even with the page closed, keeps
the original expiry and never replaces a newer version with an older receipt.
Derived task reads are invalidated through the scoped cache helper. A permanent
refusal removes that camp's prepared copies, preserving other camps and accounts;
temporary failures retain the original request for retry. The ordinary shared
outbox lock and cross-tab broadcasts still own replay.

## Verification

- jsdom/axe: cards, combined editor, focus/keyboard behavior, safe names, pending
  feedback, retained input, permissions and late-response guards.
- Real IndexedDB implementation under fake-indexeddb: snapshot/scope/assets checks,
  pending reloads, network-error fallback, retained receipts and closed-page replay.
- Disposable PostgreSQL: roles, tenant isolation, active assignees, allocations,
  concurrent edits, chained receipts, rollback and full-camp pack permissions.
- Seeded browser accessibility: both lot routes at 390 px and desktop size.
- Real built PWA: service worker, offline shell reload, two ordered state changes,
  exact-once replay and explicit refusal without prepared lots. This suite uses the
  run-wampums seeded API and `npx vite preview --host 127.0.0.1 --port 4173` after
  `npm run build`; run `npx playwright test --config playwright.offline.config.mjs`.
  CI runs it separately from the development-server accessibility suite and retains
  fictional phone/desktop previews as `camp-lots-previews`.
