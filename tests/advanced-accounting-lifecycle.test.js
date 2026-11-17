const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
for (const [i, m] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].entries()) {
  if (m[1].trim()) new vm.Script(m[1], { filename: `index.html:inline-${i}` });
}
function section(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing: ${startMarker}`);
  assert.notEqual(end, -1, `missing end: ${endMarker}`);
  return html.slice(start, end).trim();
}
function load(source, name, context) {
  const sandbox = { ...context };
  vm.createContext(sandbox);
  vm.runInContext(source + `; this.__fn = ${name};`, sandbox);
  return sandbox.__fn;
}
function doc(values) {
  return { getElementById(id) { return { value: values[id] ?? '', classList: { add() {}, remove() {} }, textContent: '' }; } };
}
const passed = [];
function test(name, fn) { fn(); passed.push(name); }

// Reject allocating a payment to another party's invoice.
test('treasury rejects an invoice belonging to a different party without side effects', () => {
  const state = {
    fiscalYear: '1405', parties: [{ id: 'P1' }, { id: 'P2' }],
    invoices: [{ id: 2001, status: 'active', partyId: 'P2', grandTotal: 900, paidAmount: 0 }],
    checks: [], bankAccounts: [{ id: 'B1', type: 'cash', name: 'صندوق', balance: 100 }],
    treasuryTxs: []
  };
  const posted = []; let saves = 0;
  const save = load(section('function saveTreasuryEntry()', 'function renderTreasuryModule()'), 'saveTreasuryEntry', {
    state, document: doc({ 'tr-dir':'receive','tr-party':'P1','tr-method':'cash','tr-amount':'100','tr-alloc-inv':'2001','tr-bank-acc':'B1','tr-desc':'test' }),
    postVoucher(...a) { posted.push(a); }, saveState() { saves++; }, closeModal(){}, renderAll(){}, showToast(){}, faNum:String
  });
  save();
  assert.equal(posted.length, 0);
  assert.equal(state.treasuryTxs.length, 0);
  assert.equal(state.invoices[0].paidAmount, 0);
  assert.equal(saves, 0);
});

// A settled invoice cannot be cancelled before its treasury allocation is reversed.
test('settled invoice cancellation is blocked and leaves stock and journal unchanged', () => {
  const state = {
    invoices: [{ id: 2002, type:'sale', status:'active', paidAmount:250, partyId:'P1', grandTotal:250, items:[{productId:'X1',kg:5,returnedKg:0}] }],
    products: [{ id:'X1', stock:5 }]
  };
  const posted = []; let saves = 0;
  const cancel = load(section('function cancelInvoice(invId)', 'function printOfficialInvoice('), 'cancelInvoice', {
    state, postVoucher(...a){posted.push(a);}, saveState(){saves++;}, renderAll(){}, showToast(){}, faNum:String
  });
  cancel(2002);
  assert.equal(state.invoices[0].status, 'active');
  assert.equal(state.products[0].stock, 5);
  assert.equal(posted.length, 0);
  assert.equal(saves, 0);
});

// A partial return adjusts quantity, stock, and creates a source-linked return journal.
test('partial sales return restores only returned quantity and posts a linked journal', () => {
  const state = {
    fiscalYear:'1405',
    invoices:[{ id:2003, type:'sale', partyId:'P1', items:[{productId:'X1',kg:10,returnedKg:2,price:30}] }],
    products:[{id:'X1',stock:12,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, document:doc({'partial-ret-inv-id':'2003','pret-qty-0':'3'}),
    postVoucher(...a){posted.push(a);}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  assert.equal(state.invoices[0].items[0].returnedKg,5);
  assert.equal(state.products[0].stock,15);
  assert.equal(state.invoices[0].returnRefs.length,1);
  assert.equal(state.invoices[0].returnRefs[0].amount,90);
  assert.equal(posted.length,1);
  assert.equal(posted[0][3].type,'invoice_return');
  assert.equal(saves,1);
});

// Return quantities above the unreturned quantity must not mutate stock or invoice state.
test('partial return rejects quantity above remaining invoice quantity', () => {
  const state = {
    fiscalYear:'1405',
    invoices:[{id:2004,type:'sale',partyId:'P1',items:[{productId:'X1',kg:5,returnedKg:4,price:10}]}],
    products:[{id:'X1',stock:1,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, document:doc({'partial-ret-inv-id':'2004','pret-qty-0':'2'}),
    postVoucher(...a){posted.push(a);}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  assert.equal(state.invoices[0].items[0].returnedKg,4);
  assert.equal(state.products[0].stock,1);
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});

// Check issue rejects a repeated SAYAD identifier.
test('check issue rejects duplicate SAYAD and does not create a treasury transaction', () => {
  const state = {
    fiscalYear:'1405', parties:[{id:'P1'}], invoices:[],
    checks:[{id:'OLD',sayad:'111122223333444455556666'}],
    bankAccounts:[{id:'B1',type:'cash',name:'صندوق',balance:0}], treasuryTxs:[]
  };
  const posted=[]; let saves=0;
  const values={'tr-dir':'receive','tr-party':'P1','tr-method':'check','tr-amount':'500','tr-alloc-inv':'0','tr-desc':'duplicate','tr-sayad':'111122223333444455556666','tr-chk-due':'1405/09/01','tr-chk-bank':'بانک تست','tr-bank-acc':'B1'};
  const save=load(section('function saveTreasuryEntry()', 'function renderTreasuryModule()'), 'saveTreasuryEntry', {
    state, document:doc(values), postVoucher(...a){posted.push(a);}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}, faNum:String
  });
  save();
  assert.equal(state.checks.length,1);
  assert.equal(state.treasuryTxs.length,0);
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});

// A bounced received check restores the customer's receivable once; duplicate transition is rejected.
test('bounced received check posts once and repeated status change has no side effects', () => {
  const state={
    checks:[{id:'CHK-1',sayad:'999988887777666655554444',status:'in_progress',dir:'receive',amount:700,partyId:'P1'}],
    bankAccounts:[{id:'B1',type:'bank',balance:1000}]
  };
  const posted=[]; let saves=0;
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...a){posted.push(a);}, showToast(){}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-1','bounced');
  update('CHK-1','bounced');
  assert.equal(state.checks[0].status,'bounced');
  assert.equal(posted.length,1);
  assert.equal(posted[0][3].event,'bounced');
  assert.equal(saves,1);
});

console.log(`PASS: ${passed.length} advanced accounting lifecycle tests`);
for (const name of passed) console.log(`- ${name}`);
