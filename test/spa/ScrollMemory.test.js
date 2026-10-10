/**
 * @jest-environment jsdom
 */

/**
 * Each screen keeps its scroll position.
 *
 * Changing screens used to send the page to the top, animated by the smooth
 * scroll-behavior on <html>, and a live-sync redraw then scrolled back down.
 * A screen now reopens where it was left, without animation, and a screen
 * never visited starts at the top.
 */

jest.mock('../../spa/utils/DebugUtils.js', () => ({
  debugLog: jest.fn(),
  debugError: jest.fn(),
  debugWarn: jest.fn(),
  debugInfo: jest.fn()
}));

import {
  initScrollMemory,
  beginScrollNavigation,
  restoreScrollPosition,
  scrollKeyFor,
  syncScrollKey,
  resetScrollMemoryForTests
} from '../../spa/utils/ScrollMemory.js';

const PAGE_HEIGHT = 5000;
const VIEWPORT_HEIGHT = 800;

let scrollHeight = PAGE_HEIGHT;
let behaviorAtScroll = [];

function scrollWindow(y) {
  window.scrollY = y;
  window.dispatchEvent(new Event('scroll'));
}

beforeEach(() => {
  sessionStorage.clear();
  resetScrollMemoryForTests();
  scrollHeight = PAGE_HEIGHT;
  behaviorAtScroll = [];
  window.scrollY = 0;
  window.innerHeight = VIEWPORT_HEIGHT;
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight
  });
  window.scrollTo = jest.fn((_x, y) => {
    behaviorAtScroll.push(document.documentElement.style.scrollBehavior);
    window.scrollY = y;
  });
  window.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };
  document.documentElement.style.scrollBehavior = 'smooth';
  // jsdom has no scrollRestoration; browsers default it to 'auto'.
  history.scrollRestoration = 'auto';
  initScrollMemory();
});

// The router pushes the URL before it routes.
function go(path) {
  history.pushState(null, '', path);
  return beginScrollNavigation(path);
}

function visit(path) {
  history.pushState(null, '', path);
  const token = beginScrollNavigation(path);
  restoreScrollPosition(token);
}

describe('ScrollMemory', () => {
  test('takes scroll restoration over from the browser', () => {
    expect(history.scrollRestoration).toBe('manual');
  });

  test('a screen never visited opens at the top', () => {
    visit('/dashboard');
    scrollWindow(1200);

    visit('/attendance');

    expect(window.scrollY).toBe(0);
  });

  test('returning to a screen reopens it where it was left', () => {
    visit('/dashboard');
    scrollWindow(1200);
    visit('/attendance');
    scrollWindow(300);

    visit('/dashboard');
    expect(window.scrollY).toBe(1200);

    visit('/attendance');
    expect(window.scrollY).toBe(300);
  });

  test('redrawing the same screen keeps its position without jumping to the top', () => {
    visit('/finance?tab=reports');
    scrollWindow(900);
    window.scrollTo.mockClear();

    visit('/finance?tab=reports');

    expect(window.scrollY).toBe(900);
    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0);
  });

  test('each tab of a tabbed screen keeps its own position', () => {
    visit('/finance?tab=reports');
    scrollWindow(900);
    visit('/finance?tab=payments');

    expect(window.scrollY).toBe(0);
  });

  test('jumps are instant even with smooth scrolling on the page', () => {
    visit('/dashboard');
    scrollWindow(1200);
    visit('/attendance');
    visit('/dashboard');

    expect(behaviorAtScroll.length).toBeGreaterThan(0);
    behaviorAtScroll.forEach((behavior) => expect(behavior).toBe('auto'));
    expect(document.documentElement.style.scrollBehavior).toBe('smooth');
  });

  test('scrolling caused by the screen swap is not recorded as the new position', () => {
    visit('/dashboard');
    scrollWindow(1200);

    const token = go('/attendance');
    // Old content removed: the browser clamps and fires scroll events.
    scrollWindow(40);
    restoreScrollPosition(token);
    visit('/dashboard');
    visit('/attendance');

    expect(window.scrollY).toBe(0);
  });

  test('a navigation superseded by a newer one does not restore', () => {
    visit('/dashboard');
    scrollWindow(1200);
    visit('/attendance');

    const stale = go('/dashboard');
    const current = go('/attendance');
    restoreScrollPosition(stale);
    expect(window.scrollY).toBe(0);
    restoreScrollPosition(current);
    expect(window.scrollY).toBe(0);
  });

  test('stops restoring once the person scrolls themselves', () => {
    visit('/dashboard');
    scrollWindow(3000);
    visit('/attendance');

    // The dashboard renders short first, then grows as data arrives.
    scrollHeight = VIEWPORT_HEIGHT;
    const token = go('/dashboard');
    restoreScrollPosition(token);
    window.dispatchEvent(new Event('wheel'));
    scrollWindow(100);

    visit('/attendance');
    visit('/dashboard');
    expect(window.scrollY).toBe(100);
  });

  test('positions survive a reload of the tab', () => {
    visit('/dashboard');
    scrollWindow(1200);
    visit('/attendance');

    resetScrollMemoryForTests();
    initScrollMemory();
    visit('/dashboard');

    expect(window.scrollY).toBe(1200);
  });

  test('switching tabs in place does not overwrite the previous tab', () => {
    visit('/finance?tab=reports');
    scrollWindow(900);

    // TabbedPage rewrites ?tab= without going through the router.
    history.replaceState({}, '', '/finance?tab=payments');
    syncScrollKey();
    scrollWindow(150);

    visit('/dashboard');
    visit('/finance?tab=reports');
    expect(window.scrollY).toBe(900);
    visit('/finance?tab=payments');
    expect(window.scrollY).toBe(150);
  });

  test('a redraw after an in-place tab switch keeps the position', () => {
    visit('/finance?tab=reports');
    scrollWindow(900);
    history.replaceState({}, '', '/finance?tab=payments');
    syncScrollKey();
    window.scrollTo.mockClear();

    visit('/finance?tab=payments');

    expect(window.scrollTo).not.toHaveBeenCalledWith(0, 0);
    expect(window.scrollY).toBe(900);
  });

  test('a redirect during the route restores the screen actually shown', () => {
    visit('/participants');
    scrollWindow(1500);
    visit('/dashboard');

    // Session expired: the router sends the private screen to /login.
    const token = go('/participants');
    history.pushState(null, '', '/login');
    restoreScrollPosition(token);
    expect(window.scrollY).toBe(0);

    visit('/dashboard');
    visit('/participants');
    expect(window.scrollY).toBe(1500);
  });

  test('ignores the hash when identifying a screen', () => {
    expect(scrollKeyFor('/help?topic=a#faq')).toBe('/help?topic=a');
    expect(scrollKeyFor(null)).toBeNull();
  });
});
