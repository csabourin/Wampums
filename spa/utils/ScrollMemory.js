/**
 * Remembers where each screen was scrolled to.
 *
 * The router used to send every screen to the top before rendering it. With
 * `scroll-behavior: smooth` on <html>, that jump was animated, so changing
 * screens (or a live-sync redraw) visibly scrolled the page up and back down.
 *
 * Positions are kept per screen (path and query string) while the app is
 * open, so returning to a screen -- by a link, the back button or a redraw --
 * opens it where it was left. A screen never visited starts at the top.
 * Every jump is instant; the smooth behaviour is kept for in-page scrolling.
 */

const MAX_REMEMBERED_SCREENS = 50;

// Screens render their data after the route resolves, so the page may not be
// tall enough yet to reach the remembered position. Keep trying while the
// page grows, for at most this long.
const RESTORE_TIMEOUT_MS = 1500;

// Any of these means the person has started scrolling: stop restoring.
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

// Kept in memory only. Screen URLs can carry emailed-link credentials
// (/reset-password?token=…, /permission-slip/<token>), and nothing derived
// from them may reach browser storage.
let positions = new Map();
let activeKey = null;
let navigationToken = 0;
let restoring = false;
let activeSession = null;
// URL shown when the current route began, to tell whether it redirected.
let routeStartUrl = null;
let originalHistoryMethods = {};
let saveFrame = null;
let initialized = false;

/**
 * Screen identity for a route path: path and query string, without the hash.
 * @param {string} path - Route path, e.g. "/finance?tab=reports"
 * @returns {string|null} Key, or null for an unusable path
 */
export function scrollKeyFor(path) {
  if (!path || typeof path !== 'string') {
    return null;
  }
  return path.split('#')[0];
}

/**
 * Remembered position for a screen key.
 * @param {string|null} key - Screen key from scrollKeyFor
 * @returns {number} Offset in pixels, 0 when unknown
 */
function savedPositionFor(key) {
  return (key && positions.get(key)) || 0;
}

function rememberPosition(key, y) {
  if (!key) {
    return;
  }
  // Re-insert so the most recently used screens are kept when trimming.
  positions.delete(key);
  positions.set(key, Math.max(0, Math.round(y)));
  while (positions.size > MAX_REMEMBERED_SCREENS) {
    positions.delete(positions.keys().next().value);
  }
}

/**
 * Scroll the window without the smooth animation set on <html>.
 * `behavior: 'instant'` is not honoured everywhere, so the CSS is overridden
 * for the duration of the call instead.
 * @param {number} y - Vertical offset in pixels
 */
function jumpTo(y) {
  const root = document.documentElement;
  const previous = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  window.scrollTo(0, y);
  root.style.scrollBehavior = previous;
}

function currentLocationKey() {
  return scrollKeyFor(`${window.location.pathname}${window.location.search}`);
}

function onScroll() {
  if (restoring || saveFrame !== null) {
    return;
  }
  saveFrame = window.requestAnimationFrame(() => {
    saveFrame = null;
    if (!restoring) {
      // Read the URL rather than trusting activeKey: screens can change it
      // in place without going through the router.
      activeKey = currentLocationKey();
      rememberPosition(activeKey, window.scrollY);
    }
  });
}

/**
 * After a same-document URL change that no route followed (a tab rewriting
 * ?tab=), later scrolling belongs to the new URL. The page is left where it
 * is, so the tab bar the person just used stays under their finger.
 */
function adoptCurrentUrl() {
  if (!restoring) {
    activeKey = currentLocationKey();
    rememberPosition(activeKey, window.scrollY);
  }
}

/**
 * Watch pushState/replaceState, so every in-place URL change is seen without
 * each screen having to report it (TabbedPage, finance and budgets tabs all
 * rewrite the URL themselves).
 * @param {'pushState'|'replaceState'} method - History method to watch
 */
function trackHistoryMethod(method) {
  const original = history[method];
  originalHistoryMethods[method] = original;
  history[method] = (...args) => {
    // Record the screen being left under its own URL before it changes.
    if (!restoring) {
      rememberPosition(currentLocationKey(), window.scrollY);
    }
    const result = original.apply(history, args);
    // When the router changes the URL it starts a route synchronously, which
    // sets `restoring`; only an in-place change is adopted here.
    queueMicrotask(adoptCurrentUrl);
    return result;
  };
}

/**
 * Take over scroll restoration from the browser and start recording positions.
 * Safe to call more than once.
 */
export function initScrollMemory() {
  if (initialized) {
    return;
  }
  initialized = true;
  if ('scrollRestoration' in history) {
    // The browser would restore its own guess on back/forward, before the
    // screen has rendered, and then fight the position set here.
    history.scrollRestoration = 'manual';
  }
  trackHistoryMethod('pushState');
  trackHistoryMethod('replaceState');
  window.addEventListener('scroll', onScroll, { passive: true });
}

/**
 * Called when the router starts showing a screen. When the screen changes,
 * moves to the top at once so the old position is not carried over.
 * From here until the screen is restored, any scroll, key or touch input from
 * the person ends the restoration: their movement wins.
 * @param {string} path - Route path being shown
 * @returns {number} Token to pass to restoreScrollPosition
 */
export function beginScrollNavigation(path) {
  navigationToken += 1;
  const token = navigationToken;
  activeSession?.end();

  const key = scrollKeyFor(path);
  const sameScreen = key === activeKey;
  // Save the screen being left now: a scroll made in the last frame has not
  // been recorded yet, and on back/forward the URL already shows the
  // destination. activeKey still names the screen on display.
  if (activeKey && !restoring) {
    rememberPosition(activeKey, window.scrollY);
  }
  activeKey = key;
  routeStartUrl = currentLocationKey();
  restoring = true;

  const session = { token, observer: null, timer: null };
  session.end = () => {
    session.observer?.disconnect();
    clearTimeout(session.timer);
    USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, session.end, true));
    if (activeSession === session) {
      activeSession = null;
    }
    if (token === navigationToken) {
      restoring = false;
    }
  };
  USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, session.end, { capture: true, passive: true }));
  activeSession = session;

  if (!sameScreen) {
    jumpTo(0);
  }
  return token;
}

/**
 * Called once the router has rendered the screen: returns it to where it was
 * left, waiting for late content to make the page tall enough.
 * Ignored if another navigation has started since; skipped if the person has
 * already moved the page themselves.
 * @param {number} token - Value returned by beginScrollNavigation
 */
export function restoreScrollPosition(token) {
  if (token !== navigationToken) {
    return;
  }
  // The route may have redirected while rendering (an expired session sent
  // to /login): restore the screen actually shown, not the one requested.
  // A route started without changing the URL keeps the key it asked for.
  if (currentLocationKey() !== routeStartUrl) {
    activeKey = currentLocationKey();
  }
  const session = activeSession;
  if (!session || session.token !== token) {
    return;
  }
  const target = savedPositionFor(activeKey);
  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

  const attempt = () => {
    jumpTo(target);
    if (target <= 0 || maxScroll() >= target) {
      session.end();
    }
  };

  attempt();
  if (activeSession !== session) {
    return;
  }
  session.timer = setTimeout(session.end, RESTORE_TIMEOUT_MS);
  if (typeof ResizeObserver === 'function') {
    session.observer = new ResizeObserver(attempt);
    session.observer.observe(document.body);
  }
}

/**
 * Reset module state. Tests only.
 */
export function resetScrollMemoryForTests() {
  activeSession?.end();
  window.removeEventListener('scroll', onScroll);
  Object.entries(originalHistoryMethods).forEach(([method, original]) => {
    history[method] = original;
  });
  originalHistoryMethods = {};
  positions = new Map();
  activeKey = null;
  routeStartUrl = null;
  navigationToken = 0;
  restoring = false;
  saveFrame = null;
  initialized = false;
}
