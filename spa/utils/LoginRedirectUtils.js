/**
 * Build a login URL retaining the protected destination. Initial app routing
 * omits the fragment for route matching, so recover it from the current URL
 * only when that URL describes the same destination.
 *
 * @param {string} path - Protected route being opened
 * @param {string} currentHref - Current browser URL
 * @returns {string} Login path and encoded return destination
 */
export function buildLoginRedirect(path, currentHref) {
  const current = new URL(currentHref);
  const target = new URL(path, current.origin);
  if (!target.hash && target.pathname === current.pathname && target.search === current.search) {
    target.hash = current.hash;
  }
  const destination = `${target.pathname}${target.search}${target.hash}`;
  return `/login?returnTo=${encodeURIComponent(destination)}`;
}
