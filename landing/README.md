# Landing metadata and analytics

Give each page a unique title shorter than 70 characters, including the Wampums
suffix. Lead with the page's specific topic in its own language.

Keep each page's meta description between 25 and 160 characters in both languages.
Static pages define it in their HTML; blog articles use the `description` field
in `content/blog/{en,fr}/`. Length checks cover the static pages and rendered articles.

The English and French home, feature, module, comparison and FAQ pages load the
Google Analytics tag for `G-T3TDD2WS36` in their document head. Blog listings and
articles use the same tag through `views/partials/head-seo.ejs`.

`landing/index.html` is a language redirect, so tracking starts on the destination
page. The authenticated app does not include this tag. `middleware/global.js`
allows the Google Analytics script and collection sources in the Content Security
Policy only for `wampums.app` and `www.wampums.app`.
The allowed sources follow [Google's GA4 CSP guidance](https://developers.google.com/tag-platform/security/guides/csp#google_analytics_4_google_analytics).

When adding a landing page, include the tag once in its head. Coverage lives in
`test/landing-subpages.test.js` and `test/landing-host.test.js`.

`landing.js` sends three events so each page shows where visitors stop, all with
the page's `page_path`: `demo_dialog_open` when the demo dialog opens,
`generate_lead` (with `unit_size` and `current_tool`) when a request is accepted,
and `sample_unit_click` for links marked `data-track="sample_unit"`. A link marked
`data-track="x"` sends `x_click`.

## Demo request and sample unit

Every page header has a "Request a demo" button; it reads "Demo" below 640px.
The form asks only for a name and an email. The unit, phone, number of youth,
current tool and message are optional; the two menus send fixed values that
`POST /api/v1/public/contact-demo` checks against `DEMO_UNIT_SIZES` and
`DEMO_CURRENT_TOOLS` in `routes/public.js`. Keep the options identical in every
page's dialog and in `views/partials/footer.ejs`.

The sample unit is `https://demo.wampums.app`: a read-only unit that opens
without a password, as a parent or a leader (migration 039). The home hero and
every dialog link to it for visitors who would rather look first.

## Claims

Write only what the code does today, and nothing about other units' results
without a source. The Canadian Path is not preloaded; badges are set up with each
unit. Carpools: parents offer seats and place their own children; present it that
way, never as leaders dispatching rides (`carpools.manage` can place anyone, but
that is not how units use it). Each activity has its own carpool: there are no
recurring offers. The only carpool email is the cancellation notice when a
driver withdraws an offer. An announcement has one subject and one message, sent as written to every
recipient; the optional AI writing aid translates it in one click. The
interface, forms (one version per language), permission-slip emails and app
notifications follow each person's language. Reports export to CSV or print as PDF. There is no
app-store app.

Pricing: a single unit is free until at least 2028; an organization opening several
units (five or more, say) gets a negotiated monthly price.

Offline, only attendance, medication doses and receptions, and badges are queued
(`SAFE_OFFLINE_MUTATIONS` in `spa/modules/OfflineManager.js`); points, incidents,
carpools, equipment and messages need a connection. A camp prepared before leaving
keeps the youth list, attendance, medications and dose schedule, badges and
carpools on that phone for at least 10 days; health forms and parents' contact
details are not part of it. Medication reminders are server push notifications,
sent 15 minutes before a dose while an activity is running: they need a
connection, and the site presents them as an aid, never a guarantee. Nothing in
Wampums is an immutable log, and there are no read receipts.

Where a page says data is hosted in Quebec, it also says that emails go through
Brevo and links to the providers in the privacy policy. Never write that data
"stays" in Quebec.

A signed permission slip records the name the parent typed, the date and time,
and the slip's text and authorization. It records no IP address; do not claim one,
or a "legally equivalent" or certified signature.

Scouts Canada's own tools are MyScouts (registration) and ScoutsTracker (the
official badge tracker, provided by Dakemi Communications). "Scouts Digital" is
South African; its old comparison URLs redirect to `wampums-vs-scoutstracker`.

Each comparison page ends with an "About this comparison" card giving the date its
facts were checked and their sources. Check a fact at its source, and change the
date, before changing it. Write "we found no …" for what a source does not show,
never "X cannot …".

The admin (`/en/administrators/`, `/fr/administrateurs/`) and district
(`/en/districts/`, `/fr/districts/`) pages show the `reports` and `district`
screenshots, taken by `site-screenshots/take.sh`.

## Cookie consent

Every static page and the shared blog head load `/consent.js` synchronously before
the Google tag. It queues Consent Mode v2 defaults denying `analytics_storage`,
`ad_storage`, `ad_user_data` and `ad_personalization` before any Analytics config.
An explicit choice enables only analytics storage; advertising stays denied.

The English/French banner offers equally styled accept and reject controls.
Visitors can change their choice through the footer's cookie settings button.
The preference is stored on the current origin in local storage for 180 days;
invalid, expired or unavailable storage defaults to denied. Changes synchronize
between open tabs. Withdrawal also removes first-party `_ga` and `_ga_*` cookies
at the root path, leaving other cookies intact.

This implements [Google's advanced consent mode](https://developers.google.com/tag-platform/security/guides/consent?consentmode=advanced&hl=fr):
the Google tag loads even without consent and may send cookieless measurements.
The banner explains this behavior. It sits in the document flow rather than
covering page controls. Without JavaScript, Google Analytics does not execute.

Behavior and jsdom accessibility checks live in `test/landing-consent.test.js`.
`e2e/landing-consent.spec.mjs` checks phone/desktop keyboard access, contrast,
navigation, persistence and withdrawal against the local run-wampums server.

## IndexNow

`services/indexNow.js` tells Bing, Yandex and the other IndexNow engines which
pages changed. Search engines verify the key by fetching
`/16bc5aa95cae4d73b2c325ef6dc31f8b.txt`, which must contain `INDEXNOW.KEY` from
`config/constants.js`.

It runs two minutes after the server starts, which is after each deploy, and
after `POST /api/blog/refresh`. It runs only where `INDEXNOW_ENABLED=true`: set
it in production's `/opt/wampums/app.env` on the OVH VPS, never in development.

Each page in `config/landing-pages.js` (the list the sitemap also reads) and each
blog article is fingerprinted from its title, meta description, image `alt` text
and visible text. Markup, classes, styles and scripts do not count, so a
layout-only or tracking change submits nothing. Submitted are new pages, pages
whose fingerprint changed, and pages that left the site. A page sent less than
five minutes ago waits for the window, then goes out on an automatic retry.

What was sent lives in `indexnow_submissions` (migration 040). A rate limit (429)
or network failure records nothing and retries up to three times; so does a
sync that finds another one running, 30 seconds later, with the newer content. Any other
refusal is logged as an error and waits for the next deploy. Each submission is
logged with its HTTP status and URLs under `[IndexNow]`. Coverage lives in
`test/indexnow.test.js`.

## Privacy policy

The policy lives at `/fr/confidentialite/` and `/en/privacy/`, linked from every
footer (static pages and `views/partials/footer.ejs`). The app shell's
`assets/politique-de-confidentialite.html` only forwards to it.

Any page describing hosting, security or outside services must agree with the
policy: data in Quebec (OVHcloud, Beauharnois), HTTPS, encrypted backups,
role-based access and erasure on request. Online payment is not turned on.
Do not claim encryption at rest, retention settings, access logging or
"PIPEDA/Law 25 compliance"; the code provides none of them. Update the policy's
date when its content changes.
