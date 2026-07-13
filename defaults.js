// defaults.js - Single source of truth for default model names.
// directAI.js and dashboard.js import these; the dashboard exposes them
// via /api/bot-settings so the frontend never hardcodes model ids.

module.exports = {
  DEFAULT_MODEL_FAST: 'llama3.2:3b',
  DEFAULT_MODEL_SMART: 'llama3.2:3b',
  DEFAULT_OR_MODEL_FAST: 'openai/gpt-oss-20b:free',
  DEFAULT_OR_MODEL_SMART: 'openai/gpt-oss-120b:free',
  DEFAULT_OLLAMA_HOST: 'http://127.0.0.1:11434'
};
