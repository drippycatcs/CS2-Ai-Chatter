// keypress/index.js - Key press via Windows user32.dll (no build tools needed)
// Uses koffi FFI to call keybd_event directly

const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

// void keybd_event(BYTE bVk, BYTE bScan, DWORD dwFlags, ULONG_PTR dwExtraInfo)
const keybd_event = user32.func('void __stdcall keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');

const KEYEVENTF_KEYUP = 0x0002;

// Virtual key code lookup
const VK_CODES = {
  // Letters
  'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45, 'f': 0x46,
  'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A, 'k': 0x4B, 'l': 0x4C,
  'm': 0x4D, 'n': 0x4E, 'o': 0x4F, 'p': 0x50, 'q': 0x51, 'r': 0x52,
  's': 0x53, 't': 0x54, 'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58,
  'y': 0x59, 'z': 0x5A,
  // Numbers
  '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
  '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
  // Special keys
  'enter': 0x0D, 'return': 0x0D,
  'tab': 0x09,
  'space': 0x20,
  'escape': 0x1B, 'esc': 0x1B,
  'backspace': 0x08,
  'shift': 0x10,
  'control': 0x11, 'ctrl': 0x11,
  'alt': 0x12,
  'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73, 'f5': 0x74, 'f6': 0x75,
  'f7': 0x76, 'f8': 0x77, 'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
  'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
  'delete': 0x2E, 'insert': 0x2D,
  'home': 0x24, 'end': 0x23,
  'pageup': 0x21, 'pagedown': 0x22,
};

/**
 * Press and release a key by virtual key code.
 * @param {number} vkCode - Windows virtual key code
 */
function pressKey(vkCode) {
  keybd_event(vkCode, 0, 0, 0);              // key down
  keybd_event(vkCode, 0, KEYEVENTF_KEYUP, 0); // key up
}

/**
 * Press V key (convenience for CS2 config exec).
 */
function pressV() {
  pressKey(0x56);
}

/**
 * robotjs-compatible keyTap. Press and release a key by name.
 * @param {string} key - Key name (e.g. 'v', 'enter', 'space')
 */
function keyTap(key) {
  const vk = VK_CODES[key.toLowerCase()];
  if (vk === undefined) {
    throw new Error(`Unknown key: "${key}". Use a VK code with pressKey() instead.`);
  }
  pressKey(vk);
}

module.exports = { pressKey, pressV, keyTap, VK_CODES };
