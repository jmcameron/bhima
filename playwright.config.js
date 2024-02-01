const { defineConfig, devices } = require('@playwright/test');

const path = require('path');

const { STORAGE_STATE } = require('./test/end-to-end/setup/global.state');

// Read environment variables from file.
require('dotenv').config();

const SETUP_DIR = path.join(__dirname, 'test/end-to-end/setup/');

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({

  globalSetup : require.resolve(path.join(SETUP_DIR, 'global.setup')),

  // testDir : process.env.E2E_DIR
  //   ? `./test/end-to-end/${process.env.E2E_DIR}`
  //   : './test/end-to-end',

  // testIgnore : process.env.E2E_DIR ? '' : /\/stock\/|\/account\//,

  /* Maximum time one test can run for. */
  timeout : 50 * 1000, // Need longer value for CI

  expect : {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout : 5000,
  },

  /* Run tests in files in parallel */
  fullyParallel : false, // JMC WAS: true (changed for test development)

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly : !!process.env.CI,

  /* Retry on CI only */
  retries : process.env.CI ? 2 : 0,

  /* Opt out of parallel tests on CI. */
  // workers : process.env.CI ? 1 : undefined,
  workers : 1,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter : [
    ['html', process.env.E2E_TEST_SERVER
      ? { open : 'never' }
      : { outputFolder : 'results/playwright-report' }],
    ['junit', {
      outputFile : process.env.TEST_NAME
        ? `results/end-to-end-${process.env.TEST_NAME}-results.xml`
        : 'results/end-to-end-results.xml',
    }],
  ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use : {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout : 0,

    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL : `http://localhost:${process.env.PORT || 8080}`,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    // trace: 'on-first-retry',
    trace : 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects : [
    // {
    //   name : 'setup',
    //   testDir : 'test/end-to-end/setup',
    //   testMatch : 'global.setup.js',
    //   // retries : 0,
    // },
    {
      name : 'chromium',
      use : {
        ...devices['Desktop Chrome'],
        storageState : STORAGE_STATE,
      },
      // dependencies : ['setup'],
    },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir : 'test-results/',

  /* Run your local dev server before starting the tests */
  // webServer : {
  //   command : 'npm run start',
  //   port : 3000,
  // },
});
