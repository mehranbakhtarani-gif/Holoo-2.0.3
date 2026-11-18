const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const [index, source] of scripts.entries()) new vm.Script(source, { filename: 'index.html:inline-script-' + index });

assert.match(html, /id="modal-barcode-settings"/);
assert.match(html, /id="barcode-edit-value"/);
assert.match(html, /id="barcode-label-count"/);
assert.match(html, /id="barcode-label-size"/);
assert.match(html, /function saveBarcodeLabelSettings\(\)/);
assert.match(html, /function renderBarcodeLabelPreview\(p, count, size\)/);
assert.match(html, /format: 'CODE128'/);
assert.match(html, /jsbarcode@3\.11\.6/);

const start = html.indexOf('    function saveBarcodeLabelSettings() {');
const end = html.indexOf('    function renderBarcodeLabelPreview', start);
assert.ok(start >= 0 && end > start, 'barcode settings save function must exist');
const save = html.slice(start, end);
assert.match(save, /count < 1 \|\| count > 200/);
assert.match(save, /state\.products\.some/);
assert.match(save, /addAudit\(/);
assert.match(save, /saveState\(\)/);
assert.doesNotMatch(save, /postVoucher|\.stock\s*=|\.kardex\s*=/, 'barcode editing must not alter inventory or accounting documents');
assert.match(html, /Array\.from\(\{ length: count \}/);
console.log('PASS: barcode editing validates uniqueness, persists through saveState, and prints configurable label batches without stock or voucher changes');
