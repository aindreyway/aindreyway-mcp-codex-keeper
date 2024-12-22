/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/__tests__/**'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  setupFilesAfterEnv: ['jest-extended/all', '<rootDir>/src/tests/setup.ts', '<rootDir>/src/tests/setup/jest.setup.ts'],
  watchPlugins: ['jest-watch-typeahead/filename', 'jest-watch-typeahead/testname'],
  reporters: [
    ['<rootDir>/src/tests/custom-reporter.js', {}],
    [
      'jest-html-reporter',
      {
        pageTitle: 'Test Report',
        outputPath: './test-report/index.html',
        includeFailureMsg: true,
        includeSuiteFailure: true,
        includeConsoleLog: true,
        useCssFile: true,
        theme: 'darkTheme',
      },
    ],
    ['jest-summary-reporter', {}],
    [
      'jest-junit',
      {
        outputDirectory: '.',
        outputName: 'junit.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      },
    ],
  ],
  silent: false,
  verbose: true,
  bail: false,
  logHeapUsage: true,
  testTimeout: 60000,
  maxWorkers: '50%',
  detectOpenHandles: true,
  forceExit: false,
  transformIgnorePatterns: ['/node_modules/(?!(@modelcontextprotocol|zod)/.*)'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@modelcontextprotocol/(.*)$': '@modelcontextprotocol/$1',
    '^zod$': 'zod',
  },
  moduleDirectories: ['node_modules', 'src'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
      },
    ],
    '^.+\\.jsx?$': [
      'babel-jest',
      {
        presets: ['@babel/preset-env'],
        plugins: ['@babel/plugin-transform-modules-commonjs'],
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
};

export default config;
