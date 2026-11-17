const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const sw = fs.readFileSync('sw.js', 'utf8');

assert.equal(manifest.display, 'standalone');
assert.ok(manifest.display_override.includes('standalone'));
assert.equal(manifest.orientation, 'portrait-primary');
assert.ok(manifest.icons.some(x => x.sizes === '192x192'));
assert.ok(manifest.icons.some(x => x.sizes === '512x512'));
assert.equal(manifest.shortcuts.length, 3);
assert.match(html, /function installAndroidApp\(/);
assert.match(html, /function requestPersistentStorage\(/);
assert.match(html, /beforeinstallprompt/);
assert.match(html, /controllerchange/);
assert.match(html, /viewport-fit=cover/);
assert.match(sw, /holoo-pwa-shell-v3/);
assert.match(sw, /icon-192\.svg/);
assert.match(sw, /icon-512\.svg/);
for (const file of ['icons/icon-192.svg', 'icons/icon-512.svg']) {
  assert.ok(fs.existsSync(file), file + ' must exist');
}
console.log('PASS: 13 Android PWA installation and offline checks');
