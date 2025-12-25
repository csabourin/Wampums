/**
 * Jest Configuration for Wampums React Native App
 */

module.exports = {
  preset: 'jest-expo',

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],

  // Transform files with babel-jest
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],

  // Module name mapper for assets
  moduleNameMapper: {
    '\\.svg': '<rootDir>/__mocks__/svgMock.js',
    '\\.(jpg|jpeg|png|gif|webp)$': '<rootDir>/__mocks__/fileMock.js',
  },

  // Coverage settings
  collectCoverageFrom: [
    'src/**/*.{js,jsx}',
    '!src/**/*.test.{js,jsx}',
    '!src/**/__tests__/**',
    '!**/node_modules/**',
  ],

  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },

  // Test environment
  testEnvironment: 'node',

  // Test match patterns
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)',
  ],

  // Verbose output
  verbose: true,
};
