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
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
assert.equal(manifest.lang, 'fa');
assert.equal(manifest.dir, 'rtl');
assert.equal(manifest.shortcuts.length, 3);
assert.match(html, /function installAndroidApp\(/);
assert.match(html, /function requestPersistentStorage\(/);
assert.match(html, /beforeinstallprompt/);
assert.match(html, /controllerchange/);
assert.match(html, /viewport-fit=cover/);
assert.match(html, /input\[data-jalali-calendar-ready="1"\] \{ direction:ltr !important; unicode-bidi:isolate; text-align:center; \}/, 'Jalali numeric dates must render left-to-right in the RTL interface');
assert.match(html, /input\.value = jalaliCalendarYear \+ '\/' \+ String\(jalaliCalendarMonth\)\.padStart\(2, '0'\) \+ '\/' \+ String\(day\)\.padStart\(2, '0'\)/, 'calendar selection must write YYYY/MM/DD order');
assert.match(html, /Jalali date fields use YYYY\/MM\/DD/, 'date inputs must use year-first Jalali order');
assert.match(html, /return digits\.slice\(0, 4\) \+ '\/' \+ digits\.slice\(4, 6\) \+ '\/' \+ digits\.slice\(6, 8\)/, 'typed Jalali dates must format as YYYY/MM/DD');
// The cache version must be versioned, but this test must not pin it to an obsolete release.
assert.match(sw, /holoo-pwa-shell-v\d+/);
assert.match(sw, /import-domain\.js/);
// Every first-party script referenced by the page must be pre-cached at install,
// not merely cached after its first successful online request.
const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
assert.ok(shellMatch, 'service worker must declare an app shell');
const shellAssets = [...shellMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
const localScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+\.js)["']/gi)].map(match => match[1]).filter(src => src.startsWith('./'));
assert.ok(localScripts.length > 0, 'page must expose first-party script assets');
for (const script of localScripts) {
  assert.ok(shellAssets.includes(script), script + ' must be pre-cached in APP_SHELL');
  assert.ok(fs.existsSync(script.slice(2)), script + ' must exist in the release');
}
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
assert.match(html, /if \(typeof navigator !== 'undefined' && navigator\.onLine === false\)/, 'manual cloud pull must not run while the browser reports offline');
assert.match(html, /📴 آفلاین؛ نسخه محلی فعال است/, 'offline startup must clearly report that the local snapshot remains active');
const offlineStartupGuard = html.indexOf("if (typeof navigator !== 'undefined' && navigator.onLine === false)", html.indexOf("window.addEventListener('DOMContentLoaded'"));
const startupCloudAttempt = html.indexOf("در حال اتصال و بررسی Supabase...", html.indexOf("window.addEventListener('DOMContentLoaded'"));
assert.ok(offlineStartupGuard >= 0 && offlineStartupGuard < startupCloudAttempt, 'offline startup must exit before any automatic Supabase request');
assert.match(html, /const diagnostic = String\(err\?\.message \|\| err \|\| 'خطای نامشخص'\)\.slice\(0, 180\)/, 'cloud pull failures must retain a concise diagnostic');
assert.match(html, /else pullFromSupabase\(false\)/, 'reconnecting without a pending outbox must retry cloud pull');
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
