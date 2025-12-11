// Test script to list all routes in resources router
const { Pool } = require('pg');

// Create minimal pool (won't actually connect)
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'test'
});

// Load the routes module
const resourcesRouter = require('./routes/resources')(pool);

// Function to print all routes
function printRoutes(router, basePath = '') {
  if (!router.stack) {
    console.log('No stack found');
    return;
  }

  router.stack.forEach((layer) => {
    if (layer.route) {
      // This is a route
      const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
      console.log(`${methods} ${basePath}${layer.route.path}`);
    } else if (layer.name === 'router') {
      // This is a nested router
      const path = layer.regexp.source.replace('\\/?', '').replace('(?=\\/|$)', '');
      printRoutes(layer.handle, basePath + path);
    }
  });
}

console.log('\n=== Resources Router Routes ===');
printRoutes(resourcesRouter);
console.log('=== End of Routes ===\n');
