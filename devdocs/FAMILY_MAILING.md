# Family mailing recipients and confirmation

## Current families and former families

Family announcements use parent/family account addresses and guardian contacts
linked to participants actively enrolled in the unit's active scout year.
Retained contact records, last year's enrollment or an active parent login
alone do not qualify a former family. A chosen den must contain the same
currently enrolled child; an older child in that den cannot qualify a parent
whose current child is elsewhere. Selected active staff roles remain eligible
independently of having children. Push and WhatsApp use the same account filter.
The copyable report follows its selected year's roster. These checks happen
again at dispatch time for scheduled messages. Alumni remain a separate,
explicit audience of consenting former families.

A participant's own form address is never added or used as a fallback for a
missing adult contact. An address independently recorded as an adult contact
remains eligible even if it also appears on a child's form. Addresses are
deduplicated.

## Confirmation after sending

An immediate announcement returns its final `status` and a `delivery` summary
for email, push, WhatsApp and Google Chat (`total`, `sent`, `failed`). Email
`sent` counts messages accepted by the mail transport, not confirmed inbox
delivery; a later bounce may still happen. Refused sends and transport errors
count as failures. No successful channel, including no recipients, means
`failed`; a mixture of successes and failures means `partial`.

The composer keeps a persistent, focused result beside the send button, with
email counts and a link to the communication history. It clears the form only
after confirmed email success or confirmed draft/schedule saving. Partial,
failed and unconfirmed email sends retain the text, formatting and recipients.
A lost response directs the leader to the history before another attempt.
Announcements and test sends require a connection and are never queued or
automatically replayed after a network error. A saved draft or schedule is
confirmed as saved, without claiming that an email has already been sent.
