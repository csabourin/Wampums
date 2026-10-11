/**
 * Run the real notification click handler with browser clients stubbed.
 * Static pages share the SPA's origin but have no SPA navigation listener.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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
    URL, clients, debugError: jest.fn(),
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
