/**
 * Public pages of the wampums.app marketing site.
 *
 * The sitemap and IndexNow submissions both read this list, so a page added
 * here is listed for crawlers and announced to search engines alike. Each
 * entry pairs the English and French paths of one page; the files live under
 * `landing/` at `<path>index.html`, except the blog listings, which are
 * rendered from `content/blog/`.
 *
 * @module config/landing-pages
 */

/** Hostnames that serve the marketing site rather than a unit's app */
const LANDING_HOSTS = new Set(['wampums.app', 'www.wampums.app']);

/** Base URL for all canonical links */
const LANDING_BASE_URL = 'https://wampums.app';

/** Blog listing paths, rendered by the server rather than read from `landing/`. */
const BLOG_INDEX_PATHS = { en: '/en/blog/', fr: '/fr/blogue/' };

const LANDING_STATIC_PAGES = [
  { en: '/en/', fr: '/fr/', freq: 'weekly', pri: '1.0' },
  { en: '/en/features/attendance/', fr: '/fr/fonctionnalites/presences/', freq: 'monthly', pri: '0.8' },
  { en: '/en/features/badges/', fr: '/fr/fonctionnalites/badges/', freq: 'monthly', pri: '0.8' },
  { en: '/en/features/communication/', fr: '/fr/fonctionnalites/communication/', freq: 'monthly', pri: '0.8' },
  { en: '/en/features/finance/', fr: '/fr/fonctionnalites/finances/', freq: 'monthly', pri: '0.8' },
  { en: '/en/features/forms/', fr: '/fr/fonctionnalites/formulaires/', freq: 'monthly', pri: '0.8' },
  { en: '/en/features/logistics/', fr: '/fr/fonctionnalites/logistique/', freq: 'monthly', pri: '0.8' },
  { en: '/en/modules/finance/', fr: '/fr/modules/finance/', freq: 'monthly', pri: '0.7' },
  { en: '/en/modules/carpool/', fr: '/fr/modules/carpool/', freq: 'monthly', pri: '0.7' },
  { en: '/en/modules/on-site/', fr: '/fr/modules/on-site/', freq: 'monthly', pri: '0.7' },
  { en: '/en/modules/offline/', fr: '/fr/modules/offline/', freq: 'monthly', pri: '0.7' },
  { en: '/en/modules/medications/', fr: '/fr/modules/medications/', freq: 'monthly', pri: '0.7' },
  { en: '/en/modules/fundraising/', fr: '/fr/modules/fundraising/', freq: 'monthly', pri: '0.7' },
  { en: '/en/compare/wampums-vs-sporteasy/', fr: '/fr/comparer/wampums-vs-sporteasy/', freq: 'monthly', pri: '0.7' },
  { en: '/en/compare/wampums-vs-trooptrack/', fr: '/fr/comparer/wampums-vs-trooptrack/', freq: 'monthly', pri: '0.7' },
  { en: '/en/compare/wampums-vs-spreadsheets/', fr: '/fr/comparer/wampums-vs-tableurs/', freq: 'monthly', pri: '0.7' },
  { en: '/en/compare/wampums-vs-scoutbook/', fr: '/fr/comparer/wampums-vs-scoutbook/', freq: 'monthly', pri: '0.7' },
  { en: '/en/compare/wampums-vs-scouts-digital/', fr: '/fr/comparer/wampums-vs-scouts-digital/', freq: 'monthly', pri: '0.7' },
  { en: BLOG_INDEX_PATHS.en, fr: BLOG_INDEX_PATHS.fr, freq: 'weekly', pri: '0.8' },
  { en: '/en/faq/', fr: '/fr/faq/', freq: 'monthly', pri: '0.6' },
  { en: '/en/privacy/', fr: '/fr/confidentialite/', freq: 'yearly', pri: '0.3' },
];

module.exports = { LANDING_HOSTS, LANDING_BASE_URL, BLOG_INDEX_PATHS, LANDING_STATIC_PAGES };
