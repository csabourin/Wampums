/**
 * Remembers where each screen was scrolled to.
 *
 * The router used to send every screen to the top before rendering it. With
 * `scroll-behavior: smooth` on <html>, that jump was animated, so changing
 * screens (or a live-sync redraw) visibly scrolled the page up and back down.
 *
 * Positions are kept per screen (path and query string) for the life of the
 * tab, so returning to a screen -- by a link, the back button or a redraw --
 * opens it where it was left. A screen never visited starts at the top.
 * Every jump is instant; the smooth behaviour is kept for in-page scrolling.
 */

import { debugWarn } from './DebugUtils.js';

const STORAGE_KEY = 'wampums:scroll-positions';
const MAX_REMEMBERED_SCREENS = 50;

// Screens render their data after the route resolves, so the page may not be
// tall enough yet to reach the remembered position. Keep trying while the
// page grows, for at most this long.
const RESTORE_TIMEOUT_MS = 1500;

// Any of these means the person has started scrolling: stop restoring.
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

let positions = null;
let activeKey = null;
let navigationToken = 0;
let restoring = false;
let cancelRestore = null;
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

function loadPositions() {
  if (positions) {
    return positions;
  }
  positions = new Map();
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
    if (Array.isArray(stored)) {
      stored.forEach(([key, y]) => {
        if (typeof key === 'string' && Number.isFinite(y)) {
          positions.set(key, y);
        }
      });
    }
  } catch (error) {
    debugWarn('ScrollMemory: stored positions unreadable', error);
  }
  return positions;
}

function persistPositions() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...loadPositions()]));
  } catch (error) {
    debugWarn('ScrollMemory: could not store positions', error);
  }
}

function rememberPosition(key, y) {
  if (!key) {
    return;
  }
  const map = loadPositions();
  // Re-insert so the most recently used screens are kept when trimming.
  map.delete(key);
  map.set(key, Math.max(0, Math.round(y)));
  while (map.size > MAX_REMEMBERED_SCREENS) {
    map.delete(map.keys().next().value);
  }
  persistPositions();
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

function onScroll() {
  if (restoring || saveFrame !== null) {
    return;
  }
  saveFrame = window.requestAnimationFrame(() => {
    saveFrame = null;
    if (!restoring) {
      rememberPosition(activeKey, window.scrollY);
    }
  });
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
  window.addEventListener('scroll', onScroll, { passive: true });
}

/**
 * Called when the router starts showing a screen.
 * Records where the previous screen was left and, when the screen changes,
 * moves to the top at once so the old position is not carried over.
 * @param {string} path - Route path being shown
 * @returns {number} Token to pass to restoreScrollPosition
 */
export function beginScrollNavigation(path) {
  navigationToken += 1;
  if (cancelRestore) {
    cancelRestore();
  }
  const key = scrollKeyFor(path);
  if (activeKey && !restoring) {
    rememberPosition(activeKey, window.scrollY);
  }
  const sameScreen = key === activeKey;
  activeKey = key;
  restoring = true;
  if (!sameScreen) {
    jumpTo(0);
  }
  return navigationToken;
}

/**
 * Called once the router has rendered the screen: returns it to where it was
 * left, waiting for late content to make the page tall enough.
 * Ignored if another navigation has started since.
 * @param {number} token - Value returned by beginScrollNavigation
 */
export function restoreScrollPosition(token) {
  if (token !== navigationToken) {
    return;
  }
  const target = loadPositions().get(activeKey) || 0;
  const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

  let observer = null;
  let timer = null;
  const finish = () => {
    observer?.disconnect();
    clearTimeout(timer);
    USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, finish, true));
    if (cancelRestore === finish) {
      cancelRestore = null;
    }
    if (token === navigationToken) {
      restoring = false;
    }
  };

  const attempt = () => {
    jumpTo(target);
    if (target <= 0 || maxScroll() >= target) {
      finish();
    }
  };

  attempt();
  if (!restoring) {
    return;
  }

  cancelRestore = finish;
  USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, finish, { capture: true, passive: true }));
  timer = setTimeout(finish, RESTORE_TIMEOUT_MS);
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(attempt);
    observer.observe(document.body);
  }
}

/**
 * Reset module state. Tests only.
 */
export function resetScrollMemoryForTests() {
  if (cancelRestore) {
    cancelRestore();
  }
  window.removeEventListener('scroll', onScroll);
  positions = null;
  activeKey = null;
  navigationToken = 0;
  restoring = false;
  saveFrame = null;
  initialized = false;
}
