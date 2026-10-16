/**
 * Installing the web app.
 *
 * Chrome, Edge and Samsung Internet fire `beforeinstallprompt` once per page
 * load, early, and only to a listener already in place. It is caught here when
 * the app starts, so a screen opened much later (the parent dashboard, after
 * sign-in and its data) can still offer the browser's own install prompt.
 * Safari and Firefox never fire it; there, and once a prompt has been used,
 * people install from the browser's menu, which `installPlatform()` helps
 * explain.
 *
 * The browser's own banner is not suppressed: where it still appears, it is one
 * more way in.
 *
 * @module spa/utils/InstallPromptUtils
 */

/** Dispatched on window whenever an install prompt becomes available or the app is installed. */
export const INSTALL_AVAILABILITY_EVENT = 'wampums:install-availability';

let deferredPrompt = null;
let installed = false;
let started = false;

/** Tell open screens that what can be offered has changed. */
function notify() {
  window.dispatchEvent(new CustomEvent(INSTALL_AVAILABILITY_EVENT, {
    detail: { canPrompt: deferredPrompt !== null, installed },
  }));
}

/**
 * Start listening for the browser's install prompt. Call once, as the app
 * starts; later calls do nothing.
 *
 * @returns {() => void} Stops listening (for tests; the app listens for its whole life)
 */
export function startInstallPromptCapture() {
  if (started || typeof window === 'undefined') {
    return () => {};
  }
  started = true;
  const onPrompt = (event) => {
    deferredPrompt = event;
    notify();
  };
  const onInstalled = () => {
    installed = true;
    deferredPrompt = null;
    notify();
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    started = false;
  };
}

/**
 * Whether the app is already installed and running as one, or was installed
 * from this page.
 *
 * @returns {boolean}
 */
export function isAppInstalled() {
  if (installed) {
    return true;
  }
  const standalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  // iOS reports a home-screen app through navigator.standalone
  return Boolean(standalone || window.navigator.standalone === true);
}

/**
 * Whether the browser's own install prompt can be shown now.
 *
 * @returns {boolean}
 */
export function canPromptInstall() {
  return deferredPrompt !== null;
}

/**
 * Show the browser's install prompt. A prompt can be shown only once: after
 * this, installing goes through the browser's menu until the browser offers a
 * new prompt.
 *
 * @returns {Promise<'accepted'|'dismissed'|'unavailable'>} What the person chose
 */
export async function requestInstall() {
  const promptEvent = deferredPrompt;
  if (!promptEvent) {
    return 'unavailable';
  }
  deferredPrompt = null;
  notify();
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (_error) {
    // Already used, or refused by the browser
    return 'unavailable';
  }
}

/**
 * The kind of device, to explain how its browser installs an app.
 *
 * @param {Navigator} [nav] - Defaults to the browser's navigator
 * @returns {'ios'|'android'|'desktop'}
 */
export function installPlatform(nav = window.navigator) {
  const userAgent = nav.userAgent || '';
  // iPadOS reports itself as a Mac, but a Mac has no touch screen
  const touchPoints = Number(nav.maxTouchPoints) || 0;
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) {
    return 'ios';
  }
  if (/Android/i.test(userAgent)) {
    return 'android';
  }
  return 'desktop';
}

/**
 * Be told when an install prompt becomes available or the app is installed.
 *
 * @param {(state: {canPrompt: boolean, installed: boolean}) => void} callback
 * @returns {() => void} Stops listening
 */
export function onInstallAvailabilityChange(callback) {
  const listener = (event) => callback(event.detail);
  window.addEventListener(INSTALL_AVAILABILITY_EVENT, listener);
  return () => window.removeEventListener(INSTALL_AVAILABILITY_EVENT, listener);
}
