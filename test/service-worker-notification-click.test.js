/**
 * Run the real notification click handler with browser clients stubbed.
 * Static pages share the SPA's origin but have no SPA navigation listener.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class TestMessageChannel {
  constructor() {
    this.port1 = { close: jest.fn(), onmessage: null };
    this.port2 = {
      close: jest.fn(),
      postMessage: (data) => this.port1.onmessage?.({ data }),
    };
  }
}

function loadHandler(windows) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src-sw.js'), 'utf8');
  const start = source.indexOf('function notificationTarget');
  const end = source.indexOf('// Section 8:', start);
  let handler;
  const clients = {
    matchAll: jest.fn().mockResolvedValue(windows),
    openWindow: jest.fn().mockResolvedValue(),
  };
  vm.runInNewContext(source.slice(start, end), {
    URL, clients, MessageChannel: TestMessageChannel, setTimeout, clearTimeout, debugError: jest.fn(),
    self: {
      location: { origin: 'https://wampums.app' },
      addEventListener: (_type, callback) => { handler = callback; },
    },
  });
  return {
    clients,
    async click(url) {
      let completion;
      const close = jest.fn();
      handler({ notification: { close, data: { url } }, waitUntil: (promise) => { completion = promise; } });
      await completion;
      expect(close).toHaveBeenCalled();
    },
  };
}

test.each(['/fr/politique-de-confidentialite', '/dashboard'])('navigates an existing %s window without relying on SPA readiness', async (pathname) => {
  const focus = jest.fn().mockResolvedValue();
  const navigate = jest.fn().mockResolvedValue({ focus });
  const { clients, click } = loadHandler([{ url: `https://wampums.app${pathname}`, navigate }]);
  await click('/messages/42');
  expect(navigate).toHaveBeenCalledWith('https://wampums.app/messages/42');
  expect(focus).toHaveBeenCalled();
  expect(clients.openWindow).not.toHaveBeenCalled();
});

test('a ready offline SPA routes in place and keeps its working document', async () => {
  const focus = jest.fn().mockResolvedValue();
  const navigate = jest.fn().mockRejectedValue(new Error('offline document is not cached'));
  const postMessage = jest.fn((_message, ports) => ports[0].postMessage({ navigated: true }));
  const { clients, click } = loadHandler([{ url: 'https://wampums.app/dashboard', navigate, postMessage, focus }]);
  await click('/messages/42?source=push#message-title');
  expect(postMessage.mock.calls[0][0]).toEqual({ type: 'NOTIFICATION_NAVIGATE', url: '/messages/42?source=push#message-title' });
  expect(focus).toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(clients.openWindow).not.toHaveBeenCalled();
});

test('a page that never acknowledges falls back to browser navigation', async () => {
  const focus = jest.fn().mockResolvedValue();
  const navigate = jest.fn().mockResolvedValue({ focus });
  const { click } = loadHandler([{ url: 'https://wampums.app/dashboard', navigate, postMessage: jest.fn() }]);
  await click('/messages/42');
  expect(navigate).toHaveBeenCalledWith('https://wampums.app/messages/42');
});

test('an open SPA is preferred even when a static page is the first window', async () => {
  const staticPage = { url: 'https://wampums.app/fr/privacy', navigate: jest.fn() };
  const spa = {
    url: 'https://wampums.app/dashboard', navigate: jest.fn(), focus: jest.fn().mockResolvedValue(),
    postMessage: jest.fn((_message, ports) => ports[0].postMessage({ navigated: true })),
  };
  const { clients, click } = loadHandler([staticPage, spa]);
  await click('/messages/42');
  expect(spa.focus).toHaveBeenCalled();
  expect(staticPage.navigate).not.toHaveBeenCalled();
  expect(spa.navigate).not.toHaveBeenCalled();
  expect(clients.openWindow).not.toHaveBeenCalled();
});

test('the real SPA listener acknowledges only when its router is ready', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'spa/app.js'), 'utf8');
  const start = source.indexOf("navigator.serviceWorker.addEventListener('message',");
  const end = source.indexOf('\n  });', start) + '\n  });'.length;
  let listener;
  const app = { router: null };
  vm.runInNewContext(source.slice(start, end), {
    app, navigator: { serviceWorker: { addEventListener: (_type, callback) => { listener = callback; } } },
  });
  const postMessage = jest.fn();
  const event = { data: { type: 'NOTIFICATION_NAVIGATE', url: '/messages/42' }, ports: [{ postMessage }] };
  listener(event);
  expect(postMessage).not.toHaveBeenCalled();
  app.router = { navigate: jest.fn() };
  listener(event);
  expect(app.router.navigate).toHaveBeenCalledWith('/messages/42');
  expect(postMessage).toHaveBeenCalledWith({ navigated: true });
  postMessage.mockClear();
  listener({ ...event, data: { type: 'NOTIFICATION_NAVIGATE', url: '//example.com/' } });
  expect(postMessage).not.toHaveBeenCalled();
});

test.each([null, new Error('window closed')])('opens a new window when existing window navigation fails: %s', async (result) => {
  const navigate = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
  const { clients, click } = loadHandler([{ url: 'https://wampums.app/dashboard', navigate }]);
  await click('/messages/42');
  expect(clients.openWindow).toHaveBeenCalledWith('https://wampums.app/messages/42');
});

test('opens the full message destination when no window exists', async () => {
  const { clients, click } = loadHandler([]);
  await click('/messages/42?source=push#message-title');
  expect(clients.openWindow).toHaveBeenCalledWith('https://wampums.app/messages/42?source=push#message-title');
});

test.each(['https://example.com/messages/42', 'http://[', undefined])('unsafe or invalid notification destination %s opens home', async (url) => {
  const { clients, click } = loadHandler([]);
  await click(url);
  expect(clients.openWindow).toHaveBeenCalledWith('https://wampums.app/');
});
