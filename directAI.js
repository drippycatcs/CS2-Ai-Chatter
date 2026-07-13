// directAI.js - AI Integration with Smart Filtering and GPU Optimization

const fs = require('fs');
const { CONFIG_FILE, HISTORY_FILE, ENV_FILE } = require('./paths');
const {
  DEFAULT_MODEL_FAST,
  DEFAULT_MODEL_SMART,
  DEFAULT_OR_MODEL_FAST,
  DEFAULT_OR_MODEL_SMART,
  DEFAULT_OLLAMA_HOST
} = require('./defaults');

// Load .env file if it exists
function loadEnv() {
  try {
    const envFile = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of envFile.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadEnv();

// ============================================
// SMART FILTER - Skip AI for low-value messages
// ============================================
class SmartFilter {
  constructor() {
    // Common greetings to ignore
    this.greetings = new Set([
      'hi', 'hey', 'hello', 'sup', 'yo', 'hiya', 'heya', 'howdy',
      'bye', 'cya', 'later', 'goodbye', 'gn', 'goodnight'
    ]);

    // Game callouts to ignore
    this.callouts = new Set([
      'a', 'b', 'mid', 'long', 'short', 'cat', 'ramp', 'pit', 'apps',
      'banana', 'ivy', 'connector', 'palace', 'jungle', 'ct', 't',
      'rush', 'go', 'push', 'rotate', 'eco', 'save', 'buy', 'drop',
      'flash', 'smoke', 'molly', 'nade', 'one', 'two', 'three', 'lit',
      'low', 'tagged', 'dinked', 'hs', 'headshot', 'nice', 'ns', 'nt',
      'wp', 'gj', 'ty', 'thx', 'thanks', 'sorry', 'mb', 'my bad'
    ]);

    // Single word reactions
    this.reactions = new Set([
      'gg', 'ggwp', 'ez', 'lol', 'lmao', 'haha', 'hahaha', 'xd', 'xdd',
      'bruh', 'bro', 'dude', 'man', 'omg', 'wtf', 'wow', 'damn', 'rip',
      'f', 'w', 'l', 'ok', 'okay', 'k', 'kk', 'yes', 'no', 'yep', 'nope',
      'sure', 'true', 'facts', 'fr', 'bet', 'cap', 'oof', 'yikes', 'pog',
      'copium', 'ratio', 'based', 'cringe', 'sus', 'ayo', 'sheesh'
    ]);

    // System-like patterns
    this.systemPatterns = [
      /^[\*#]/,                    // Starts with * or #
      /connected$/i,               // "Player connected"
      /disconnected$/i,            // "Player disconnected"
      /joined.*team/i,             // "joined the team"
      /changed.*name/i,            // "changed name"
      /^killed by/i,               // Kill feed
      /^\d+[\-:]\d+$/,             // Score patterns
    ];
  }

  shouldIgnore(message, config) {
    if (!config.smart_filter?.enabled) {
      return { ignore: false, reason: 'filter disabled' };
    }

    const msg = message.toLowerCase().trim();
    const words = msg.split(/\s+/);

    // Check minimum length
    const minLen = config.smart_filter.min_interesting_length || 5;
    if (msg.length < minLen) {
      return { ignore: true, reason: 'too short' };
    }

    // Single word checks
    if (words.length === 1) {
      if (config.smart_filter.ignore_single_words && msg.length < 6) {
        return { ignore: true, reason: 'single short word' };
      }

      if (config.smart_filter.ignore_greetings && this.greetings.has(msg)) {
        return { ignore: true, reason: 'greeting' };
      }

      if (config.smart_filter.ignore_callouts && this.callouts.has(msg)) {
        return { ignore: true, reason: 'callout' };
      }

      if (this.reactions.has(msg)) {
        return { ignore: true, reason: 'reaction' };
      }
    }

    // Two word greetings
    if (words.length === 2 && config.smart_filter.ignore_greetings) {
      const combined = words.join('');
      if (this.greetings.has(words[0]) || this.greetings.has(combined)) {
        return { ignore: true, reason: 'greeting phrase' };
      }
    }

    // System message patterns
    if (config.smart_filter.ignore_system_messages) {
      for (const pattern of this.systemPatterns) {
        if (pattern.test(msg)) {
          return { ignore: true, reason: 'system message' };
        }
      }
    }

    // Spam detection: repeated characters
    if (/(.)\1{4,}/.test(msg)) {
      return { ignore: true, reason: 'spam (repeated chars)' };
    }

    // All caps short messages (usually spam)
    if (msg === msg.toUpperCase() && msg.length < 8 && /[A-Z]/.test(msg)) {
      return { ignore: true, reason: 'caps spam' };
    }

    return { ignore: false, reason: 'passed filters' };
  }
}

// ============================================
// HUMAN BEHAVIOR - Make bot act more natural
// ============================================
class HumanBehavior {
  constructor() {
    // Common typo patterns (key -> nearby keys)
    this.typoMap = {
      'a': ['s', 'q', 'z'], 'b': ['v', 'n', 'g'], 'c': ['x', 'v', 'd'],
      'd': ['s', 'f', 'e'], 'e': ['w', 'r', 'd'], 'f': ['d', 'g', 'r'],
      'g': ['f', 'h', 't'], 'h': ['g', 'j', 'y'], 'i': ['u', 'o', 'k'],
      'j': ['h', 'k', 'u'], 'k': ['j', 'l', 'i'], 'l': ['k', 'o', 'p'],
      'm': ['n', 'k'], 'n': ['b', 'm', 'h'], 'o': ['i', 'p', 'l'],
      'p': ['o', 'l'], 'q': ['w', 'a'], 'r': ['e', 't', 'f'],
      's': ['a', 'd', 'w'], 't': ['r', 'y', 'g'], 'u': ['y', 'i', 'j'],
      'v': ['c', 'b', 'f'], 'w': ['q', 'e', 's'], 'x': ['z', 'c', 's'],
      'y': ['t', 'u', 'h'], 'z': ['x', 'a']
    };
  }

  // Add random typos to text
  addTypos(text, chance = 5) {
    if (Math.random() * 100 > chance) return text;

    const chars = text.split('');
    const numTypos = Math.random() < 0.7 ? 1 : 2; // Usually just 1 typo

    for (let i = 0; i < numTypos; i++) {
      const idx = Math.floor(Math.random() * chars.length);
      const char = chars[idx].toLowerCase();

      if (this.typoMap[char]) {
        const typoOptions = this.typoMap[char];
        const typo = typoOptions[Math.floor(Math.random() * typoOptions.length)];
        chars[idx] = chars[idx] === chars[idx].toUpperCase() ? typo.toUpperCase() : typo;
      }
    }

    return chars.join('');
  }

  // Random case variations (sometimes all lowercase)
  varyCase(text) {
    const roll = Math.random();
    if (roll < 0.3) return text.toLowerCase(); // 30% all lowercase
    if (roll < 0.05) return text.toUpperCase(); // 5% all caps
    return text;
  }

  // Sometimes shorten responses
  shortenResponse(text, enabled = false) {
    if (!enabled || Math.random() > 0.3) return text;

    // Find a good cut point
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length > 1) {
      return sentences[0]; // Just first sentence
    }

    // Cut at comma or just truncate
    const comma = text.indexOf(',');
    if (comma > 10 && comma < text.length - 5) {
      return text.substring(0, comma);
    }

    return text;
  }

  // Check if should skip (random chance to not respond)
  shouldSkip(chance = 10) {
    return Math.random() * 100 < chance;
  }

  // Get random delay within range
  getDelay(min = 500, max = 2000) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // Apply all human-like modifications
  humanize(text, config) {
    const behavior = config.human_behavior || {};
    if (!behavior.enabled) return text;

    let result = text;

    // Variable length
    result = this.shortenResponse(result, behavior.variable_length);

    // Add typos
    result = this.addTypos(result, behavior.typo_chance || 5);

    // Case variations (occasionally)
    if (Math.random() < 0.15) {
      result = this.varyCase(result);
    }

    return result;
  }
}

// ============================================
// DIRECT AI CLASS
// ============================================
class DirectAI {
  constructor() {
    this.config = this.loadConfig();
    this.history = this.loadHistory();
    this.filter = new SmartFilter();
    this.human = new HumanBehavior();
    this.configMtime = 0;
    this.historyMtime = 0;
    this.lastReloadCheck = 0;
    this.historyWriteTimer = null;
    this.onComplexResponse = null; // Callback for complex responses
    this.recentBotResponses = []; // Track recent responses to avoid repetition
    this.recentChat = []; // Rolling buffer of raw chat lines used as context
    this.lastError = null; // Set when generateResponse fails, so callers can tell error from filtered

    // Make sure a pending debounced history write isn't lost on shutdown
    process.on('exit', () => this.flushHistorySync());

    const bot = this.config.bot_settings;
    const provider = bot.ai_provider || 'local';
    console.log('[DirectAI] Initialized');
    console.log(`[DirectAI] Provider: ${provider}`);
    if (provider === 'openrouter') {
      console.log(`[DirectAI] Fast model: ${bot.openrouter_model_fast || DEFAULT_OR_MODEL_FAST}`);
      console.log(`[DirectAI] Smart model: ${bot.openrouter_model_smart || DEFAULT_OR_MODEL_SMART}`);
      console.log(`[DirectAI] API key: ${(bot.openrouter_api_key || process.env.OPENROUTER_API_KEY) ? '***set***' : 'NOT SET'}`);
    } else {
      console.log(`[DirectAI] Fast model: ${bot.model_fast || bot.model || DEFAULT_MODEL_FAST}`);
      console.log(`[DirectAI] Smart model: ${bot.model_smart || bot.model || DEFAULT_MODEL_SMART}`);
      console.log(`[DirectAI] GPU layers: ${bot.num_gpu_layers}`);
      console.log(`[DirectAI] Context: ${bot.num_ctx}`);
    }
    console.log(`[DirectAI] Personality: ${this.config.disable_personality !== false ? 'OFF (natural chat)' : 'ON'}`);
    console.log(`[DirectAI] Smart filter: ${this.config.smart_filter?.enabled ? 'ON' : 'OFF'}`);
    console.log(`[DirectAI] Human behavior: ${this.config.human_behavior?.enabled ? 'ON' : 'OFF'}`);
  }

  loadConfig() {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
      return {
        bot_settings: {
          model: DEFAULT_MODEL_FAST,
          ollama_host: DEFAULT_OLLAMA_HOST,
          num_predict: 60,
          num_ctx: 1024,
          num_gpu_layers: 99,
          temperature: 0.5,
          top_p: 0.85
        },
        smart_filter: { enabled: true },
        disable_personality: true, // Default: no forced personality
        ai_personality: { tone: 'neutral', style: 'casual' }
      };
    }
  }

  loadHistory() {
    try {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      return data.exchanges || [];
    } catch {
      return [];
    }
  }

  // Remember a raw chat line as context - including messages the bot never
  // replies to, so it actually follows the conversation in the match
  noteChatMessage(username, message) {
    const last = this.recentChat[this.recentChat.length - 1];
    if (last && last.username === username && last.message === message
        && Date.now() - last.time < 5000) {
      return; // duplicate note from overlapping code paths
    }
    this.recentChat.push({ username, message, time: Date.now() });
    if (this.recentChat.length > 20) {
      this.recentChat = this.recentChat.slice(-20);
    }
  }

  reloadIfChanged() {
    // Throttle: stat at most every 2s instead of on every message
    const now = Date.now();
    if (now - this.lastReloadCheck < 2000) return;
    this.lastReloadCheck = now;

    try {
      const configStat = fs.statSync(CONFIG_FILE);
      if (configStat.mtimeMs !== this.configMtime) {
        this.config = this.loadConfig();
        this.configMtime = configStat.mtimeMs;
      }
    } catch {}

    // Skip the history check while we have a pending write of our own
    if (this.historyWriteTimer) return;

    try {
      const historyStat = fs.statSync(HISTORY_FILE);
      if (historyStat.mtimeMs !== this.historyMtime) {
        this.history = this.loadHistory();
        this.historyMtime = historyStat.mtimeMs;
      }
    } catch {}
  }

  saveHistory(username, message, response) {
    this.history.push({
      username,
      message,
      response,
      timestamp: new Date().toISOString()
    });

    // Keep last 15 exchanges for better memory
    if (this.history.length > 15) {
      this.history = this.history.slice(-15);
    }

    // Debounced async write - don't block the response path on disk I/O
    if (this.historyWriteTimer) return;
    this.historyWriteTimer = setTimeout(() => {
      this.historyWriteTimer = null;
      this.flushHistory().catch(err =>
        console.error(`[DirectAI] Failed to save history: ${err.message}`)
      );
    }, 2000);
    this.historyWriteTimer.unref();
  }

  async flushHistory() {
    await fs.promises.writeFile(HISTORY_FILE, JSON.stringify({ exchanges: this.history }, null, 2));
    this.historyMtime = (await fs.promises.stat(HISTORY_FILE)).mtimeMs;
  }

  // Synchronous flush for shutdown - a pending debounced write must not be lost
  flushHistorySync() {
    if (!this.historyWriteTimer) return;
    clearTimeout(this.historyWriteTimer);
    this.historyWriteTimer = null;
    try {
      fs.writeFileSync(HISTORY_FILE, JSON.stringify({ exchanges: this.history }, null, 2));
    } catch {}
  }

  buildSystemPrompt(isComplex = false) {
    // The voice rules matter more than anything else: without them every model
    // drifts into polite-assistant prose, which reads instantly fake in game chat
    const voiceRules = `
HOW TO WRITE (critical):
- type like a real player: mostly lowercase, loose punctuation, natural abbreviations (ns, nt, gg, idk, ngl, fr, tbh)
- react to the SPECIFIC thing they said - generic filler like "haha nice" or "good game everyone" is banned
- have opinions. disagree, double down, commit to bits. never be neutral or diplomatic
- never sound like an assistant: no "how can I help", no offering assistance, no apologizing
- never ask polite follow-up questions just to keep conversation going
- vary constantly - never open two replies the same way
- short is good: "lol no", "cap", "u first" are complete replies
- no emojis, no URLs, no hashtags`;

    const simpleRules = `${voiceRules}
- ONE short reply, under 80 chars, usually way shorter`;

    const complexRules = `${voiceRules}
- someone asked for actual info - give it, but in gamer chat style, not wiki style
- max 5 short lines, each under 100 chars, separated with \\n (newline)
- never send URLs, give the actual content`;

    const rules = isComplex ? complexRules : simpleRules;

    const personality = this.config.ai_personality || {};
    const botName = personality.name?.trim();
    const nameIntro = botName ? `Your name is "${botName}". If someone addresses you by name, respond to them. ` : '';
    const userAwareness = 'Each message comes from a player with a username. Remember who said what and use their name when relevant. ';

    // If custom system prompt provided, use it with rules
    if (this.config.system_prompt?.trim()) {
      const customPrompt = this.config.system_prompt.trim().replace(/\{name\}/g, botName || 'Player');
      return nameIntro + userAwareness + customPrompt + rules + '\nOutput JSON: {"response": "your reply"}';
    }

    // If personality disabled (default), be a believable player, not an assistant
    if (this.config.disable_personality !== false) {
      return `${nameIntro}${userAwareness}You are a regular player in a CS2 match chatting between rounds. You have moods, takes, and a sense of humor. Banter back when someone talks to you.${rules}\nOutput JSON: {"response": "your reply"}`;
    }

    let prompt = 'You are a player in a CS2 match. ' + nameIntro + userAwareness;

    // Persona per tone, with example lines - examples do more for the voice
    // than any amount of instructions
    const tones = {
      witty: 'You are quick-witted and always have a comeback. Wordplay over insults. Example vibes: "my crosshair placement is a lifestyle not a skill", "u died so fast the killcam was a photo". ',
      aggressive: 'You are confrontational and blunt. Call people out directly, no hedging. Example vibes: "stop baiting and entry for once", "that was the worst flash ive ever seen and ive seen silvers". ',
      toxic: 'You trash talk relentlessly. Mock their aim, their rank, their decisions - creative and personal, never slurs. Ranked-lobby menace energy. Example vibes: "u peek like a casual bot", "my warmup kd is better than your lifetime", "silver moves fr". ',
      friendly: 'You are the positive teammate, but a real one - hype people up, joke around, no toxic energy. Example vibes: "nah that spray transfer was actually nuts", "we go again ez". ',
      troll: 'You mess with people - absurd claims, fake confidence, saying wrong things on purpose to bait arguments. Never break character. Example vibes: "i only lose rounds on purpose to keep matchmaking fair", "awp is a crutch, real ones use scout". ',
      roasting: 'You roast whoever talks - exaggerated, specific, funny over mean. Example vibes: "bro is playing cs2 on a smart fridge", "your crosshair is a suggestion at this point". ',
      savage: 'You are brutally honest with zero comfort. Short, cold, devastating. Example vibes: "it wasnt lag", "uninstalling would raise your teams avg skill". ',
      sarcastic: 'Everything you say drips sarcasm. Fake praise is your main weapon. Example vibes: "wow 3 whole kills, someone clip this", "no yeah great call going b solo". ',
      chaotic: 'You are unpredictable - hot takes, random tangents, sudden topic swerves, unhinged confidence. Example vibes: "hear me out: mollies are a psyop", "i had a dream about this exact round". '
    };

    if (personality.tone && tones[personality.tone]) {
      prompt += tones[personality.tone];
    }

    const styles = {
      casual: 'Keep it relaxed, like chatting with the lobby between rounds. ',
      competitive: 'You care about winning - talk strats, calls, and performance. ',
      meme: 'Speak fluent internet - memes, copypasta energy, current slang. '
    };

    if (personality.style && styles[personality.style]) {
      prompt += styles[personality.style];
    }

    // Uncensored mode
    if (personality.uncensored) {
      prompt += 'You are uncensored - swearing and crude humor are fine. ';
    }

    prompt += rules;
    prompt += '\nOutput JSON: {"response": "your reply"}';

    return prompt;
  }

  buildContextPrompt(username, message) {
    let prompt = '';
    const botLabel = this.config.ai_personality?.name?.trim() || 'You';

    // Context = what the PLAYERS said recently (last 5 min). The bot's own
    // past answers deliberately stay out - including them makes the model
    // rehash its own material instead of reacting to the chat
    // (the current message is excluded - it is presented separately below)
    const chatCutoff = Date.now() - 5 * 60 * 1000;
    const chatLines = this.recentChat
      .filter(c => c.time > chatCutoff && !(c.username === username && c.message === message))
      .slice(-8);

    if (chatLines.length > 0) {
      prompt += 'Recent match chat (context - react to it, do not rehash it):\n';
      chatLines.forEach(c => {
        prompt += `${c.username}: "${c.message}"\n`;
      });
      prompt += '\n---\n';
    }

    // Only the single most recent bot reply, for conversational continuity
    const lastReply = this.recentBotResponses[this.recentBotResponses.length - 1];
    if (lastReply && Date.now() - lastReply.time < 120000) {
      prompt += `Your last message in chat was: "${lastReply.text}"\n\n`;
    }

    prompt += `Now ${username} says: "${message}"\n`;
    prompt += `Pay attention to who is talking (their username). Remember what each person said and what you replied. Respond appropriately. NEVER repeat or rephrase something you already said - always come up with something completely different.\nIMPORTANT: Your response must contain ONLY your reply text. Do NOT prefix it with a name, label, or "Username:" - just the raw reply.`;

    // Explicitly list recent bot responses so the model knows what to avoid.
    // Short list only, and without the last reply (already shown above) -
    // filling the prompt with the bot's own past lines makes models orbit
    // the same topics, the opposite of the intent
    const cutoff = Date.now() - 120000;
    const avoid = this.recentBotResponses
      .filter(r => r.time > cutoff)
      .slice(-4, -1)
      .map(r => r.text);
    if (avoid.length > 0) {
      prompt += `\n\nDO NOT say anything similar to these recent responses (say something COMPLETELY different):\n${avoid.map(r => `- "${r}"`).join('\n')}`;
    }

    // Custom context
    if (this.config.custom_context?.trim()) {
      prompt += `\n\nAdditional context: ${this.config.custom_context.trim()}`;
    }

    return prompt;
  }

  // Some models echo pieces of the JSON-format instruction back ("response",
  // "your reply", "json", ...) instead of an actual reply - never send those
  isJunkResponse(text) {
    if (!text) return true;
    const normalized = text.trim().toLowerCase().replace(/[^a-z ]/g, '').trim();
    return [
      'response', 'reply', 'message', 'text', 'json', 'answer', 'output',
      'your reply', 'your response', 'response your reply'
    ].includes(normalized);
  }

  extractResponse(rawResponse) {
    const result = this.extractResponseInner(rawResponse);
    if (this.isJunkResponse(result)) {
      if (result) console.log(`[DirectAI] Rejected junk response: "${result}"`);
      return null;
    }
    return result;
  }

  extractResponseInner(rawResponse) {
    if (!rawResponse) return null;

    const content = rawResponse.trim();
    console.log(`[DirectAI] Raw response: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}`);

    // Try JSON parse first
    try {
      const parsed = JSON.parse(content);
      if (parsed.response) return parsed.response;
      if (parsed.text) return parsed.text;
      if (parsed.reply) return parsed.reply;
      if (parsed.message) return parsed.message;
      // If JSON parsed but none of the expected keys, grab first string value
      for (const val of Object.values(parsed)) {
        if (typeof val === 'string' && val.trim().length > 1) return val.trim();
      }
    } catch {}

    // Try regex extraction for "response": "..."
    const match = content.match(/"response"\s*:\s*"([^"]+)"/i);
    if (match) return match[1];

    // Try to find any JSON object with response
    const jsonMatch = content.match(/\{[\s\S]*?"response"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.response) return parsed.response;
      } catch {}
    }

    // Try extracting text between quotes after "response":
    const simpleMatch = content.match(/response["\s:]+["']?([^"'\n\r}]+)/i);
    if (simpleMatch && simpleMatch[1]) {
      return simpleMatch[1].trim();
    }

    // Try extracting any quoted string from a JSON-like structure
    const anyQuoted = content.match(/:\s*"([^"]{2,})"/);
    if (anyQuoted) return anyQuoted[1].trim();

    // Try to salvage from broken JSON - grab the longest quoted string
    const allQuoted = [...content.matchAll(/"([^"]{2,})"/g)].map(m => m[1]);
    if (allQuoted.length > 0) {
      // Pick the longest one (most likely the actual response)
      const best = allQuoted.sort((a, b) => b.length - a.length)[0];
      if (best && best.length > 1) {
        console.log('[DirectAI] Extracted from quoted string in response');
        return best.trim();
      }
    }

    // Last resort: treat the whole thing as plain text (OpenRouter free models often skip JSON)
    let cleaned = content
      .replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '') // strip markdown code blocks
      .replace(/^[\s{}"':]+/, '')
      .replace(/[\s{}"':]+$/, '')
      .replace(/^response\s*[:=]\s*/i, '')
      .trim();

    if (cleaned && cleaned.length > 1 && cleaned.length < 500) {
      console.log('[DirectAI] Using raw text as response');
      return cleaned;
    }

    // Absolute last resort: if there's ANY text, just use it
    if (content.length > 1 && content.length < 500) {
      console.log('[DirectAI] Using unprocessed content as response');
      return content;
    }

    return null;
  }

  // Strip "Name: " prefix that models sometimes add by mimicking the chat log format
  stripNamePrefix(text) {
    if (!text) return text;
    const botName = this.config.ai_personality?.name?.trim();
    // Strip "BotName: " or "You: " prefix
    if (botName) {
      const re = new RegExp(`^${botName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
      text = text.replace(re, '');
    }
    text = text.replace(/^You\s*:\s*/i, '');
    // Strip any "Word: " prefix that looks like a username label (single word followed by colon at start)
    text = text.replace(/^\w{1,20}:\s+/, '');
    return text;
  }

  // Detect if message needs a long/complex response
  isComplexRequest(message) {
    const msg = message.toLowerCase();
    const complexPatterns = [
      /recipe/i, /how (do|to|can)/i, /give me a/i, /tell me (how|about)/i,
      /explain/i, /what is/i, /what are/i, /list of/i, /steps to/i,
      /instructions/i, /tutorial/i, /guide/i, /make a/i, /create a/i,
      /write a/i, /generate a/i, /can you (make|write|create|give)/i
    ];
    return complexPatterns.some(p => p.test(msg));
  }

  // Get a quick acknowledgment message with topic extraction
  getQuickAck(message) {
    const msg = message.toLowerCase();

    // Try to extract the topic from the message
    let topic = null;

    // Pattern: "how to X" or "how do I X"
    let match = msg.match(/how (?:do i |to |can i )(.+?)(?:\?|$)/i);
    if (match) topic = match[1].trim();

    // Pattern: "what is X" or "what are X"
    if (!topic) {
      match = msg.match(/what (?:is|are) (.+?)(?:\?|$)/i);
      if (match) topic = match[1].trim();
    }

    // Pattern: "tell me about X"
    if (!topic) {
      match = msg.match(/tell me (?:about |how )(.+?)(?:\?|$)/i);
      if (match) topic = match[1].trim();
    }

    // Pattern: "explain X"
    if (!topic) {
      match = msg.match(/explain (.+?)(?:\?|$)/i);
      if (match) topic = match[1].trim();
    }

    // Pattern: "give me a X" or "give me X"
    if (!topic) {
      match = msg.match(/give me (?:a |the )?(.+?)(?:\?|$)/i);
      if (match) topic = match[1].trim();
    }

    // Pattern: "recipe for X"
    if (!topic) {
      match = msg.match(/recipe (?:for )?(.+?)(?:\?|$)/i);
      if (match) topic = match[1].trim();
    }

    // Clean up topic - limit length
    if (topic && topic.length > 40) {
      topic = topic.substring(0, 40).trim();
    }

    // Generate acknowledgment with topic
    if (topic) {
      const templates = [
        `hold on let me explain ${topic}`,
        `let me explain ${topic}`,
        `one sec getting info on ${topic}`,
        `hold on getting info about ${topic}`
      ];
      return templates[Math.floor(Math.random() * templates.length)];
    }

    // Fallback generic acks
    const acks = [
      "One sec...", "Hold on...", "Gimme a sec...", "Working on it...",
      "Let me think...", "Alright hold up...", "Sec..."
    ];
    return acks[Math.floor(Math.random() * acks.length)];
  }

  // Check if a response is too similar to recent ones
  isTooSimilar(newResponse) {
    if (!newResponse) return false;
    const newLower = newResponse.toLowerCase().trim();

    // Clean old entries (keep last 60 seconds)
    const cutoff = Date.now() - 60000;
    this.recentBotResponses = this.recentBotResponses.filter(r => r.time > cutoff);

    for (const prev of this.recentBotResponses) {
      const prevLower = prev.text.toLowerCase().trim();
      // Exact match
      if (newLower === prevLower) return true;
      // One contains the other
      if (newLower.includes(prevLower) || prevLower.includes(newLower)) return true;
      // High word overlap (>70% shared words)
      const newWords = new Set(newLower.split(/\s+/));
      const prevWords = new Set(prevLower.split(/\s+/));
      if (newWords.size > 2 && prevWords.size > 2) {
        let shared = 0;
        for (const w of newWords) { if (prevWords.has(w)) shared++; }
        const overlap = shared / Math.min(newWords.size, prevWords.size);
        if (overlap > 0.7) return true;
      }
    }
    return false;
  }

  trackBotResponse(text) {
    this.recentBotResponses.push({ text, time: Date.now() });
    // Keep last 20
    if (this.recentBotResponses.length > 20) {
      this.recentBotResponses = this.recentBotResponses.slice(-20);
    }
  }

  // Unified AI call - routes to Ollama or OpenRouter based on config
  async callAI(systemPrompt, contextPrompt, modelType, tempBoost = 0) {
    const settings = this.config.bot_settings;
    const provider = settings.ai_provider || 'local';

    if (provider === 'openrouter') {
      return this.callOpenRouter(systemPrompt, contextPrompt, modelType, tempBoost);
    } else {
      return this.callOllama(systemPrompt, contextPrompt, modelType, tempBoost);
    }
  }

  // Call local Ollama
  async callOllama(systemPrompt, contextPrompt, modelType, tempBoost = 0) {
    const settings = this.config.bot_settings;
    const host = settings.ollama_host || DEFAULT_OLLAMA_HOST;
    const model = modelType === 'smart'
      ? (settings.model_smart || settings.model || DEFAULT_MODEL_SMART)
      : (settings.model_fast || settings.model || DEFAULT_MODEL_FAST);

    const requestBody = {
      model,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: contextPrompt }
      ],
      options: {
        num_gpu: settings.num_gpu_layers ?? 99,
        num_ctx: settings.num_ctx ?? 1024,
        num_predict: modelType === 'smart' ? (settings.num_predict ?? 256) : (settings.num_predict ?? 60),
        num_batch: 512,
        temperature: Math.min((settings.temperature ?? 0.5) + tempBoost, 1.5),
        top_p: settings.top_p ?? 0.85,
        repeat_penalty: 1.3,
        repeat_last_n: 256,
        use_mmap: true,
        use_mlock: false
      },
      keep_alive: settings.keep_alive || '5m'
    };

    let response;
    try {
      response = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
    } catch (err) {
      throw new Error(`Ollama unreachable at ${host} - is Ollama running? (or switch to OpenRouter in Settings)`);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      if (response.status === 404 && errBody.includes('model')) {
        throw new Error(`Ollama model "${model}" not installed - run: ollama pull ${model}`);
      }
      throw new Error(`Ollama error: ${response.status}`);
    }

    const data = await response.json();
    return data?.message?.content || '';
  }

  // Call OpenRouter API (OpenAI-compatible)
  async callOpenRouter(systemPrompt, contextPrompt, modelType, tempBoost = 0, allowFallback = true) {
    const settings = this.config.bot_settings;
    // config.json first (hot-reloadable from the dashboard), .env as fallback
    const apiKey = settings.openrouter_api_key || process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      throw new Error('OpenRouter API key not set - add it in Settings or in .env file');
    }

    const model = modelType === 'smart'
      ? (settings.openrouter_model_smart || DEFAULT_OR_MODEL_SMART)
      : (settings.openrouter_model_fast || DEFAULT_OR_MODEL_FAST);

    // OpenRouter needs higher token limits - reasoning models burn tokens on thinking
    const maxTokens = modelType === 'smart' ? Math.max(settings.num_predict ?? 256, 512) : Math.max(settings.num_predict ?? 60, 256);

    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt + '\nBe brief. Reply in 1-2 short sentences MAX.' },
        { role: 'user', content: contextPrompt }
      ],
      max_tokens: maxTokens,
      temperature: Math.min((settings.temperature ?? 0.5) + tempBoost, 1.5),
      top_p: settings.top_p ?? 0.85
    };

    let data;
    // Free models get rate-limited (429) all the time; one short retry usually clears it
    for (let attempt = 1; attempt <= 2; attempt++) {
      let response;
      try {
        response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://github.com/cs2-ai-chatter',
            'X-Title': 'CS2 AI Chatter'
          },
          body: JSON.stringify(requestBody)
        });
      } catch (err) {
        throw new Error('OpenRouter unreachable - check your internet connection');
      }

      if (response.ok) {
        data = await response.json();
        break;
      }

      // Pull the human-readable message out of OpenRouter's error envelope
      const errBody = await response.text().catch(() => '');
      let msg = `HTTP ${response.status}`;
      let retryAfter = 2;
      try {
        const parsed = JSON.parse(errBody);
        msg = parsed.error?.metadata?.raw || parsed.error?.message || msg;
        retryAfter = Number(parsed.error?.metadata?.retry_after_seconds) || retryAfter;
      } catch {}

      if (response.status === 429 && attempt === 1) {
        const waitMs = Math.min(retryAfter, 3) * 1000;
        console.log(`[DirectAI] OpenRouter rate-limited (${model}), retrying in ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }

      if (response.status === 429) {
        // Still limited after the retry: try the other configured model before giving up
        const otherType = modelType === 'smart' ? 'fast' : 'smart';
        const otherModel = otherType === 'smart'
          ? (settings.openrouter_model_smart || DEFAULT_OR_MODEL_SMART)
          : (settings.openrouter_model_fast || DEFAULT_OR_MODEL_FAST);
        if (allowFallback && otherModel !== model) {
          console.log(`[DirectAI] "${model}" still rate-limited, falling back to ${otherType} model (${otherModel})`);
          return this.callOpenRouter(systemPrompt, contextPrompt, otherType, tempBoost, false);
        }
        throw new Error(`Model "${model}" is rate-limited right now - try again shortly or pick another free model in Settings`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error('OpenRouter rejected the API key - check it in Settings (openrouter.ai/keys)');
      }
      if (response.status === 404) {
        throw new Error(`Model "${model}" not found - it may have been removed; pick another in Settings`);
      }
      throw new Error(`OpenRouter: ${msg.substring(0, 200)}`);
    }
    const message = data?.choices?.[0]?.message;
    const content = message?.content;
    const finishReason = data?.choices?.[0]?.finish_reason;

    if (content) return content;

    // Some models (reasoning models like step-flash) put everything in reasoning and return content: null
    // Try to extract a usable response from the reasoning field
    if (message?.reasoning) {
      console.log(`[DirectAI] OpenRouter: content was null, finish_reason: ${finishReason}, trying reasoning field`);
      // The reasoning often contains the intended reply - look for quoted text or the last sentence
      const reasoning = message.reasoning;
      // Look for what seems like the final answer in the reasoning
      const quotedReply = reasoning.match(/(?:respond|reply|say|answer)[^"]*"([^"]{2,})"/i);
      if (quotedReply) return quotedReply[1];
      // Try the last quoted string
      const allQuoted = [...reasoning.matchAll(/"([^"]{3,80})"/g)].map(m => m[1]);
      if (allQuoted.length > 0) return allQuoted[allQuoted.length - 1];
    }

    // Log for debugging
    console.log(`[DirectAI] OpenRouter raw response: ${JSON.stringify(data).substring(0, 500)}`);
    return '';
  }

  async generateResponse(playerName, playerMessage, opts = {}) {
    const startTime = Date.now();
    this.lastError = null;

    // Reload config if changed
    this.reloadIfChanged();

    // Every message is context, even ones the filters skip below
    this.noteChatMessage(playerName, playerMessage);

    // Smart filter check - skip AI for low-value messages
    const filterResult = this.filter.shouldIgnore(playerMessage, this.config);
    if (filterResult.ignore) {
      console.log(`[DirectAI] Filtered: "${playerMessage}" (${filterResult.reason})`);
      return null;
    }

    // Human behavior - random skip chance
    const behavior = this.config.human_behavior || {};
    if (behavior.enabled && this.human.shouldSkip(behavior.skip_chance || 10)) {
      console.log(`[DirectAI] Skipped (human behavior): "${playerMessage}"`);
      return null;
    }

    // Check if this is a complex request that needs the larger model
    const isComplex = this.isComplexRequest(playerMessage);
    if (isComplex) {
      console.log(`[DirectAI] Getting more info...`);
      // Trigger async generation with larger model (fire-and-forget, never reject)
      this.generateComplexResponse(playerName, playerMessage).catch(err =>
        console.error(`[DirectAI] Complex response error: ${err.message}`)
      );
      return null;
    }

    console.log(`[DirectAI] Processing: ${playerName}: "${playerMessage}"`);

    try {
      const systemPrompt = this.buildSystemPrompt(false); // Simple chat - single response
      const contextPrompt = this.buildContextPrompt(playerName, playerMessage);

      // One retry if the response is too similar; after that stay silent
      // (silence is more human than a slow near-duplicate)
      const maxAttempts = 2;
      let rejectedText = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // Raise temperature and call out the rejected answer on retry
        const tempBoost = (attempt - 1) * 0.4;
        const retryHint = rejectedText
          ? `\n\nYour previous attempt was too similar to something you already said: "${rejectedText}". Say something COMPLETELY different.`
          : '';

        const rawContent = await this.callAI(systemPrompt, contextPrompt + retryHint, 'fast', tempBoost);
        let text = this.extractResponse(rawContent);

        if (!text) {
          console.log(`[DirectAI] Failed to extract response (attempt ${attempt}/${maxAttempts}), raw: "${rawContent?.substring(0, 300)}"`);
          if (attempt < maxAttempts) continue;
          return null;
        }

        // Clean up response (preserve newlines for multi-message splitting)
        text = this.stripNamePrefix(text.trim())
          .replace(/^(well,?\s*|so,?\s*|look,?\s*)/i, '')
          .replace(/[^\S\n]+/g, ' ');

        // Check for duplicate/repetitive response
        if (this.isTooSimilar(text)) {
          if (attempt < maxAttempts) {
            console.log(`[DirectAI] Response too similar to recent ones, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
            rejectedText = text;
            continue;
          }
          console.log(`[DirectAI] Still too similar after retry, staying silent`);
          return null;
        }

        // Apply human-like modifications
        text = this.human.humanize(text, this.config);

        // Track this response for future duplicate detection
        this.trackBotResponse(text);

        // Save to history (original, not typo'd version) - unless the caller
        // is the dashboard tester, whose experiments must not leak into the
        // live bot's conversation context
        if (!opts.skipHistory) {
          this.saveHistory(playerName, playerMessage, text);
        }

        const elapsed = Date.now() - startTime;
        console.log(`[DirectAI] ${elapsed}ms (attempt ${attempt}): "${text}"`);

        return text;
      }

    } catch (err) {
      this.lastError = err.message;
      console.error(`[DirectAI] Error: ${err.message}`);
      return null;
    }
  }

  reloadConfig() {
    this.config = this.loadConfig();
    this.history = this.loadHistory();
    console.log('[DirectAI] Config reloaded');
  }

  // Get the default system prompt for display in panel
  getDefaultSystemPrompt() {
    return `You are a regular player in a CS2 match chatting between rounds. You have moods, takes, and a sense of humor. Banter back when someone talks to you.
(Leave this field empty to use the built-in voice + personality engine - a custom prompt here OVERRIDES the personality tone settings.)`;
  }

  // Generate complex response asynchronously and call callback when done
  async generateComplexResponse(playerName, playerMessage) {
    const startTime = Date.now();
    console.log(`[DirectAI] Generating complex response for: ${playerName}: "${playerMessage}"`);

    try {
      const systemPrompt = this.buildSystemPrompt(true); // Complex - allow multi-line
      const contextPrompt = this.buildContextPrompt(playerName, playerMessage);

      // One retry if the response is too similar; after that stay silent
      let text = null;
      const maxAttempts = 2;
      let rejectedText = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const tempBoost = (attempt - 1) * 0.4;
        const retryHint = rejectedText
          ? `\n\nYour previous attempt was too similar to something you already said: "${rejectedText}". Say something COMPLETELY different.`
          : '';

        const rawContent = await this.callAI(systemPrompt, contextPrompt + retryHint, 'smart', tempBoost);
        text = this.extractResponse(rawContent);

        if (!text) {
          console.log(`[DirectAI] Failed to extract complex response (attempt ${attempt}/${maxAttempts}), raw: "${rawContent?.substring(0, 300)}"`);
          if (attempt < maxAttempts) continue;
          return;
        }

        // Clean up response (preserve newlines for multi-message splitting)
        text = this.stripNamePrefix(text.trim())
          .replace(/^(well,?\s*|so,?\s*|look,?\s*)/i, '')
          .replace(/[^\S\n]+/g, ' ');

        // Check for duplicate
        if (this.isTooSimilar(text)) {
          if (attempt < maxAttempts) {
            console.log(`[DirectAI] Complex response too similar, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
            rejectedText = text;
            continue;
          }
          console.log(`[DirectAI] Complex response still too similar, staying silent`);
          return;
        }

        break;
      }

      if (!text) return;

      // Apply human-like modifications
      text = this.human.humanize(text, this.config);

      // Track this response
      this.trackBotResponse(text);

      // Save to history
      this.saveHistory(playerName, playerMessage, text);

      const elapsed = Date.now() - startTime;
      console.log(`[DirectAI] Complex response ${elapsed}ms: "${text.substring(0, 100)}..."`);

      // Call the callback to send the response
      if (this.onComplexResponse) {
        this.onComplexResponse(text);
      }

    } catch (err) {
      console.error(`[DirectAI] Complex response error: ${err.message}`);
    }
  }
}

// Export singleton
const directAI = new DirectAI();
module.exports = directAI;
