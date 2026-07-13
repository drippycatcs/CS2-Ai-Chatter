// toxicBot.js - CS2 Chat Bot with Message Queue
// Optimized for GPU, smart filtering, and proper message queuing

const fs = require('fs');
const { keyTap } = require('./keypress');
const directAI = require('./directAI');
const { CONFIG_FILE, BLACKLIST_FILE, BOT_STATUS_FILE } = require('./paths');

// ============================================
// MESSAGE QUEUE CLASS
// ============================================
class MessageQueue {
  constructor(config) {
    this.queue = [];
    this.processing = false;
    this.config = config;
    this.lastSentTime = 0;
  }

  // Split long responses at sentence/word boundaries
  splitResponse(text, maxLen = 128) {
    if (!text || text.length <= maxLen) return text ? [text] : [];

    const chunks = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }

      let splitAt = maxLen;
      const chunk = remaining.substring(0, maxLen);

      // Try sentence boundary first (. ! ?)
      const lastSentence = Math.max(
        chunk.lastIndexOf('. '),
        chunk.lastIndexOf('! '),
        chunk.lastIndexOf('? ')
      );

      if (lastSentence > maxLen * 0.5) {
        splitAt = lastSentence + 1;
      } else {
        // Try word boundary
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.6) {
          splitAt = lastSpace;
        }
      }

      chunks.push(remaining.substring(0, splitAt).trim());
      remaining = remaining.substring(splitAt).trim();
    }

    return chunks;
  }

  // Add response to queue (splits if needed, max 5 messages)
  enqueue(response) {
    if (!response) return;

    const maxChars = this.config.bot_settings.max_chars_per_message || 100;
    const maxMessages = 5; // Limit to 5 messages max

    // First, convert escaped newlines to real newlines and split
    const normalized = response.replace(/\\n/g, '\n');
    const lines = normalized.split('\n').filter(line => line.trim());

    // Collect all chunks first
    const allChunks = [];
    for (const line of lines) {
      const chunks = this.splitResponse(line.trim(), maxChars);
      for (const chunk of chunks) {
        if (chunk.trim()) {
          allChunks.push(chunk.trim());
        }
      }
    }

    // Limit to max 5 messages
    const limitedChunks = allChunks.slice(0, maxMessages);
    if (allChunks.length > maxMessages) {
      console.log(`[Queue] Limited from ${allChunks.length} to ${maxMessages} messages`);
    }

    // Add to queue
    for (const chunk of limitedChunks) {
      this.queue.push(chunk);
    }

    // Start processing if not already
    if (!this.processing) {
      this.processQueue();
    }
  }

  // Process queue with delays
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const delay = this.config.bot_settings.queue_delay_ms || 500;
    const total = this.queue.length;

    console.log(`[Queue] Processing ${total} message(s)...`);

    let count = 0;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      count++;

      await this.sendToGame(message);
      this.lastSentTime = Date.now();

      // Delay between messages (only if more messages pending)
      if (this.queue.length > 0) {
        console.log(`[Queue] Waiting ${delay}ms before next message (${this.queue.length} remaining)`);
        await this.sleep(delay);
      }
    }

    console.log(`[Queue] Done - sent ${count} message(s)`);
    this.processing = false;
  }

  // Send single message to CS2
  async sendToGame(message) {
    const cfgPath = this.config.bot_settings.cs2_cfg_path;

    if (!this.config.bot_settings.send_to_game) {
      console.log(`[Queue] (Disabled) Would send: "${message}"`);
      return;
    }

    if (!cfgPath) {
      console.log('[Queue] No CS2 config path set');
      return;
    }

    try {
      fs.writeFileSync(cfgPath, `say ${message}\n`);
      keyTap(this.config.bot_settings.exec_key || 'v');
      console.log(`[Queue] Sent: "${message}"`);
    } catch (err) {
      console.error(`[Queue] Send failed: ${err.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Clear pending messages
  clear() {
    this.queue = [];
  }

  get length() {
    return this.queue.length;
  }
}

// ============================================
// CHAT LINE PARSER (standalone so tests can use it)
// ============================================
function parseChatLine(line) {
  // Clean zero-width characters
  const cleaned = line.replace(/[​-‏⁠﻿]/g, '')
    .replace(/\[DEAD\]/g, '')
    .replace(/\[SPECTATOR\]/g, '')
    .replace(/\[BOT\]/g, '')
    .trim();

  // Match: [ALL] or [TEAM] PlayerName: message
  // Optional timestamp at start
  const match = cleaned.match(
    /^(?:\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s+)?\[(ALL|TEAM)\]\s+(?:\((.+?)\)|([^:]+?))\s*:\s*(.+)$/
  );

  if (!match) return null;

  const [, scope, nameParen, nameBare, message] = match;
  const name = (nameParen || nameBare || '').trim();
  const text = (message || '').trim();

  if (!name || !text) return null;

  return { scope, name, message: text };
}

// ============================================
// BOT CORE
// ============================================
class ToxicBot {
  constructor() {
    this.config = this.loadConfig();
    this.blacklist = this.loadBlacklist();
    this.messageQueue = new MessageQueue(this.config);
    this.lastSize = 0;
    this.lineRemainder = ''; // Partial line carried over between reads
    this.reading = false;    // Mutex: one read of the log at a time
    this.pendingCheck = false;
    this.pendingMessages = []; // Parsed chat waiting for the AI (reader never blocks)
    this.processingMessages = false;
    this.recentResponses = []; // Track our own responses to avoid loops
    this.configMtime = 0;
    this.blacklistMtime = 0;
    this.lastReloadCheck = 0;
    this.logPath = null;
    this.watcher = null;
    this.polling = false;

    // Register callback for complex (async) responses
    directAI.onComplexResponse = (response) => {
      if (response && response !== '...') {
        console.log(`[ToxicBot] Complex response ready, queuing...`);
        this.trackResponse(response);
        this.messageQueue.enqueue(response);
      }
    };

    console.log('[ToxicBot] Initialized');
    console.log(`[ToxicBot] Queue delay: ${this.config.bot_settings.queue_delay_ms}ms`);
    console.log(`[ToxicBot] Max chars/msg: ${this.config.bot_settings.max_chars_per_message}`);
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (err) {
      console.error('[ToxicBot] Failed to load config:', err.message);
      return { bot_settings: {}, smart_filter: {} };
    }
  }

  loadBlacklist() {
    try {
      const data = JSON.parse(fs.readFileSync(BLACKLIST_FILE, 'utf8'));
      const names = (data.blacklisted_names || []).map(n => n.toLowerCase().trim());
      return new Set(names);
    } catch {
      return new Set();
    }
  }

  reloadConfigIfChanged() {
    // Throttle: stat at most every 2s so dashboard edits still apply quickly
    // without sync disk I/O on every message
    const now = Date.now();
    if (now - this.lastReloadCheck < 2000) return;
    this.lastReloadCheck = now;

    try {
      const stat = fs.statSync(CONFIG_FILE);
      if (stat.mtimeMs !== this.configMtime) {
        this.config = this.loadConfig();
        this.messageQueue.config = this.config;
        this.configMtime = stat.mtimeMs;
        console.log('[ToxicBot] Config reloaded');
      }
    } catch {}

    try {
      const stat = fs.statSync(BLACKLIST_FILE);
      if (stat.mtimeMs !== this.blacklistMtime) {
        this.blacklist = this.loadBlacklist();
        this.blacklistMtime = stat.mtimeMs;
      }
    } catch {}
  }

  // Check if player is blacklisted
  isBlacklisted(name) {
    return this.blacklist.has(name.toLowerCase().trim());
  }

  // Track our responses to avoid responding to ourselves
  trackResponse(response) {
    this.recentResponses.push({
      text: response.toLowerCase(),
      time: Date.now()
    });
    // Keep only last 10 responses from last 30 seconds
    const cutoff = Date.now() - 30000;
    this.recentResponses = this.recentResponses
      .filter(r => r.time > cutoff)
      .slice(-10);
  }

  isOwnResponse(message) {
    const msgLower = message.toLowerCase();
    return this.recentResponses.some(r =>
      r.text === msgLower || msgLower.includes(r.text) || r.text.includes(msgLower)
    );
  }

  // Parse chat line from console.log
  parseChatLine(line) {
    return parseChatLine(line);
  }

  // Handle incoming chat message
  async handleMessage(parsed) {
    const { scope, name, message } = parsed;

    // Reload config/blacklist if changed (throttled)
    this.reloadConfigIfChanged();

    // Check scope filter
    if (scope === 'TEAM' && !this.config.bot_settings.enable_team_chat) return;
    if (scope === 'ALL' && !this.config.bot_settings.enable_all_chat) return;

    // Check blacklist
    if (this.isBlacklisted(name)) {
      console.log(`[ToxicBot] Ignored (blacklisted): ${name}`);
      return;
    }

    // Check if this is our own response echoed back
    if (this.isOwnResponse(message)) {
      console.log(`[ToxicBot] Ignored (own response): "${message}"`);
      return;
    }

    // Global reply cooldown - don't spam the chat (CS2 kicks for it).
    // The message still becomes context so the bot follows the conversation.
    const cooldown = this.config.bot_settings.reply_cooldown_ms || 0;
    if (cooldown > 0 && Date.now() - this.messageQueue.lastSentTime < cooldown) {
      directAI.noteChatMessage(name, message);
      console.log(`[ToxicBot] Ignored (cooldown): ${name}`);
      return;
    }

    console.log(`[ToxicBot] [${scope}] ${name}: "${message}"`);

    try {
      // directAI handles smart filtering internally
      const response = await directAI.generateResponse(name, message);

      if (response && response !== '...') {
        // Apply human-like delay before sending
        const behavior = this.config.human_behavior || {};
        if (behavior.enabled) {
          const minDelay = behavior.min_delay || 500;
          const maxDelay = behavior.max_delay || 2000;
          const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
          console.log(`[ToxicBot] Human delay: ${delay}ms`);
          await this.sleep(delay);
        }

        this.trackResponse(response);
        this.messageQueue.enqueue(response);
      }
    } catch (err) {
      console.error(`[ToxicBot] AI error: ${err.message}`);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Read a byte range from console.log as text
  readNewData(filePath, start, end) {
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(filePath, {
        start,
        end: end - 1,
        encoding: 'utf8'
      });

      let buffer = '';
      stream.on('data', chunk => { buffer += chunk; });
      stream.on('end', () => resolve(buffer));
      stream.on('error', reject);
    });
  }

  // Check the log for new data. Mutex-guarded: overlapping watch events
  // collapse into a single follow-up pass instead of racing on lastSize.
  async checkForNewData() {
    if (this.reading) {
      this.pendingCheck = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.pendingCheck = false;

        let stat;
        try {
          stat = await fs.promises.stat(this.logPath);
        } catch {
          break; // File temporarily missing (e.g. map change) - next event retries
        }

        if (stat.size < this.lastSize) {
          // File was truncated/reset
          this.lastSize = stat.size;
          this.lineRemainder = '';
          continue;
        }
        if (stat.size === this.lastSize) continue;

        const start = this.lastSize;
        this.lastSize = stat.size;

        const chunk = await this.readNewData(this.logPath, start, stat.size);

        // Carry partial lines across reads - a line can straddle two writes
        const data = this.lineRemainder + chunk;
        const lines = data.split(/\r?\n/);
        this.lineRemainder = lines.pop();

        for (const line of lines) {
          const parsed = this.parseChatLine(line);
          if (parsed) this.enqueueMessage(parsed);
        }
      } while (this.pendingCheck);
    } catch (err) {
      console.error(`[ToxicBot] Read error: ${err.message}`);
    } finally {
      this.reading = false;
    }
  }

  // Queue a parsed chat message for AI processing without blocking the reader
  enqueueMessage(parsed) {
    this.pendingMessages.push({ parsed, time: Date.now() });

    // Under a chat flood, keep only the 5 newest - replying to stale
    // messages 30s later looks broken anyway
    if (this.pendingMessages.length > 5) {
      const dropped = this.pendingMessages.length - 5;
      this.pendingMessages.splice(0, dropped);
      console.log(`[ToxicBot] Chat flood: dropped ${dropped} oldest pending message(s)`);
    }

    this.drainMessages().catch(err =>
      console.error(`[ToxicBot] Message loop error: ${err.message}`)
    );
  }

  // Process pending messages one at a time (AI ordering + echo-guard need serial)
  async drainMessages() {
    if (this.processingMessages) return;
    this.processingMessages = true;
    try {
      while (this.pendingMessages.length > 0) {
        const { parsed, time } = this.pendingMessages.shift();
        if (Date.now() - time > 10000) {
          console.log(`[ToxicBot] Skipped stale message from ${parsed.name}`);
          continue;
        }
        try {
          await this.handleMessage(parsed);
        } catch (err) {
          console.error(`[ToxicBot] Handle error: ${err.message}`);
        }
      }
    } finally {
      this.processingMessages = false;
    }
  }

  // Start watching console.log
  async start() {
    const logPath = this.config.bot_settings.console_log_path;
    this.logPath = logPath;

    if (!logPath) {
      console.error('[ToxicBot] No console_log_path configured - run "npm run setup"');
      return;
    }

    if (!fs.existsSync(logPath)) {
      console.error(`[ToxicBot] Console log not found: ${logPath}`);
      console.error('[ToxicBot] Make sure CS2 runs with the -condebug launch option');
      return;
    }

    // Check Ollama connection (only relevant for the local provider)
    const provider = this.config.bot_settings.ai_provider || 'local';
    if (provider !== 'openrouter') {
      try {
        const host = this.config.bot_settings.ollama_host || 'http://127.0.0.1:11434';
        const res = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('Ollama not responding');
        console.log(`[ToxicBot] Ollama connected at ${host}`);
      } catch (err) {
        console.warn(`[ToxicBot] Ollama connection failed: ${err.message}`);
        console.warn('[ToxicBot] Start Ollama or switch to OpenRouter in the dashboard - the bot keeps running');
      }
    }

    // Get initial file size
    try {
      const stat = fs.statSync(logPath);
      this.lastSize = stat.size;
    } catch (err) {
      console.error(`[ToxicBot] Cannot stat log file: ${err.message}`);
      return;
    }

    this.startWatching(logPath);
    this.startHeartbeat();

    console.log(`[ToxicBot] Watching: ${logPath}`);
    console.log('[ToxicBot] Ready - waiting for chat messages...');
  }

  // Heartbeat file so the dashboard (a separate process) can show bot status
  startHeartbeat() {
    const beat = () => {
      fs.promises.writeFile(BOT_STATUS_FILE, JSON.stringify({
        pid: process.pid,
        time: Date.now(),
        watching: this.logPath
      })).catch(() => {});
    };
    beat();
    this.heartbeatTimer = setInterval(beat, 5000);
    this.heartbeatTimer.unref();
  }

  // Coalesce watch events: CS2 spams console.log dozens of times per second
  // during fights (kill feed etc.) - one read per 75ms window instead of one
  // stat+open+read per write keeps disk churn away from the game
  scheduleCheck() {
    if (this.checkTimer) return;
    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      this.checkForNewData();
    }, 75);
  }

  startWatching(logPath) {
    // Event-driven watching (near-instant) with polling as safety net and fallback
    try {
      this.watcher = fs.watch(logPath, () => this.scheduleCheck());
      this.watcher.on('error', err => {
        console.warn(`[ToxicBot] fs.watch failed (${err.message}), falling back to polling`);
        this.fallbackToPolling(logPath, 200);
      });
      // Slow poll as safety net - fs.watch can miss events on some setups
      fs.watchFile(logPath, { interval: 2000 }, () => this.scheduleCheck());
      this.polling = true;
      console.log('[ToxicBot] Using event-driven log watching');
    } catch (err) {
      console.warn(`[ToxicBot] fs.watch unavailable (${err.message}), using polling`);
      this.fallbackToPolling(logPath, 200);
    }
  }

  fallbackToPolling(logPath, interval) {
    try { this.watcher?.close(); } catch {}
    this.watcher = null;
    if (this.polling) fs.unwatchFile(logPath);
    fs.watchFile(logPath, { interval }, () => this.scheduleCheck());
    this.polling = true;
  }

  stop() {
    try { this.watcher?.close(); } catch {}
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.logPath && this.polling) {
      fs.unwatchFile(this.logPath);
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    try { fs.unlinkSync(BOT_STATUS_FILE); } catch {}
    this.messageQueue.clear();
    console.log('[ToxicBot] Stopped');
  }
}

// ============================================
// MAIN
// ============================================
if (require.main === module) {
  const bot = new ToxicBot();

  process.on('unhandledRejection', err => {
    console.error('[ToxicBot] Unhandled rejection:', err?.message || err);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[ToxicBot] Shutting down...');
    bot.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    bot.stop();
    process.exit(0);
  });

  // Start the bot
  bot.start().catch(err => {
    console.error('[ToxicBot] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = ToxicBot;
module.exports.parseChatLine = parseChatLine;
module.exports.MessageQueue = MessageQueue;
