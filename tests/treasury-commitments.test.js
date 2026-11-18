const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202611180003_guarantees_payable_commitments.sql', 'utf8');
for (const token of ['guarantees: []','payableCommitments: []',"'guarantees', 'payableCommitments'",'function saveGuaranteeRecord()','function changeGuaranteeStatus(','function savePayableCommitment()','function changePayableCommitmentStatus(','renderGuaranteesAndCommitments()','ضمانت‌نامه‌ها و وثایق','تعهدات پرداختنی']) {
  assert(html.includes(token), 'missing contract: ' + token);
}
const guaranteeFn = html.slice(html.indexOf('function saveGuaranteeRecord()'), html.indexOf('function changeGuaranteeStatus('));
const commitmentFn = html.slice(html.indexOf('function savePayableCommitment()'), html.indexOf('function changePayableCommitmentStatus('));
assert(!guaranteeFn.includes('postVoucher('), 'guarantee register must remain memorandum-only');
assert(!commitmentFn.includes('postVoucher('), 'commitment register must remain memorandum-only');
assert(guaranteeFn.includes('amount <= 0') && guaranteeFn.includes('jalaliDateLooksValid'), 'guarantee validation missing');
assert(commitmentFn.includes('amount <= 0') && commitmentFn.includes('jalaliDateLooksValid'), 'commitment validation missing');
assert(migration.includes("'guarantees', 'payableCommitments'"), 'RPC allowlist missing collections');
assert(migration.includes('does not modify RLS policies'), 'RLS policy boundary missing');
console.log('PASS: guarantee and payable commitment controls');
