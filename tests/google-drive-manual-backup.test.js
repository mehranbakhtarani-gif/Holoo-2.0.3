const fs = require('node:fs');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const driveStart = html.indexOf('// Google Drive: explicit, user-triggered backup and restore only');
const driveEnd = html.indexOf('// 13. MASTER RENDER & STARTUP CLOUD SYNC', driveStart);
assert.notEqual(driveStart, -1, 'Google Drive module must exist');
assert.notEqual(driveEnd, -1, 'Google Drive module must have a clear boundary');
const drive = html.slice(driveStart, driveEnd);

assert.match(html, /id="drive-connect-button"[^>]*onclick="connectGoogleDrive\(true\)"/);
assert.match(html, /onclick="uploadBackupToGoogleDrive\(\)"/);
assert.match(html, /onclick="listGoogleDriveBackups\(\)"/);
assert.match(html, /onclick="disconnectGoogleDrive\(\)"/);
assert.match(html, /id="drive-backup-list"/);

assert.match(drive, /https:\/\/accounts\.google\.com\/gsi\/client/);
assert.match(drive, /initTokenClient/);
assert.match(drive, /prompt: selectAccount \? 'select_account' : ''/);
assert.match(drive, /https:\/\/www\.googleapis\.com\/auth\/drive\.file/);
assert.doesNotMatch(drive, /drive\.scope|auth\/drive['"]/);
assert.match(drive, /uploadType=multipart/);
assert.match(drive, /files\?q=/);
assert.match(drive, /alt=media/);
assert.match(drive, /isValidBackupData\(parsed\)/);
assert.match(drive, /createSnapshot\('پیش از بازیابی Google Drive', false\)/);
assert.match(drive, /if \(!saveState\(\)\)[\s\S]*?state = previous/);
assert.match(drive, /google\.accounts\.oauth2\.revoke/);

assert.match(drive, /driveAccessToken = response\.access_token/);
assert.doesNotMatch(drive, /localStorage\.setItem\([^,]*(?:token|access)/i, 'OAuth access tokens must not be persisted');
assert.doesNotMatch(drive, /setInterval|setTimeout/, 'Drive must not run scheduled or automatic backup work');
assert.doesNotMatch(drive, /addEventListener\(['"](?:load|online|visibilitychange)/, 'Drive backup must not be triggered by lifecycle events');

assert.match(html, /meta name="holoo-google-oauth-client-id" content=""/);
assert.match(html, /هیچ فایلی خودکار ارسال نمی‌شود/);
console.log('PASS: Google Drive account chooser, least-privilege scope, manual backup/restore, token handling, and restore safety');
