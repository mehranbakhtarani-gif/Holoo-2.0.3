const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/gi)].map(match => match[1]).filter(source => source.trim());
for (const [index, source] of scripts.entries()) new vm.Script(source, { filename: `index.html:inline-script-${index}` });

assert.match(html, /✏️ ویرایش مشخصات/);
assert.match(html, /function openPartyModal\\(partyId = null\\)/);
assert.match(html, /let editingPartyId = null/);
assert.match(html, /Object\\.assign\\(party, \\{ name, phone, ecoCode, creditLimit, terms \\}\\)/);
assert.match(html, /np-role'\\)\\.disabled = Boolean\\(party\\)/);
assert.match(html, /addAudit\\('ویرایش مشخصات طرف حساب'/);

const saveStart = html.indexOf('    function saveParty() {');
const saveEnd = html.indexOf('    // =========================================================================', saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, 'saveParty function must exist');
const save = html.slice(saveStart, saveEnd);
const editStart = save.indexOf('      if (editingPartyId !== null) {');
const editEnd = save.indexOf('      const partyId =', editStart);
assert.ok(editStart >= 0 && editEnd > editStart, 'editing branch must be isolated from party creation');
const edit = save.slice(editStart, editEnd);
assert.match(edit, /Object\\.assign\\(party/);
assert.match(edit, /saveState\\(\\)/);
assert.doesNotMatch(edit, /postVoucher|subledgerId\\s*=|ledgerAccountCode\\s*=/, 'editing must not post vouchers or change accounting identity');
assert.match(edit, /party\\.id/);
assert.match(save, /String\\(p\\.id\\) !== String\\(editingPartyId\\)/);
console.log('PASS: party editing preserves accounting identity and balances without posting vouchers');
