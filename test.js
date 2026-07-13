// test.js - Smoke tests for the chat parser and message splitting.
// Plain asserts, no framework. Run with: npm test

const assert = require('assert');
const { parseChatLine, MessageQueue } = require('./toxicBot.js');

console.log('Testing chat line parser...');

// Standard [ALL] chat
let r = parseChatLine('[ALL] PlayerOne: hello there');
assert(r, 'should parse [ALL] chat');
assert.strictEqual(r.scope, 'ALL');
assert.strictEqual(r.name, 'PlayerOne');
assert.strictEqual(r.message, 'hello there');

// [TEAM] chat with [DEAD] tag and timestamp
r = parseChatLine('07/13 21:45:03 [ALL] [DEAD] Some Guy: nice shot');
assert(r, 'should parse timestamped dead chat');
assert.strictEqual(r.scope, 'ALL');
assert.strictEqual(r.name, 'Some Guy');
assert.strictEqual(r.message, 'nice shot');

// Name in parentheses
r = parseChatLine('[TEAM] (weird:name): rush b');
assert(r, 'should parse parenthesized names');
assert.strictEqual(r.scope, 'TEAM');
assert.strictEqual(r.name, 'weird:name');
assert.strictEqual(r.message, 'rush b');

// Non-chat lines must not parse
assert.strictEqual(parseChatLine('Host activate: loading map'), null);
assert.strictEqual(parseChatLine(''), null);
assert.strictEqual(parseChatLine('[ALL] NoMessageHere'), null);

console.log('  OK - parser');

console.log('Testing message splitting...');

const queue = new MessageQueue({ bot_settings: {} });

// Short messages stay whole
assert.deepStrictEqual(queue.splitResponse('short one', 128), ['short one']);

// Long messages split under the limit
const long = 'This is a long sentence. '.repeat(10).trim();
const chunks = queue.splitResponse(long, 60);
assert(chunks.length > 1, 'long text should split into multiple chunks');
for (const c of chunks) {
  assert(c.length <= 60, `chunk exceeds limit: "${c}" (${c.length})`);
}

// Empty input
assert.deepStrictEqual(queue.splitResponse('', 128), []);

console.log('  OK - splitting');

console.log('Testing AI response extraction...');

const directAI = require('./directAI.js');

// Normal JSON responses extract cleanly
assert.strictEqual(directAI.extractResponse('{"response": "nice try buddy"}'), 'nice try buddy');
assert.strictEqual(directAI.extractResponse('```json\n{"response": "sure thing"}\n```'), 'sure thing');
assert.strictEqual(directAI.extractResponse('just plain text reply'), 'just plain text reply');

// Junk echoes of the format instruction must be rejected, not sent to chat
assert.strictEqual(directAI.extractResponse('response'), null);
assert.strictEqual(directAI.extractResponse('"response"'), null);
assert.strictEqual(directAI.extractResponse('your reply'), null);
assert.strictEqual(directAI.extractResponse('{"response": "response"}'), null);
assert.strictEqual(directAI.extractResponse('json'), null);
assert.strictEqual(directAI.extractResponse(''), null);

console.log('  OK - extraction');
console.log('\nAll tests passed.');
process.exit(0);
