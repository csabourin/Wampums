const fs = require('fs');
const path = require('path');
const { baseDomain, storageDomain } = require('../config/unit_subdomains.json');

const deploymentFile = (name) => fs.readFileSync(path.join(__dirname, '../deploy/ovh', name), 'utf8');

describe('OVH unit address routing', () => {
  test('new unit addresses reach the app without editing the existing hostname list', () => {
    expect(deploymentFile('compose.yml')).toContain(`UNIT_BASE_DOMAIN: \u0024{UNIT_BASE_DOMAIN:-${baseDomain}}`);
    expect(deploymentFile('Caddyfile')).toMatch(/\{\$APP_DOMAINS\}, \*\.\{\$UNIT_BASE_DOMAIN\}\s*\{[^}]*reverse_proxy app:5000/s);
    expect(deploymentFile('configure-tls.sh')).toContain(`-d '*.${baseDomain}'`);
  });

  test('the storage hostname keeps its own exact route to Garage', () => {
    expect(deploymentFile('Caddyfile')).toMatch(/\{\$STORAGE_DOMAIN\}\s*\{[^}]*reverse_proxy garage:3900/s);
    expect(deploymentFile('compose.yml').match(/STORAGE_DOMAIN: \$\{STORAGE_DOMAIN:-([^}]+)\}/g))
      .toEqual(Array(2).fill(`STORAGE_DOMAIN: \${STORAGE_DOMAIN:-${storageDomain}}`));
  });
});
