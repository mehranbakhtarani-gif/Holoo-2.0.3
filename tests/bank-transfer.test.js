const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('    function saveBankTransfer()');
const end = html.indexOf('    function renderTreasuryModule()', start);
assert.ok(start >= 0 && end > start, 'bank transfer save function must exist');

const state = {
  bankAccounts: [
    { id: 'BANK-A', type: 'bank', name: 'بانک الف' },
    { id: 'BANK-B', type: 'bank', name: 'بانک ب' }
  ],
  treasuryTxs: [],
  vouchers: [],
  auditLogs: []
};
const values = {
  'bank-transfer-source': 'BANK-A',
  'bank-transfer-destination': 'BANK-B',
  'bank-transfer-amount': '1000',
  'bank-transfer-fee': '10',
  'bank-transfer-date': '1405/09/02',
  'bank-transfer-desc': 'انتقال آزمایشی'
};
const posted = [];
const audit = [];
const messages = [];
const sandbox = {
  state,
  document: { getElementById: id => ({ value: values[id] || '' }) },
  bankTxDateKey: value => /^1405\/\d{2}\/\d{2}$/.test(String(value || '')) ? value : null,
  createStableId: () => 'TRANSFER-1',
  postVoucher: (...args) => {
    posted.push(args);
    const lines = args[1];
    const debit = lines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
    const credit = lines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
    assert.equal(debit, credit, 'inter-bank transfer journal must balance');
    return 77;
  },
  addAudit: (...args) => audit.push(args),
  saveState: () => true,
  closeModal: () => {},
  renderAll: () => {},
  showToast: (...args) => messages.push(args)
};
vm.createContext(sandbox);
vm.runInContext(html.slice(start, end) + '; this.saveBankTransfer = saveBankTransfer;', sandbox);

sandbox.saveBankTransfer();
assert.equal(posted.length, 1);
assert.equal(posted[0][0], 'انتقال بین بانکی بانک الف به بانک ب');
assert.deepEqual(Array.from(posted[0][1], line => [line.code, line.bankAccountId || '', line.debit, line.credit]), [
  ['1102', 'BANK-B', 1000, 0],
  ['6101', '', 10, 0],
  ['1102', 'BANK-A', 0, 1010]
]);
assert.equal(posted[0][2], '1405/09/02');
assert.equal(posted[0][3].type, 'bank_transfer');
assert.equal(state.treasuryTxs.length, 2);
assert.deepEqual(state.treasuryTxs.map(tx => [tx.dir, tx.bankAccountId, tx.amount]), [
  ['pay', 'BANK-A', 1010],
  ['receive', 'BANK-B', 1000]
]);
assert.equal(audit.length, 1);
console.log('PASS: inter-bank transfer posts a balanced two-bank journal and separate bank-fee expense');
console.log('PASS: source and destination bank statements receive separate reconciliation records');

values['bank-transfer-destination'] = 'BANK-A';
sandbox.saveBankTransfer();
assert.equal(posted.length, 1);
assert.equal(state.treasuryTxs.length, 2);
console.log('PASS: same-account transfers are rejected without side effects');
