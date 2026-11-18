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
assert.match(sw, /holoo-pwa-shell-v7/);
assert.match(sw, /import-domain\.js/);
assert.match(sw, /icon-192\.svg/);
assert.match(sw, /icon-512\.svg/);
for (const file of ['icons/icon-192.svg', 'icons/icon-512.svg']) {
  assert.ok(fs.existsSync(file), file + ' must exist');
}

assert.match(sw, /Supabase and other API\/auth traffic must always go to the network/);
assert.match(sw, /request\.mode === 'navigate'/);
assert.match(sw, /holoo-pwa-/);
assert.match(sw, /self\.clients\.claim\(\)/);
assert.match(html, /request\.onblocked = \(\) => finish\(/);
assert.match(html, /const openTimer = setTimeout\(/);
assert.match(html, /باز کردن حافظه محلی بیش از حد طول کشید/);
assert.match(html, /db\.onversionchange = \(\) => db\.close\(\)/);
assert.match(html, /async function fetchWithTimeout\(/);
assert.match(html, /مهلت پاسخ Supabase تمام شد/);
assert.match(html, /در حال آماده‌سازی حافظه محلی/);
assert.match(html, /new Promise\(resolve => setTimeout\(\(\) => resolve\(false\), 15000\)\)/);
assert.match(html, /محیط محلی باز شد؛ آماده‌سازی حافظه کامل نشد و همگام‌سازی خودکار متوقف شد/);
assert.match(html, /محیط حسابداری باز است؛ بررسی صف کامل نشد و همگام‌سازی خودکار متوقف شد/);
assert.match(html, /اتصال خودکار ناموفق؛ نسخه محلی حفظ شد/);
assert.match(html, /else await pullFromSupabase\(false\)/);
const releaseGuide = fs.readFileSync('docs/ANDROID_PWA_RELEASE_READINESS.md', 'utf8');
assert.match(releaseGuide, /not a native Android project/i);
assert.match(releaseGuide, /three-device acceptance test/i);
assert.match(releaseGuide, /actor names and device labels are not verified identities/i);

console.log('PASS: Android PWA installation, cache safety, and release-readiness checks');

// Startup must reveal the accounting UI before waiting for cloud queue inspection.
const startupIndex = html.indexOf("window.addEventListener('DOMContentLoaded'");
const startup = html.slice(startupIndex);
assert.ok(startup.indexOf("navigateTo('dashboard')") < startup.indexOf("renderCloudSyncStatus()"), 'dashboard must open before cloud status inspection');
assert.match(html, /const failedModules = \[\]/);
assert.match(html, /Holoo module rendering failed/);
assert.match(html, /محیط حسابداری باز است؛ بررسی صف کامل نشد/);
