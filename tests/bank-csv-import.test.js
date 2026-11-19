const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, tag] of html.split('<script').slice(1).entries()) {
  const openingEnd = tag.indexOf('>');
  const closingStart = tag.indexOf('</script>');
  const source = openingEnd >= 0 && closingStart > openingEnd ? tag.slice(openingEnd + 1, closingStart) : '';
  if (source.trim()) new vm.Script(source, { filename: 'index.html:inline-' + i });
}
function load(context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  const start = html.indexOf('    function parseBankCSVRecords(input)');
  const end = html.indexOf('    let cfChartInst', start);
  assert.ok(start >= 0 && end > start, 'bank CSV parser functions must exist');
  vm.runInContext(html.slice(start, end) + '; this.parseBankCSVRecords = parseBankCSVRecords; this.parseBankCSV = parseBankCSV;', sandbox);
  return sandbox;
}

const sandbox = load({});
const rows = sandbox.parseBankCSVRecords(
  '1405/09/02,"واریز, بابت فروش",1000,REF-1\r\n' +
  '1405/09/03,"شرح دارای ""نقل قول""",2\n' +
  '1405/09/04,"شرح چند\nخطی",3,REF-3'
);
assert.equal(rows.length, 3);
assert.deepEqual(Array.from(rows[0]), ['1405/09/02', 'واریز, بابت فروش', '1000', 'REF-1']);
assert.deepEqual(Array.from(rows[1]), ['1405/09/03', 'شرح دارای "نقل قول"', '2']);
assert.deepEqual(Array.from(rows[2]), ['1405/09/04', 'شرح چند\nخطی', '3', 'REF-3']);
assert.throws(() => sandbox.parseBankCSVRecords('1405/09/02,"نقل قول ناقص,100,REF'), /نقل‌قول/);

const state = { bankAccounts: [{ id:'BANK-A', type:'bank' }], bankReconcileItems: [{ id:'OLD', ref:'DUP-1', date:'1405/09/01', desc:'قبلی', amount:10, matched:false }] };
const values = { 'bank-csv-account': 'BANK-A', 'bank-csv-text':
  '\uFEFF1405/09/02,"واریز, بابت فروش",1000,REF-1\n' +
  '1405/09/03,"شرح ""ویژه""",200,DUP-1\n' +
  '1405/09/04,"شرح چند\nخطی",-300,REF-3\n' +
  'ردیف نامعتبر'
};
let saves=0, renders=0, closes=0, id=0;
const messages=[];
const integration = load({
  state,
  document:{getElementById(name){return {value:values[name] || ''};}},
  bankTxDateKey(value){return /^1405\/\d{2}\/\d{2}$/.test(value) ? value.replaceAll('/','') : null;},
  createStableId(){return String(++id);},
  saveState(){saves++;},closeModal(){closes++;},renderReconcileModule(){renders++;},
  showToast(message,type){messages.push({message,type});},faNum:String
});
integration.parseBankCSV();
assert.equal(state.bankReconcileItems.length, 3);
assert.equal(state.bankReconcileItems[0].ref,'REF-3');
assert.equal(state.bankReconcileItems[0].desc,'شرح چند\nخطی');
assert.equal(state.bankReconcileItems[1].desc,'واریز, بابت فروش');
assert.equal(state.bankReconcileItems[2].ref,'DUP-1');
assert.equal(saves,1);
assert.equal(renders,1);
assert.equal(closes,1);
assert.match(messages[0].message,/2 تراکنش وارد شد/);
assert.match(messages[0].message,/1 شماره پیگیری تکراری/);
assert.match(messages[0].message,/1 نامعتبر/);
console.log('PASS: bank statement CSV parser supports quoted commas, escaped quotes and multiline fields');
console.log('PASS: malformed quoted CSV is rejected before import');
console.log('PASS: bank CSV import handles UTF-8 BOM, duplicates and invalid rows without losing quoted descriptions');
