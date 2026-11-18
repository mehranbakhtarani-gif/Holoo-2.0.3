const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const lockKey = "const DEVICE_ACTOR_LOCK_KEY = STORE_KEY + '_device_actor_lock_v1';";

assert.ok(html.includes(lockKey), 'device actor lock key must be versioned and local to this installation');
assert.match(html, /function isDeviceActorLocked\(\)[\s\S]*?localStorage\.getItem\(DEVICE_ACTOR_LOCK_KEY\) === actor/);
assert.match(html, /id="modal-device-actor-setup"/);
assert.match(html, /id="device-actor-setup-select"/);
assert.match(html, /function confirmDeviceActorAssignment\(\)[\s\S]*?localStorage\.setItem\(DEVICE_ACTOR_KEY, actor\)[\s\S]*?localStorage\.setItem\(DEVICE_ACTOR_LOCK_KEY, actor\)[\s\S]*?window\.location\.reload\(\)/);

const roleChangeStart = html.indexOf('    function changeUserRole(r) {');
const roleChangeEnd = html.indexOf('    const USER_ROLE_LABELS', roleChangeStart);
assert.ok(roleChangeStart >= 0 && roleChangeEnd > roleChangeStart, 'changeUserRole function must exist');
const roleChange = html.slice(roleChangeStart, roleChangeEnd);
assert.match(roleChange, /if \(isDeviceActorLocked\(\)\)/, 'locked devices must reject role changes');
assert.match(roleChange, /کاربر این دستگاه قبلاً تثبیت شده و قابل تغییر نیست/);
assert.doesNotMatch(roleChange, /localStorage\.setItem\(DEVICE_ACTOR_KEY, r\)/, 'ordinary role changes must not rewrite the locked device identity');

const startup = html.slice(html.indexOf("window.addEventListener('DOMContentLoaded'"));
const setupGate = startup.indexOf("if (!isDeviceActorLocked())");
const cloudSync = startup.indexOf('renderCloudSyncStatus()');
assert.ok(setupGate >= 0 && cloudSync > setupGate, 'device identity must be confirmed before cloud sync starts');
assert.match(startup.slice(setupGate, cloudSync), /modal-device-actor-setup/);
assert.match(startup.slice(setupGate, cloudSync), /return;/, 'startup must stop before cloud sync while device assignment is pending');

assert.match(html, /جایگزین ورود امن یا کنترل دسترسی سرور نیست/);
console.log('PASS: device-local operator assignment, one-time lock, and cloud-sync startup gate');
