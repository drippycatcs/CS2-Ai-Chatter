#!/usr/bin/env node
// start.js - Runs the dashboard and the bot together

const fs = require('node:fs');
const path = require('node:path');
const { spawn, exec } = require('child_process');
const { CONFIG_FILE, ROOT } = require('./paths');

console.log('CS2 AI Chatter - Starting Dashboard and Bot\n');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkNodeVersion() {
  const majorVersion = parseInt(process.version.slice(1).split('.')[0]);
  if (majorVersion >= 18) {
    log(`OK Node.js version: ${process.version}`, 'green');
    return true;
  }
  log(`ERROR Node.js version: ${process.version} (requires v18 or higher)`, 'red');
  return false;
}

function startService(name, script) {
  log(`Starting ${name}...`, 'cyan');
  const child = spawn(process.execPath, [path.join(ROOT, script)], {
    stdio: 'inherit'
  });

  child.on('error', (error) => {
    log(`ERROR ${name} failed to start: ${error.message}`, 'red');
  });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`WARNING ${name} exited with code ${code}`, 'yellow');
    }
  });

  return child;
}

function main() {
  log('Performing startup checks...', 'cyan');

  if (!checkNodeVersion()) {
    process.exit(1);
  }

  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    log('\nERROR Dependencies not installed. Run:', 'red');
    log('  npm install', 'yellow');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    log('\nERROR No config.json found. Run the setup wizard first:', 'red');
    log('  npm run setup', 'yellow');
    process.exit(1);
  }

  log('All checks passed! Starting services...\n', 'green');

  const dashboard = startService('Dashboard', 'dashboard.js');
  const bot = startService('Bot', 'toxicBot.js');

  // Open the dashboard in the default browser (skip with --no-open)
  if (!process.argv.includes('--no-open') && process.platform === 'win32') {
    setTimeout(() => {
      exec('start "" "http://localhost:3000"', () => {});
    }, 1500);
  }

  const shutdown = (signal) => {
    log('\n\nShutting down services...', 'yellow');
    dashboard.kill(signal);
    bot.kill(signal);
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log('Services are running:', 'green');
  log('- Dashboard: http://localhost:3000', 'blue');
  log('- Bot: watching CS2 chat and generating responses', 'blue');
  log('\nPress Ctrl+C to stop both services', 'cyan');
}

main();
