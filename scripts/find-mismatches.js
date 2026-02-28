const fs = require('fs');
const app = require('../api'); // Assuming running from scripts/

const backendRoutes = new Set();

function extractRoutes(stack, prefix = '') {
    stack.forEach(middleware => {
        if (middleware.route) {
            let path = middleware.route.path;
            if (typeof path === 'string') {
                Object.keys(middleware.route.methods).forEach(method => {
                    backendRoutes.add(`${method.toUpperCase()} ${prefix}${path}`);
                });
            }
        } else if (middleware.name === 'router') {
            let newPrefix = prefix;
            if (middleware.regexp.source !== '^\\/?(?=\\/|$)') {
                const match = middleware.regexp.source.match(/\\\/(.*?)\\\//);
                // Better way to extract router path if available:
            }
            // Express doesn't strictly keep the original mount path in a clean way in compiled regex,
            // but let's try a workaround since we know the mount paths from routes/index.js
            extractRoutes(middleware.handle.stack, prefix);
        }
    });
}

// Since Express router regex parsing is unreliable, we'll just parse routes/index.js statically
const content = fs.readFileSync('../routes/index.js', 'utf8');
const mounts = [...content.matchAll(/app\.use\(['"]([^'"]+)['"],\s*([^)]+)\)/g)];

const routeFiles = {};
mounts.forEach(m => {
    const mountPath = m[1];
    const varName = m[2];
    routeFiles[varName] = mountPath;
});

// We'll read the imported files from content
const imports = [...content.matchAll(/const\s+([a-zA-Z0-9_]+)\s*=\s*require\(['"]\.\/([^'"]+)['"]\)/g)];

const endpoints = [];
imports.forEach(imp => {
    const varName = imp[1];
    let fileName = '../routes/' + imp[2];
    if (!fileName.endsWith('.js')) fileName += '.js';
    try {
        const fileContent = fs.readFileSync(fileName, 'utf8');
        const routeDefs = [...fileContent.matchAll(/router\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g)];
        const mountPath = routeFiles[varName];

        if (mountPath) {
            routeDefs.forEach(r => {
                let path = r[2];
                let fullPath = mountPath;
                if (mountPath === '/' && path.startsWith('/')) {
                    fullPath = path;
                } else if (mountPath !== '/') {
                    if (path === '/') path = '';
                    fullPath = mountPath + path;
                }
                endpoints.push(`${r[1].toUpperCase()} ${fullPath}`);
            });
        }
    } catch (e) { }
});

const spaContent = fs.readFileSync('../spa/api/api-endpoints.js', 'utf8');
const apiCalls = [...spaContent.matchAll(/API\.(get|post|put|delete|patch|getNoCache)\(\s*[`'"]([^`'"]+)[`'"]/g)];

const spaEndpoints = [];
apiCalls.forEach(call => {
    let method = call[1].toUpperCase();
    if (method === 'GETNOCACHE') method = 'GET';
    let path = call[2];

    if (path.startsWith('public/')) {
        path = '/' + path;
    } else if (path.startsWith('api/')) {
        path = '/' + path;
    } else if (path.startsWith('v1/')) {
        path = '/api/' + path;
    } else {
        path = '/api/v1/' + path;
    }

    spaEndpoints.push(`${method} ${path}`);
});

console.log('--- MISSING IN BACKEND ---'); // called by SPA but not in backend
spaEndpoints.forEach(spaE => {
    let found = false;
    // some basic matching because of path params like /:id vs /${id}
    const spaRegexStr = spaE.replace(/\$\{[^}]+\}/g, '[^/]+').replace(/\?/g, '\\?');
    const spaRegex = new RegExp('^' + spaRegexStr + '$');

    for (const be of endpoints) {
        const beRegexStr = be.replace(/:[a-zA-Z0-9_]+/g, '[^/]+').replace(/\?/g, '\\?');
        const beRegex = new RegExp('^' + beRegexStr + '$');

        if (beRegex.test(spaE.split(' ')[1]) && spaE.split(' ')[0] === be.split(' ')[0]) {
            found = true;
            break;
        }
        if (spaRegex.test(be.split(' ')[1]) && spaE.split(' ')[0] === be.split(' ')[0]) {
            found = true;
            break;
        }
    }

    if (!found && !spaE.includes('${')) {
        console.log(spaE);
    }
});

process.exit(0);
