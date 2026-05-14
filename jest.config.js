/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/commands/discover-phase1.ts'],
  testTimeout: 30000,
  // forceExit prevents open-handle warnings from never-resolving CDP stubs
  // used in timeout tests (hanging loadEventFired promises).
  forceExit: true,
};
