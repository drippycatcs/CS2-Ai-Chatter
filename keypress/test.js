// Quick test - opens a 3 second window then presses V
// Focus a text editor or notepad to see the key press appear

const { keyTap, pressV } = require('./index');

console.log('keypress module loaded OK');
console.log('Pressing V in 3 seconds... (focus a text editor to see it)');

setTimeout(() => {
  console.log('Pressing V now...');
  keyTap('v');
  console.log('Done! Check your text editor for a "v" character.');
}, 3000);
