const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');

assert.match(html, /پشتیبان‌گیری و بازیابی/);
assert.match(html, /Google Drive/);
assert.match(html, /بدون ارسال خودکار به Google Drive/);
assert.match(html, /اتصال حساب گوگل هنوز راه‌اندازی نشده است/);
assert.match(html, /تنظیمات همگام‌سازی Supabase/);
assert.match(html, /if \(f\.size > 50 \* 1024 \* 1024\)/, 'oversized backup files must be rejected');
assert.match(html, /پیش از بازیابی نسخه محلی/);
assert.match(html, /پیش از بازیابی فایل JSON/);
assert.match(html, /اطلاعات فعلی با فایل انتخاب‌شده جایگزین می‌شود/);
assert.match(html, /Holoo_Backup_/);
console.log('PASS: minimal manual backup UI and non-destructive restore guards');
