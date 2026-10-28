/** Real socket failures reproduce the transport error that blocked main's deploy. */
import { createServer } from 'node:http';
import { test, expect } from '@playwright/test';
import { LANDING_ORIGIN, fetchLocalLanding } from './local-landing.mjs';

let server;
let localApi;

test.afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** Start an isolated HTTP server; no app database or production request is used. */
async function startServer(handler) {
  server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  localApi = `http://127.0.0.1:${server.address().port}`;
}

test('a reset image connection is retried locally with its public host and query intact', async ({ request }) => {
  const received = [];
  await startServer((req, res) => {
    received.push({ host: req.headers.host, path: req.url });
    if (received.length === 1) {
      req.socket.destroy();
      return;
    }
    res.end('image bytes');
  });

  const response = await fetchLocalLanding(request, `${LANDING_ORIGIN}/images/screenshots/announcement-fr.webp?v=1`, localApi);
  expect(await response.text()).toBe('image bytes');
  expect(received).toEqual([
    { host: 'wampums.app', path: '/images/screenshots/announcement-fr.webp?v=1' },
    { host: 'wampums.app', path: '/images/screenshots/announcement-fr.webp?v=1' },
  ]);
});

test('a missing public resource stays a visible HTTP failure without retries', async ({ request }) => {
  let requests = 0;
  await startServer((_req, res) => {
    requests += 1;
    res.writeHead(404);
    res.end('missing');
  });

  const response = await fetchLocalLanding(request, `${LANDING_ORIGIN}/missing.webp`, localApi);
  expect(response.status()).toBe(404);
  expect(requests).toBe(1);
});

test('a persistently reset connection fails after the bounded retries', async ({ request }) => {
  let requests = 0;
  await startServer((req) => {
    requests += 1;
    req.socket.destroy();
  });

  await expect(fetchLocalLanding(request, `${LANDING_ORIGIN}/broken.webp`, localApi)).rejects.toThrow(/ECONNRESET|socket hang up/);
  expect(requests).toBe(3);
});
