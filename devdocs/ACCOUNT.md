# My account: tasks, not one long settings form

`/account-info` stays the account destination. `spa/config/account-sections.js` declares four task
areas; a parent-only account receives three, without the adult health/certification area:

| Section key | Tasks |
|---|---|
| `profile` | Name, nickname where applicable, personal phone, optional emergency contact and camp-sharing consent; parent contact details in their own disclosure. |
| `health` | Private adult health/allergy declarations and certifications, grouped into two disclosures. |
| `preferences` | Interface language, time format, notifications and private calendar subscription. |
| `security` | Change sign-in email or password, each behind its own disclosure. |

Logout is available in the page header whatever the active section. Each form names what its Save
button records; saving one does not imply that another form has been saved. Names and emergency
contacts remain subject to the existing API, membership and demo restrictions. No permission or
schema changes.

## Navigation and state

Navigation uses ordinary links with `aria-current`, not an incomplete ARIA tab pattern. Mobile shows
all task choices in a wrapping grid; desktop places the same navigation beside the active task.
`?section=` deep-links a task. Existing `#my-profile`, `#my-health`, `#my-allergies`, `#certifications`
and `#calendar-feed` links select their task, open containing disclosures and focus their heading.
Unavailable or unknown sections fall back to Profile.

Switching sections hides existing DOM nodes, preserving unsaved fields, the current save and open
disclosures. Optional panels load only when their task is first opened. Notification subscription
checks no longer delay the contact page. Changing the interface language preserves field values and
disclosure state in the page instance only; drafts are never stored in localStorage/IndexedDB and are
released on destroy. Saving the account or guardian name updates the affected identity controls in
place. A delayed initial answer cannot redraw a page that has been left. Loading failures offer retry.

`ProfilePanel({compact: true})` keeps the phone visible and puts optional emergency and sharing fields
in native details elements. These fields still exist in the same form and have the same save contract;
collapsing them never clears values or withdraws consent.

## Verification

`test/spa/AccountNavigation.test.js`: task gates, direct links, lazy mounts, focus, unchanged form nodes
and drafts on section switches, language redraw, identity saves, escaping and axe.
`AccountCalendarSection.test.js` covers on-demand calendar mounting. Existing nickname, language and
profile-panel suites remain applicable. Browser tests cover all task areas, direct links and drafts at
phone and desktop sizes; screenshots use fictional accounts only.
