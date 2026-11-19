const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
assert.match(html, /\.holoo-motion-enter\s*\{[^}]*animation-delay:\s*var\(--holoo-motion-delay,0ms\)/s,
  'object entrance animation must support a bounded stagger delay');
assert.match(html, /const motionSelector = \[/,
  'the motion controller must define explicit object targets');
assert.match(html, /'\.bg-white\.rounded-(?:lg|xl|2xl)'/,
  'cards must be included in object-level motion');
assert.match(html, /'button'/,
  'buttons must be included in object-level motion');
assert.match(html, /'\[data-holoo-object\]'/,
  'custom objects must be opt-in animatable');
assert.match(html, /querySelectorAll\(motionSelector\)/,
  'nested objects must be scanned when a container is inserted');
assert.match(html, /observer\.observe\(workspace, \{ childList: true, subtree: true \}\)/,
  'the observer must detect nested object insertion');
assert.match(html, /event\.target !== node/,
  'nested animationend events must not prematurely clear parent animations');
assert.match(html, /prefers-reduced-motion: reduce/,
  'the app must preserve reduced-motion preferences');
console.log('Object-level motion checks passed.');
