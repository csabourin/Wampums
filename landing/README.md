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
