// paths.js - Project-root-resolved file paths.
// Everything resolves against this directory so the app works no matter
// which working directory it is launched from.

const path = require('path');

const ROOT = __dirname;

module.exports = {
  ROOT,
  CONFIG_FILE: path.join(ROOT, 'config.json'),
  CONFIG_EXAMPLE_FILE: path.join(ROOT, 'config.example.json'),
  BLACKLIST_FILE: path.join(ROOT, 'blacklist.json'),
  HISTORY_FILE: path.join(ROOT, 'conversation_history.json'),
  ENV_FILE: path.join(ROOT, '.env'),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  BOT_STATUS_FILE: path.join(ROOT, '.bot_status.json')
};
