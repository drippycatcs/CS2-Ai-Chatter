// dashboard.js - Enhanced Web Dashboard for CS2 Chat Bot

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const directAI = require('./directAI'); // also loads .env
const { CONFIG_FILE, BLACKLIST_FILE, HISTORY_FILE, PUBLIC_DIR, BOT_STATUS_FILE } = require('./paths');
const {
  DEFAULT_MODEL_FAST,
  DEFAULT_MODEL_SMART,
  DEFAULT_OR_MODEL_FAST,
  DEFAULT_OR_MODEL_SMART,
  DEFAULT_OLLAMA_HOST
} = require('./defaults');

// Helper: get OpenRouter API key from config or .env
function getOpenRouterKey() {
  const config = loadFile(CONFIG_FILE, {});
  return config.bot_settings?.openrouter_api_key || process.env.OPENROUTER_API_KEY || '';
}

// The real key never leaves the server - API responses only carry this mask
function maskKey(key) {
  if (!key) return '';
  return key.length > 14 ? `${key.slice(0, 8)}...${key.slice(-4)}` : '***...***';
}

function isMaskedKey(key) {
  return typeof key === 'string' && key.includes('...');
}

// Strip masked/unchanged key values from incoming settings so a masked
// display value never overwrites the real key
function sanitizeIncomingBotSettings(botSettings) {
  if (!botSettings || typeof botSettings !== 'object') return botSettings;
  if ('openrouter_api_key' in botSettings) {
    const key = botSettings.openrouter_api_key;
    if (!key || isMaskedKey(key)) {
      delete botSettings.openrouter_api_key;
    }
  }
  return botSettings;
}

function maskedConfig(config) {
  if (!config?.bot_settings?.openrouter_api_key) return config;
  return {
    ...config,
    bot_settings: {
      ...config.bot_settings,
      openrouter_api_key: maskKey(config.bot_settings.openrouter_api_key)
    }
  };
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Stats tracking
const stats = {
  messagesProcessed: 0,
  responsesGenerated: 0,
  messagesFiltered: 0,
  startTime: Date.now(),
  lastActivity: null
};

// Helper functions
function loadFile(file, defaultValue) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function saveFile(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ============================================
// BLACKLIST API
// ============================================
app.get('/api/blacklist', (req, res) => {
  res.json(loadFile(BLACKLIST_FILE, { blacklisted_names: [] }));
});

app.post('/api/blacklist/add', (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ error: 'Name required' });
    }

    const blacklist = loadFile(BLACKLIST_FILE, { blacklisted_names: [] });
    const trimmed = name.trim();

    if (!blacklist.blacklisted_names.includes(trimmed)) {
      blacklist.blacklisted_names.push(trimmed);
      saveFile(BLACKLIST_FILE, blacklist);
      res.json({ success: true, blacklist });
    } else {
      res.status(400).json({ error: 'Already blacklisted' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/blacklist/remove/:name', (req, res) => {
  try {
    const { name } = req.params;
    const blacklist = loadFile(BLACKLIST_FILE, { blacklisted_names: [] });

    const index = blacklist.blacklisted_names.indexOf(name);
    if (index > -1) {
      blacklist.blacklisted_names.splice(index, 1);
      saveFile(BLACKLIST_FILE, blacklist);
      res.json({ success: true, blacklist });
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CONFIG API
// ============================================
app.get('/api/config', (req, res) => {
  const config = maskedConfig(loadFile(CONFIG_FILE, {}));
  config.defaults = {
    model_fast: DEFAULT_MODEL_FAST,
    model_smart: DEFAULT_MODEL_SMART,
    openrouter_model_fast: DEFAULT_OR_MODEL_FAST,
    openrouter_model_smart: DEFAULT_OR_MODEL_SMART,
    ollama_host: DEFAULT_OLLAMA_HOST
  };
  res.json(config);
});

app.post('/api/config/update', (req, res) => {
  try {
    const config = loadFile(CONFIG_FILE, {});
    const updates = req.body;
    sanitizeIncomingBotSettings(updates.bot_settings);

    // Merge updates into config
    Object.keys(updates).forEach(key => {
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        config[key] = { ...config[key], ...updates[key] };
      } else {
        config[key] = updates[key];
      }
    });

    saveFile(CONFIG_FILE, config);

    // Reload directAI config
    directAI.reloadConfig();

    res.json({ success: true, config: maskedConfig(config) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full config replace
app.post('/api/config/save', (req, res) => {
  try {
    const incoming = req.body || {};
    sanitizeIncomingBotSettings(incoming.bot_settings);

    // A full replace with a masked/removed key must keep the existing one
    const existing = loadFile(CONFIG_FILE, {});
    if (existing.bot_settings?.openrouter_api_key && incoming.bot_settings
        && !incoming.bot_settings.openrouter_api_key) {
      incoming.bot_settings.openrouter_api_key = existing.bot_settings.openrouter_api_key;
    }

    saveFile(CONFIG_FILE, incoming);
    directAI.reloadConfig();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// STATS & HISTORY API
// ============================================
app.get('/api/stats', (req, res) => {
  const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
  const history = loadFile(HISTORY_FILE, { exchanges: [] });

  // Bot heartbeat (the bot is a separate process; it beats every 5s)
  const heartbeat = loadFile(BOT_STATUS_FILE, null);
  const botRunning = !!heartbeat && (Date.now() - heartbeat.time) < 15000;

  res.json({
    uptime,
    uptimeFormatted: formatUptime(uptime),
    messagesProcessed: stats.messagesProcessed,
    responsesGenerated: stats.responsesGenerated,
    messagesFiltered: stats.messagesFiltered,
    lastActivity: stats.lastActivity,
    historyCount: history.exchanges?.length || 0,
    botRunning,
    botWatching: botRunning ? heartbeat.watching : null
  });
});

app.get('/api/history', (req, res) => {
  const history = loadFile(HISTORY_FILE, { exchanges: [] });
  res.json(history.exchanges || []);
});

app.delete('/api/history/clear', (req, res) => {
  try {
    saveFile(HISTORY_FILE, { exchanges: [] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// AI TEST API
// ============================================
app.post('/api/test-ai', async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!name || !message) {
      return res.status(400).json({ error: 'Name and message required' });
    }

    const startTime = Date.now();
    stats.messagesProcessed++;
    stats.lastActivity = new Date().toISOString();

    // skipHistory: tester experiments must not poison the live bot's context
    const response = await directAI.generateResponse(name.trim(), message.trim(), { skipHistory: true });
    const elapsed = Date.now() - startTime;

    // An AI failure is not "filtered" - tell the user what actually broke
    if (!response && directAI.lastError) {
      return res.json({ success: false, error: directAI.lastError, elapsed });
    }

    if (response) {
      stats.responsesGenerated++;
    } else {
      stats.messagesFiltered++;
    }

    const bot = directAI.config.bot_settings || {};
    const isComplex = directAI.isComplexRequest(message.trim());
    const provider = bot.ai_provider || 'local';
    let modelUsed;
    if (provider === 'openrouter') {
      modelUsed = isComplex
        ? (bot.openrouter_model_smart || DEFAULT_OR_MODEL_SMART)
        : (bot.openrouter_model_fast || DEFAULT_OR_MODEL_FAST);
    } else {
      modelUsed = isComplex
        ? (bot.model_smart || bot.model || DEFAULT_MODEL_SMART)
        : (bot.model_fast || bot.model || DEFAULT_MODEL_FAST);
    }

    res.json({
      success: true,
      response: response || '(filtered - no response)',
      filtered: !response,
      elapsed,
      model: modelUsed,
      modelType: isComplex ? 'smart' : 'fast'
    });
  } catch (err) {
    console.error('[Dashboard] AI error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BOT SETTINGS API
// ============================================
app.get('/api/bot-settings', (req, res) => {
  const config = maskedConfig(loadFile(CONFIG_FILE, {}));
  res.json({
    bot_settings: config.bot_settings || {},
    smart_filter: config.smart_filter || {},
    ai_personality: config.ai_personality || {},
    human_behavior: config.human_behavior || {}
  });
});

app.post('/api/bot-settings', (req, res) => {
  try {
    const config = loadFile(CONFIG_FILE, {});
    const { bot_settings, smart_filter, ai_personality, human_behavior } = req.body;
    sanitizeIncomingBotSettings(bot_settings);

    if (bot_settings) config.bot_settings = { ...config.bot_settings, ...bot_settings };
    if (smart_filter) config.smart_filter = { ...config.smart_filter, ...smart_filter };
    if (ai_personality) config.ai_personality = { ...config.ai_personality, ...ai_personality };
    if (human_behavior) config.human_behavior = { ...config.human_behavior, ...human_behavior };

    saveFile(CONFIG_FILE, config);
    directAI.reloadConfig();

    res.json({ success: true, config: maskedConfig(config) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DEFAULT SYSTEM PROMPT API
// ============================================
app.get('/api/default-prompt', (req, res) => {
  res.json({
    prompt: directAI.getDefaultSystemPrompt()
  });
});

// ============================================
// OLLAMA STATUS API
// ============================================
app.get('/api/ollama/status', async (req, res) => {
  try {
    const config = loadFile(CONFIG_FILE, {});
    const host = config.bot_settings?.ollama_host || DEFAULT_OLLAMA_HOST;

    const response = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });

    if (response.ok) {
      const data = await response.json();
      res.json({
        connected: true,
        host,
        models: data.models || []
      });
    } else {
      res.json({ connected: false, host, error: 'Bad response' });
    }
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// ============================================
// OPENROUTER STATUS API
// ============================================
// Curated recommended models. Only shown if they still exist in the live
// catalog, so a stale entry silently drops instead of offering a dead id.
const KNOWN_FREE_MODELS = [
  { id: 'openai/gpt-oss-20b:free', name: 'GPT OSS 20B (fast, recommended)' },
  { id: 'openai/gpt-oss-120b:free', name: 'GPT OSS 120B (smart, recommended)' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', name: 'Nemotron Nano 9B (fast)' },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B' },
  { id: 'meta-llama/llama-3.2-3b-instruct:free', name: 'Llama 3.2 3B (fast, often busy)' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (smart, often busy)' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', name: 'Qwen3 Next 80B (smart, often busy)' },
  { id: 'nousresearch/hermes-3-llama-3.1-405b:free', name: 'Hermes 3 405B (smart, uncensored-ish)' },
];

// Model list cache: the catalog rarely changes, no reason to hit the API
// on every dashboard poll
const modelCache = {
  models: null,
  fetchedAt: 0,
  keyHash: '',
  keyValid: null // true / false / null (unknown - no key or network error)
};
const MODEL_CACHE_TTL = 10 * 60 * 1000;

function hashKey(key) {
  return key ? crypto.createHash('sha256').update(key).digest('hex') : '';
}

function openrouterStatusPayload(apiKey) {
  let error = null;
  if (!apiKey) {
    error = 'No API key set. Add it in Settings or in your .env file.';
  } else if (modelCache.keyValid === false) {
    error = 'Invalid API key - check it at openrouter.ai/keys';
  }
  return {
    connected: !!apiKey && modelCache.keyValid !== false,
    keyValid: modelCache.keyValid,
    freeModels: modelCache.models || [],
    cheapModels: modelCache.cheapModels || [],
    cachedAt: modelCache.fetchedAt || null,
    error
  };
}

function isTextOnlyModel(m) {
  const out = m.architecture?.output_modalities;
  return !out || (out.length === 1 && out[0] === 'text');
}

app.get('/api/openrouter/status', async (req, res) => {
  try {
    const apiKey = getOpenRouterKey();
    const keyHash = hashKey(apiKey);
    const forceRefresh = req.query.refresh === '1';

    const cacheFresh = modelCache.models
      && (Date.now() - modelCache.fetchedAt) < MODEL_CACHE_TTL
      && modelCache.keyHash === keyHash
      && !forceRefresh;

    if (cacheFresh) {
      return res.json(openrouterStatusPayload(apiKey));
    }

    // Catalog needs no auth; run it in parallel with the key check
    const catalogPromise = fetch('https://openrouter.ai/api/v1/models', {
      signal: AbortSignal.timeout(10000)
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`catalog fetch failed (${r.status})`)))
      .catch(err => ({ fetchError: err.message }));

    const authPromise = apiKey
      ? fetch('https://openrouter.ai/api/v1/auth/key', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8000)
        })
          .then(r => r.ok ? true : (r.status === 401 || r.status === 403 ? false : null))
          .catch(() => null) // network error - key validity unknown
      : Promise.resolve(null);

    const [catalog, keyValid] = await Promise.all([catalogPromise, authPromise]);

    if (catalog.fetchError) {
      // Keep serving a stale cache rather than an empty list
      const payload = openrouterStatusPayload(apiKey);
      payload.error = payload.error || `Could not fetch model list: ${catalog.fetchError}`;
      if (!modelCache.models) payload.connected = false;
      modelCache.keyValid = keyValid;
      return res.json(payload);
    }

    processCatalog(catalog.data || []);
    modelCache.keyHash = keyHash;
    modelCache.keyValid = keyValid;

    res.json(openrouterStatusPayload(apiKey));
  } catch (err) {
    res.json({ connected: false, keyValid: null, freeModels: [], cachedAt: null, error: err.message });
  }
});

// Digest the raw catalog into the cache: free list, cheap-paid list, and the
// full searchable list with an estimated price per 1000 messages
// (1 message ~= 800 prompt tokens with history + 50 output tokens)
function processCatalog(liveModels) {
  const pricePer1k = (m) => {
    const p = Number(m.pricing?.prompt) || 0, c = Number(m.pricing?.completion) || 0;
    return 1000 * (800 * p + 50 * c);
  };

  const textModels = liveModels.filter(isTextOnlyModel);
  const byId = new Map(textModels.map(m => [m.id, m]));

  const nativeFree = textModels
    .filter(m => Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0)
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));

  // Recommended (validated against the live catalog) first, then the rest
  const seenIds = new Set();
  const allFree = [];
  for (const m of KNOWN_FREE_MODELS) {
    const live = byId.get(m.id);
    if (!live) continue;
    seenIds.add(m.id);
    allFree.push({ id: m.id, name: m.name, context_length: live.context_length, recommended: true });
  }
  for (const m of nativeFree) {
    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);
    allFree.push({ id: m.id, name: m.name, context_length: m.context_length });
  }

  // Cheapest paid models - free ones get rate-limited, and 1000 replies on
  // these costs a few cents at most
  const cheapPaid = textModels
    .filter(m => Number(m.pricing?.prompt) > 0 && Number(m.pricing?.completion) > 0)
    .map(m => ({ id: m.id, name: m.name, context_length: m.context_length, paid: true, pricePer1k: pricePer1k(m) }))
    .sort((a, b) => a.pricePer1k - b.pricePer1k);

  modelCache.models = allFree;
  modelCache.cheapModels = cheapPaid.slice(0, 10);
  modelCache.allModels = textModels
    .map(m => {
      const price = pricePer1k(m);
      return { id: m.id, name: m.name, context_length: m.context_length, free: price === 0, pricePer1k: price };
    })
    .sort((a, b) => a.pricePer1k - b.pricePer1k);
  modelCache.fetchedAt = Date.now();
}

// Search the full catalog (free + paid) by id/name
app.get('/api/openrouter/models', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();

    if (!modelCache.allModels || (Date.now() - modelCache.fetchedAt) > MODEL_CACHE_TTL) {
      const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`catalog fetch failed (${r.status})`);
      const data = await r.json();
      processCatalog(data.data || []);
    }

    const matches = (modelCache.allModels || [])
      .filter(m => !q || m.id.toLowerCase().includes(q) || (m.name || '').toLowerCase().includes(q))
      .slice(0, 30);

    res.json({ models: matches, total: (modelCache.allModels || []).length });
  } catch (err) {
    res.json({ models: [], error: err.message });
  }
});

// Helper function
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}h ${m}m ${s}s`;
}

process.on('unhandledRejection', err => {
  console.error('[Dashboard] Unhandled rejection:', err?.message || err);
});

// Start server (loopback only - the dashboard has no auth and can read the API key)
app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Dashboard] Running at http://localhost:${PORT}`);
});

module.exports = app;
