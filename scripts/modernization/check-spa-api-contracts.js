#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repositoryRoot = process.cwd();
const registrySource = fs.readFileSync(path.join(repositoryRoot, 'routes', 'index.js'), 'utf8');
const contracts = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'config', 'spa-api-contracts.json'), 'utf8')
);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const failures = [];
for (const contract of contracts) {
  const routeSource = fs.readFileSync(path.join(repositoryRoot, contract.routeFile), 'utf8');
  const method = contract.method.toLowerCase();
  const routePattern = new RegExp(
    `router\\.${method}\\(\\s*['\"]${escapeRegExp(contract.routePath)}['\"]`,
    'm'
  );

  if (!routePattern.test(routeSource)) {
    failures.push(`${contract.method} ${contract.path}: missing ${contract.routeFile} route ${contract.routePath}`);
  }

  const mountPattern = new RegExp(
    `app\\.use\\(\\s*['\"][^'\"]+['\"]\\s*,\\s*${escapeRegExp(contract.routerVariable)}\\s*\\)`
  );
  if (!mountPattern.test(registrySource)) {
    failures.push(`${contract.method} ${contract.path}: ${contract.routerVariable} is not mounted in routes/index.js`);
  }

  if (contract.clientFile && contract.clientEndpoint) {
    const clientSource = fs.readFileSync(path.join(repositoryRoot, contract.clientFile), 'utf8');
    if (!clientSource.includes(contract.clientEndpoint)) {
      failures.push(`${contract.method} ${contract.path}: client endpoint missing from ${contract.clientFile}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exit(1);
}

process.stdout.write(`SPA/API contract inventory passed (${contracts.length} contracts)\n`);
