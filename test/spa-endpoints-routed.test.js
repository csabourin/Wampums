/**
 * Every endpoint the SPA names must be a route the server mounts, for the
 * method it uses. A call to a route that does not exist fails for everyone,
 * and screen tests, which mock the API, cannot notice.
 */
const fs = require('fs');
const path = require('path');
const { closeServerResources } = require('./test-helpers');

jest.mock('pg', () => {
  const mPool = { connect: jest.fn(), query: jest.fn(), on: jest.fn() };
  return { Pool: jest.fn(() => mPool), __esModule: true };
});

const ROOT = path.join(__dirname, '..');
const METHODS = { get: 'GET', getNoCache: 'GET', post: 'POST', put: 'PUT', patch: 'PATCH', delete: 'DELETE' };
/** `API.<method>('<endpoint>'` with a literal or template endpoint. */
const API_CALL = /\bAPI\.(get|getNoCache|post|put|patch|delete)\(\s*(['`])([^'`]*)\2/g;

let app;

beforeAll(() => {
  process.env.JWT_SECRET_KEY = 'spa-endpoints-routed';
  app = require('../api');
});

afterAll((done) => {
  closeServerResources(app, done);
});

/** Every route layer, with the router layers it is mounted under. */
function mountedRoutes() {
  const routes = [];
  const walk = (stack, mounts) => {
    for (const layer of stack) {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach((method) => routes.push({ method: method.toUpperCase(), mounts, layer }));
      } else if (layer.handle && layer.handle.stack) {
        walk(layer.handle.stack, [...mounts, layer]);
      }
    }
  };
  walk((app.router || app._router).stack, []);
  return routes;
}

function isRouted(routes, method, url) {
  return routes.some(({ method: routeMethod, mounts, layer }) => {
    if (routeMethod !== method) {return false;}
    let rest = url;
    for (const mount of mounts) {
      if (!mount.match(rest)) {return false;}
      rest = rest.slice(mount.path.length) || '/';
    }
    return layer.match(rest);
  });
}

function spaFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {return spaFiles(file);}
    return file.endsWith('.js') ? [file] : [];
  });
}

test('every API endpoint the SPA calls is mounted on the server for that method', () => {
  const routes = mountedRoutes();
  const unrouted = [];
  for (const file of spaFiles(path.join(ROOT, 'spa'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [, verb, , endpoint] of source.matchAll(API_CALL)) {
      if (!/^(v1|public|api)\//.test(endpoint)) {continue;}
      // A template's ${…} stands for one path segment.
      const url = (endpoint.startsWith('v1/') ? `/api/${endpoint}` : `/${endpoint}`)
        .replace(/\$\{[^}]*\}/g, '1')
        .split('?')[0];
      if (!isRouted(routes, METHODS[verb], url)) {
        unrouted.push(`${path.relative(ROOT, file)}: ${METHODS[verb]} ${url}`);
      }
    }
  }
  expect(routes.length).toBeGreaterThan(0);
  expect(unrouted).toEqual([]);
});
