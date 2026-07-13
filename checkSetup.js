// checkSetup.js - Setup validator (npm run check)
// Verifies Node, dependencies, config, CS2 paths, and the active AI provider.

const fs = require('node:fs');
const path = require('node:path');
const { ROOT, CONFIG_FILE, BLACKLIST_FILE } = require('./paths');

console.log('CS2 AI Chatter - Setup Check\n');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

let failures = 0;
let warnings = 0;

function pass(msg) { log(`OK    ${msg}`, 'green'); }
function warn(msg) { log(`WARN  ${msg}`, 'yellow'); warnings++; }
function fail(msg) { log(`FAIL  ${msg}`, 'red'); failures++; }

function checkNodeVersion() {
  const major = parseInt(process.version.slice(1).split('.')[0]);
  if (major >= 18) {
    pass(`Node.js ${process.version}`);
  } else {
    fail(`Node.js ${process.version} - v18 or higher required (uses built-in fetch)`);
  }
}

function checkDependencies() {
  const deps = ['express', 'koffi'];
  for (const dep of deps) {
    if (fs.existsSync(path.join(ROOT, 'node_modules', dep))) {
      pass(`Dependency installed: ${dep}`);
    } else {
      fail(`Dependency missing: ${dep} - run "npm install"`);
    }
  }
}

function checkSourceFiles() {
  const files = ['toxicBot.js', 'directAI.js', 'dashboard.js', 'start.js',
    path.join('keypress', 'index.js'), path.join('public', 'index.html')];
  for (const f of files) {
    if (fs.existsSync(path.join(ROOT, f))) {
      pass(`Source file: ${f}`);
    } else {
      fail(`Source file missing: ${f} - re-clone the repo`);
    }
  }
}

function checkConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fail('config.json missing - run "npm run setup"');
    return null;
  }

  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    fail(`config.json is not valid JSON: ${err.message}`);
    return null;
  }
  pass('config.json exists and parses');

  const bot = config.bot_settings || {};

  if (bot.console_log_path && fs.existsSync(bot.console_log_path)) {
    pass(`CS2 console.log found: ${bot.console_log_path}`);
  } else if (bot.console_log_path && fs.existsSync(path.dirname(bot.console_log_path))) {
    warn(`console.log not found yet (CS2 folder exists). Add -condebug to CS2 launch options and start the game once.`);
  } else if (bot.console_log_path) {
    fail(`console_log_path points to a folder that does not exist: ${bot.console_log_path}`);
  } else {
    fail('console_log_path not set - run "npm run setup"');
  }

  if (bot.cs2_cfg_path && fs.existsSync(path.dirname(bot.cs2_cfg_path))) {
    pass(`CS2 cfg folder found: ${path.dirname(bot.cs2_cfg_path)}`);
  } else if (bot.cs2_cfg_path) {
    fail(`cs2_cfg_path folder does not exist: ${path.dirname(bot.cs2_cfg_path)}`);
  } else {
    fail('cs2_cfg_path not set - run "npm run setup"');
  }

  if (fs.existsSync(BLACKLIST_FILE)) {
    pass('blacklist.json exists');
  } else {
    warn('blacklist.json missing (created automatically by "npm run setup"; the bot tolerates its absence)');
  }

  return config;
}

async function checkProvider(config) {
  const bot = config?.bot_settings || {};
  const provider = bot.ai_provider || 'local';

  if (provider === 'openrouter') {
    const key = bot.openrouter_api_key || process.env.OPENROUTER_API_KEY;
    if (!key) {
      fail('Provider is openrouter but no API key set (config.json or OPENROUTER_API_KEY in .env)');
      return;
    }
    pass('OpenRouter API key is set');
    try {
      const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        pass('OpenRouter key is valid');
      } else {
        fail(`OpenRouter rejected the key (HTTP ${res.status}) - check openrouter.ai/keys`);
      }
    } catch (err) {
      warn(`Could not verify OpenRouter key (network issue: ${err.message})`);
    }
  } else {
    const host = bot.ollama_host || 'http://127.0.0.1:11434';
    try {
      const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      pass(`Ollama reachable at ${host} (${models.length} model(s))`);

      for (const wanted of [bot.model_fast, bot.model_smart]) {
        if (wanted && !models.includes(wanted)) {
          warn(`Configured model "${wanted}" not installed - run: ollama pull ${wanted}`);
        }
      }
    } catch (err) {
      fail(`Ollama not reachable at ${host} (${err.message}) - install from https://ollama.com or switch provider`);
    }
  }
}

async function main() {
  log('--- Environment ---', 'cyan');
  checkNodeVersion();
  checkDependencies();

  log('\n--- Project files ---', 'cyan');
  checkSourceFiles();

  log('\n--- Configuration ---', 'cyan');
  const config = checkConfig();

  if (config) {
    log('\n--- AI provider ---', 'cyan');
    await checkProvider(config);
  }

  console.log('');
  if (failures > 0) {
    log(`${failures} problem(s) found${warnings ? `, ${warnings} warning(s)` : ''}. Fix the FAIL items above.`, 'red');
    process.exit(1);
  } else if (warnings > 0) {
    log(`Setup looks good (${warnings} warning(s) - see above). Run: npm start`, 'yellow');
  } else {
    log('Everything looks good! Run: npm start', 'green');
  }
}

main().catch(err => {
  log(`Check failed: ${err.message}`, 'red');
  process.exit(1);
});
