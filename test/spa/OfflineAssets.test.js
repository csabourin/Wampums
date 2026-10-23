/** @jest-environment jsdom */
import { verifyOfflineAssets } from '../../spa/modules/offline/OfflineAssets.js';
const originalWorker = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const originalChannel = global.MessageChannel;
const originalFetch = global.fetch;
let controller;
beforeEach(() => {
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  controller = { postMessage: jest.fn((message, ports) => {
    ports[0].channel.port1.onmessage({ data: { ready: true } });
  }) };
  Object.defineProperty(navigator, 'serviceWorker', { value: { controller }, configurable: true });
  global.MessageChannel = class {
    constructor() { this.port1 = { close: jest.fn() }; this.port2 = { channel: this }; }
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  window.__wampumsLangVersions = { en: 'english', fr: 'french' };
});
afterEach(() => {
  if (originalWorker) { Object.defineProperty(navigator, 'serviceWorker', originalWorker); }
  else { delete navigator.serviceWorker; }
  delete navigator.onLine;
  global.MessageChannel = originalChannel;
  global.fetch = originalFetch;
  delete window.__wampumsLangVersions;
});

test('verification downloads this build translations before asking the worker to inspect the caches', async () => {
  expect(await verifyOfflineAssets()).toBe(true);
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/lang/en.json?v=english', '/lang/fr.json?v=french']);
  expect(controller.postMessage.mock.calls[0][0]).toMatchObject({ type: 'VERIFY_OFFLINE_ASSETS', urls: ['/lang/en.json?v=english', '/lang/fr.json?v=french'] });
});

test('the entry module is verified without requiring the optional online live-update script', async () => {
  document.head.innerHTML = '<script type="module" src="/assets/entry.js"></script><script src="/socket.io/socket.io.js"></script>';
  try {
    expect(await verifyOfflineAssets()).toBe(true);
    const { urls } = controller.postMessage.mock.calls[0][0];
    expect(urls).toContain(new URL('/assets/entry.js', location.origin).href);
    expect(urls.some((url) => url.includes('socket.io'))).toBe(false);
  } finally { document.head.innerHTML = ''; }
});

test('an offline device can verify existing assets without downloading anything', async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  expect(await verifyOfflineAssets()).toBe(true);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a device without a controlling worker cannot be declared ready', async () => {
  navigator.serviceWorker.controller = null;
  expect(await verifyOfflineAssets()).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
});
