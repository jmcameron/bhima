const { chromium } = require('@playwright/test');

const config = require('../../../playwright.config');

const TU = require('../shared/TestUtils');

// Read environment variables from file.
require('dotenv').config();

console.debug('---------------------- START --------------------------');

async function globalSetup() {
  const { baseURL } = config.use;
  const { storageState } = config.projects[0].use;
  console.debug("U: ", baseURL, storageState);

  const browser = await chromium.launch();

  // Create and save the main page for the tests
  const page = await browser.newPage(baseURL);
  TU.registerPage(page);

  await page.goto(baseURL);

  console.debug('Attempting global login');
  await TU.login();
  console.debug('Logged in');

  // Save the login state for reuse in other tests
  await page.context().storageState({ path : storageState });
  console.debug("SS: ", storageState);

  await browser.close();
}

module.exports = globalSetup;
