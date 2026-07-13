#!/usr/bin/env node
// setup.js - Interactive setup wizard (npm run setup)
// Detects the CS2 install, picks an AI provider, and writes config.json.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { CONFIG_FILE, CONFIG_EXAMPLE_FILE, BLACKLIST_FILE, HISTORY_FILE, ENV_FILE } = require('./paths');
const { DEFAULT_OR_MODEL_FAST, DEFAULT_OR_MODEL_SMART, DEFAULT_OLLAMA_HOST } = require('./defaults');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, a => resolve(a.trim())));

const CSGO_REL = path.join('steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo');

function findSteamLibraries() {
  const libraries = new Set();

  // 1. Steam install path from the registry
  try {
    const out = execSync('reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) {
      const steamPath = path.normalize(match[1].trim());
      libraries.add(steamPath);

      // 2. Extra libraries from libraryfolders.vdf
      try {
        const vdf = fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) {
          libraries.add(path.normalize(m[1].replace(/\\\\/g, '\\')));
        }
      } catch {}
    }
  } catch {}

  // 3. Common fallback locations
  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\SteamLibrary', 'E:\\SteamLibrary', 'F:\\SteamLibrary',
    'D:\\Steam', 'E:\\Steam', 'F:\\Steam'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) libraries.add(path.normalize(p));
  }

  return [...libraries];
}

function findCs2Dir() {
  for (const lib of findSteamLibraries()) {
    const csgoDir = path.join(lib, CSGO_REL);
    if (fs.existsSync(csgoDir)) return csgoDir;
  }
  return null;
}

async function pickCs2Dir() {
  const detected = findCs2Dir();
  if (detected) {
    console.log(`\nFound CS2 install: ${detected}`);
    const answer = await ask('Use this path? [Y/n] ');
    if (!answer || answer.toLowerCase().startsWith('y')) return detected;
  } else {
    console.log('\nCould not auto-detect a CS2 install.');
  }

  while (true) {
    const manual = await ask('Enter the path to your ...\\Counter-Strike Global Offensive\\game\\csgo folder: ');
    if (manual && fs.existsSync(manual)) return path.normalize(manual);
    console.log('That path does not exist, try again.');
  }
}

async function checkOllama(host) {
  try {
    const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.models || []).map(m => m.name);
  } catch {
    return null;
  }
}

async function pickFromList(label, items, fallback) {
  console.log(`\n${label}`);
  items.forEach((item, i) => console.log(`  ${i + 1}. ${item}`));
  const answer = await ask(`Pick a number [1]: `);
  const idx = parseInt(answer, 10);
  if (idx >= 1 && idx <= items.length) return items[idx - 1];
  return items[0] || fallback;
}

async function main() {
  console.log('=====================================');
  console.log('  CS2 AI Chatter - Setup Wizard');
  console.log('=====================================');

  if (fs.existsSync(CONFIG_FILE)) {
    const answer = await ask('\nconfig.json already exists. Overwrite it? [y/N] ');
    if (!answer.toLowerCase().startsWith('y')) {
      console.log('Keeping existing config. Nothing changed.');
      rl.close();
      return;
    }
  }

  // Start from the example template
  let config;
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_EXAMPLE_FILE, 'utf8'));
  } catch {
    console.error('config.example.json is missing or invalid - re-clone the repo.');
    rl.close();
    process.exit(1);
  }

  // --- CS2 paths ---
  const csgoDir = await pickCs2Dir();
  config.bot_settings.console_log_path = path.join(csgoDir, 'console.log');
  config.bot_settings.cs2_cfg_path = path.join(csgoDir, 'cfg', 'liveinput.cfg');

  if (!fs.existsSync(config.bot_settings.console_log_path)) {
    console.log('\nNOTE: console.log does not exist yet. That is normal if CS2');
    console.log('has not run with console logging enabled. See the steps below.');
  }

  // --- Provider ---
  console.log('\nAI provider:');
  console.log('  1. OpenRouter (cloud, free models, needs a free API key) - easiest');
  console.log('  2. Local Ollama (runs on your own GPU, fully offline)');
  const providerChoice = await ask('Pick a number [1]: ');

  if (providerChoice === '2') {
    config.bot_settings.ai_provider = 'local';
    const host = (await ask(`Ollama host [${DEFAULT_OLLAMA_HOST}]: `)) || DEFAULT_OLLAMA_HOST;
    config.bot_settings.ollama_host = host;

    const models = await checkOllama(host);
    if (models && models.length > 0) {
      console.log(`Ollama connected (${models.length} model(s) installed).`);
      config.bot_settings.model_fast = await pickFromList('Fast model (quick replies):', models, config.bot_settings.model_fast);
      config.bot_settings.model_smart = await pickFromList('Smart model (complex requests):', models, config.bot_settings.model_smart);
    } else if (models) {
      console.log('Ollama is running but has no models. Pull one first, e.g.:');
      console.log('  ollama pull llama3.2:3b');
      console.log(`Keeping default model names (${config.bot_settings.model_fast}).`);
    } else {
      console.log(`Could not reach Ollama at ${host}. Install it from https://ollama.com,`);
      console.log('then run: ollama pull llama3.2:3b');
      console.log('You can change models later in the dashboard.');
    }
  } else {
    config.bot_settings.ai_provider = 'openrouter';
    console.log('\nGet a free API key at https://openrouter.ai/keys');
    const key = await ask('Paste your OpenRouter API key (or press Enter to add it later in the dashboard): ');
    if (key) {
      config.bot_settings.openrouter_api_key = key;
    }
    config.bot_settings.openrouter_model_fast = DEFAULT_OR_MODEL_FAST;
    config.bot_settings.openrouter_model_smart = DEFAULT_OR_MODEL_SMART;
  }

  // --- Write files ---
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  console.log(`\nWrote ${CONFIG_FILE}`);

  if (!fs.existsSync(BLACKLIST_FILE)) {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({ blacklisted_names: [] }, null, 2));
  }
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ exchanges: [] }, null, 2));
  }
  if (!fs.existsSync(ENV_FILE)) {
    fs.writeFileSync(ENV_FILE, '# Optional: OPENROUTER_API_KEY=sk-or-v1-...\n');
  }

  // --- Next steps ---
  const execKey = config.bot_settings.exec_key || 'v';
  console.log('\n=====================================');
  console.log('  Setup complete! Final CS2 steps:');
  console.log('=====================================');
  console.log('1. In Steam: right-click CS2 > Properties > Launch Options, add:');
  console.log('     -condebug');
  console.log('   (this makes CS2 write chat to console.log)');
  console.log('2. In the CS2 console, bind the exec key once:');
  console.log(`     bind "${execKey}" "exec liveinput"`);
  console.log(`   (the bot writes its reply to liveinput.cfg and presses "${execKey}" to send it)`);
  console.log('3. Start everything with:');
  console.log('     npm start');
  console.log('4. Dashboard: http://localhost:3000  (personality, models, blacklist, testing)');

  rl.close();
}

if (require.main === module) {
  main().catch(err => {
    console.error(`Setup failed: ${err.message}`);
    rl.close();
    process.exit(1);
  });
} else {
  rl.close();
}

module.exports = { findSteamLibraries, findCs2Dir };
