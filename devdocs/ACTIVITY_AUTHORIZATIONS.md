# Activity permission requests

The shared SPA activity form owns the invitation, activity information and consent text. From the permission dashboard it starts with “Request parental permission” checked. Transport is optional for a new simple event; older activities retain their transport fields.

- **Create activity and send permission requests** saves the activity, creates missing requests for its currently enrolled invitees, then submits their emails. Children are selected once.
- **Save without sending** saves the activity and consent text only. It creates no permission requests and sends no mail. The activity is not a hidden draft.
- Preview creates and sends nothing. Family addresses are never returned by the unsaved preview endpoint, only counts and children missing contacts.
- The activity permission page puts durable sending results before the description. Requests, emails and guardian responses have separate counts. Individual management remains under Advanced management.

## API and persistence

Apply migration `058_activity_authorization_flow.sql` before the client/server. It is re-runnable and preserves existing activities and responses. Existing API callers keep the former transport requirement unless they explicitly send `transport_required: false`.

The SPA sends a stable `creation_key` (UUID v4) with each activity creation. An advisory transaction lock and a unique unit/key index serialize retries. Replaying the same normalized payload returns the existing activity; a changed payload using that key receives 409. Activity save and request issuance are two confirmed operations: a request failure keeps the saved activity, shows the outcome and links to that activity rather than creating it again.

`POST /api/v1/activity-authorizations/preview` resolves counts for an invitation (`activities.create` or `activities.edit`). `GET /api/v1/activity-authorizations/:id` rebuilds the activity result (`activities.edit`). `POST` on the same path creates missing requests and sends outstanding addresses (`activities.edit` and `communications.send`). The unit comes only from the authenticated session. Demo writes are refused.

Creation locks the activity and saves all new requests in one transaction. A conflicting request for a different activity on the same date causes 409 and rolls back the batch. Existing requests are reused; answered, archived, revoked and expired requests are never silently overwritten or reissued.

Recipients come from active enrollment in the unit's active scout year, intersected with the activity's invitation. Adult accounts must also have active unit membership. Guardian contacts and linked adult account addresses are trimmed, lowercased and deduplicated per child. A child's registration-form email is never a recipient. The audience is rechecked at sending time. Initial legacy sends and reminders also exclude former enrollments.

`permission_slip_deliveries` records initial sends per request signing token and normalized address. Explicitly reissuing an archived request rotates its token, invalidating the old signing link and starting a fresh delivery identity:

- `sending`: claim written before the transport call; another sender cannot claim it.
- `sent`: accepted by the email service, not proof of inbox delivery.
- `failed`: explicit rejection or unavailable transport; safe for an explicit retry.
- `unknown`: provider response lost or uncertain. Never automatically retried.

A claim whose final receipt could not be saved remains `sending` and is displayed as uncertain. A durable accepted receipt is kept even if the legacy `email_sent` update or the leader copy fails. Retrying targets unclaimed or failed addresses, preserving successful addresses and guardian responses. Earlier requests marked `email_sent` without address receipts are not resent; their address-level result is described as unavailable rather than fabricated.

Activities and permission mutations require a connection and cannot be placed into the offline replay queue. A lost browser response requires checking the durable result; it is never silently replayed.

## Validation

The delivery unit tests cover claims, rejections, provider uncertainty and receipt failures. PostgreSQL integration tests cover the current invitation/roster intersection, case-insensitive address deduplication, no youth address, request and activity idempotency, concurrent sends, targeted retries, preservation of answers, date conflicts, missing contacts and permission/unit isolation. SPA and real-browser tests cover the unified form, save-only, preview, partial and lost results, preserved text, focus, accessibility and phone layout. Browser tests replace transport results and never send real mail.
