# Landing analytics

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
