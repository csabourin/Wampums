module.exports = {
  setupFiles: ['<rootDir>/test/setupJest.js'],
  testPathIgnorePatterns: ['/node_modules/', '/mobile/'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
};
