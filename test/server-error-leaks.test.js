const fs = require('fs');
const path = require('path');

const routesDirectory = path.join(__dirname, '..', 'routes');
const routeFiles = fs.readdirSync(routesDirectory)
  .filter((fileName) => fileName.endsWith('.js'))
  .sort();

describe('route 5xx response security', () => {
  test.each(routeFiles)('%s does not send exception messages to clients', (fileName) => {
    const source = fs.readFileSync(path.join(routesDirectory, fileName), 'utf8');

    expect(source).not.toMatch(
      /res\.status\(\s*5\d\d\s*\)\.json\([^;\n]*(?:error|err|exception)\.message/i
    );
  });
});
