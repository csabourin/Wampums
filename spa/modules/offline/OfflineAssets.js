import { OFFLINE_CAMPS } from '../../config/offline-camps.js';

/** Ask the controlling worker to inspect its actual caches, including this tab's shell. */
export async function verifyOfflineAssets({ download = true } = {}) {
  const controller = navigator.serviceWorker?.controller;
  if (!controller || typeof MessageChannel === 'undefined') {
    return false;
  }
  const languages = ['en', 'fr'].map((language) => {
    const version = window.__wampumsLangVersions?.[language];
    return version ? `/lang/${language}.json?v=${version}` : `/lang/${language}.json`;
  });
  if (navigator.onLine && download) {
    try {
      const responses = await Promise.all(languages.map((url) => fetch(url)));
      if (responses.some((response) => !response.ok)) { return false; }
    } catch { return false; }
  }
  // A previous-build tab must verify its own entry script, not only the new worker's assets.
  const scripts = [...document.querySelectorAll('script[type="module"][src]')]
    .map((script) => script.src).filter((src) => new URL(src).origin === location.origin);
  const urls = [...languages, ...scripts];
  const ready = await requestAssetCheck(controller, urls);
  if (ready || !navigator.onLine || !download) { return ready; }
  // Workbox may finish its cache writes just after returning a downloaded response.
  await new Promise((resolve) => setTimeout(resolve, OFFLINE_CAMPS.ASSET_SETTLE_MS));
  return requestAssetCheck(controller, urls);
}

/** Inspect caches after outstanding worker writes have had a chance to settle. */
function requestAssetCheck(controller, urls) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ready) => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(ready);
    };
    const timeout = setTimeout(() => finish(false), OFFLINE_CAMPS.ASSET_CHECK_TIMEOUT_MS);
    channel.port1.onmessage = (event) => finish(event.data?.ready === true);
    try {
      controller.postMessage({ type: 'VERIFY_OFFLINE_ASSETS', urls }, [channel.port2]);
    } catch {
      finish(false);
    }
  });
}
