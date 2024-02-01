const path = require('path');

const SETUP_DIR = __dirname;

// Export the storage state for global logins
const STORAGE_STATE = path.join(SETUP_DIR, '.auth/user.json');

// Storage for the page
const pages = [];

module.exports = {
  STORAGE_STATE,
  PAGES : pages,
};
