const TEST_SECRET = 'testsecret';
const ORG_ID = 1;

process.env.JWT_SECRET_KEY = TEST_SECRET;
process.env.DB_USER = 'test';
process.env.DB_HOST = 'localhost';
process.env.DB_NAME = 'testdb';
process.env.DB_PASSWORD = 'test';
process.env.DB_PORT = '5432';
process.env.ORGANIZATION_ID = String(ORG_ID);

console.log("Before require");
const app = require('./api');
console.log("After require", Object.keys(app));
console.log("Done");
process.exit(0);
