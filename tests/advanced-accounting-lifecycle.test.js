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
  const helperStart = html.indexOf('function getReturnCostOfGoods(');
  const helperEnd = html.indexOf('function submitPartialReturn()', helperStart);
  const helperSource = helperStart >= 0 && helperEnd > helperStart ? html.slice(helperStart, helperEnd) : '';
  const sandbox = {
    restoreFifoAllocations(product, allocations, quantityToRestore, fallbackCost, sourceRef, alreadyRestored = []) {
      product.batches = product.batches || [];
      const restored = [];
      if (Array.isArray(allocations) && allocations.length) {
        let remaining = Number(quantityToRestore || 0);
        for (const allocation of allocations) {
          if (remaining <= 0.000001) break;
          const prior = alreadyRestored.filter(item => item.batchId === allocation.batchId).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
          const take = Math.min(remaining, Math.max(0, Number(allocation.quantity || 0) - prior));
          if (take <= 0) continue;
          const batch = product.batches.find(item => item.id === allocation.batchId);
          if (batch) batch.remainingQty = Number(batch.remainingQty || 0) + take;
          else product.batches.push({ id: allocation.batchId, remainingQty: take, quantity: take, unitCost: allocation.unitCost || fallbackCost || 0 });
          restored.push({ batchId: allocation.batchId, quantity: take });
          remaining -= take;
        }
        if (remaining > 0.000001) throw new Error('return exceeds allocated test batches');
        return restored;
      }
      const id = 'TEST-RETURN-' + sourceRef;
      product.batches.push({ id, remainingQty: quantityToRestore, quantity: quantityToRestore, unitCost: fallbackCost || 0 });
      return [{ batchId: id, quantity: quantityToRestore }];
    },
    consumeFifoStock(product, quantity) {
      product.batches = product.batches || [];
      if (!product.batches.length) product.batches.push({ id: 'TEST-OPENING-' + product.id, remainingQty: Number(product.stock || 0), quantity: Number(product.stock || 0), unitCost: Number(product.buyPrice || 0) });
      let remaining = Number(quantity || 0);
      const allocations = [];
      for (const batch of product.batches) {
        const take = Math.min(remaining, Number(batch.remainingQty || 0));
        if (take > 0) {
          batch.remainingQty -= take;
          allocations.push({ batchId: batch.id, lot: batch.lot || '', quantity: take, unitCost: Number(batch.unitCost || 0) });
          remaining -= take;
        }
        if (remaining <= 0.000001) break;
      }
      if (remaining > 0.000001) throw new Error('insufficient test batch stock');
      return { totalCost: Math.round(allocations.reduce((sum, item) => sum + item.quantity * item.unitCost, 0)), allocations };
    },
    ...context
  };
  vm.createContext(sandbox);
  if (helperSource) vm.runInContext(helperSource, sandbox);
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
    getInvoiceOutstanding(inv) { return Math.max(0, Number(inv.grandTotal || 0) - (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0) - Number(inv.paidAmount || 0)); },
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
    state, postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, renderAll(){}, showToast(){}, faNum:String
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
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'2003','pret-qty-0':'3'}),
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
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
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'2004','pret-qty-0':'2'}),
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  assert.equal(state.invoices[0].items[0].returnedKg,4);
  assert.equal(state.products[0].stock,1);
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});

// Sales returns must reverse the original cost, not the sales price.
test('partial FIFO sales return reverses exact allocated COGS and restores inventory value', () => {
  const item = {
    productId:'X1', kg:10, returnedKg:2, price:30, costingMethod:'FIFO', costOfGoodsSold:1500,
    fifoAllocations:[
      {batchId:'B1',quantity:5,unitCost:100},
      {batchId:'B2',quantity:5,unitCost:200}
    ],
    fifoReturnedAllocations:[{batchId:'B1',quantity:2}]
  };
  const state = {
    fiscalYear:'1405', costingMethod:'FIFO',
    invoices:[{id:2050,type:'sale',partyId:'P1',items:[item]}],
    products:[{id:'X1',stock:8,buyPrice:150,batches:[
      {id:'B1',remainingQty:0,quantity:5,unitCost:100},
      {id:'B2',remainingQty:0,quantity:5,unitCost:200}
    ],kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'2050','pret-qty-0':'4'}),
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  const lines=posted[0][1];
  assert.equal(lines.find(line=>line.code==='1105')?.debit,500);
  assert.equal(lines.find(line=>line.code==='5101')?.credit,500);
  assert.equal(lines.reduce((sum,line)=>sum+line.debit,0),lines.reduce((sum,line)=>sum+line.credit,0));
  assert.equal(state.invoices[0].returnRefs[0].costOfGoodsSold,500);
  assert.equal(state.products[0].stock,12);
  assert.equal(saves,1);
});

test('sales invoice cancellation reverses only the unreturned FIFO COGS', () => {
  const item = {
    productId:'X2', kg:10, returnedKg:4, price:100, costingMethod:'FIFO', costOfGoodsSold:1500,
    fifoAllocations:[
      {batchId:'C1',quantity:5,unitCost:100},
      {batchId:'C2',quantity:5,unitCost:200}
    ],
    fifoReturnedAllocations:[{batchId:'C1',quantity:4}]
  };
  const state = {
    fiscalYear:'1405',
    invoices:[{id:2051,type:'sale',status:'active',partyId:'P1',grandTotal:1000,paidAmount:0,returnRefs:[{amount:400}],items:[item]}],
    products:[{id:'X2',stock:4,buyPrice:150,batches:[
      {id:'C1',remainingQty:0,quantity:5,unitCost:100},
      {id:'C2',remainingQty:0,quantity:5,unitCost:200}
    ],kardex:[]}]
  };
  const posted=[]; let saves=0;
  const cancel=load(section('function cancelInvoice(invId)', 'function printOfficialInvoice('), 'cancelInvoice', {
    state, getInvoiceReturnedAmount(inv){return (inv.returnRefs||[]).reduce((sum,ref)=>sum+Number(ref.amount||0),0);},
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, renderAll(){}, showToast(){}, faNum:String
  });
  cancel(2051);
  const lines=posted[0][1];
  assert.equal(lines.find(line=>line.code==='1105')?.debit,1100);
  assert.equal(lines.find(line=>line.code==='5101')?.credit,1100);
  assert.equal(lines.find(line=>line.code==='4103')?.debit,600);
  assert.equal(lines.find(line=>line.code==='1103')?.credit,600);
  assert.equal(lines.reduce((sum,line)=>sum+line.debit,0),lines.reduce((sum,line)=>sum+line.credit,0));
  assert.equal(state.invoices[0].cancelledCostOfGoodsSold,1100);
  assert.equal(state.products[0].stock,10);
  assert.equal(saves,1);
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
    state, document:doc(values), getInvoiceOutstanding(inv) { return Math.max(0, Number(inv.grandTotal || 0) - (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0) - Number(inv.paidAmount || 0)); }, postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}, faNum:String
  });
  save();
  assert.equal(state.checks.length,1);
  assert.equal(state.treasuryTxs.length,0);
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});

test('failed cheque issue journal does not leave a check or treasury transaction behind', () => {
  const state={fiscalYear:'1405',parties:[{id:'P1'}],invoices:[],checks:[],bankAccounts:[{id:'B1',type:'cash',name:'صندوق',balance:1000}],treasuryTxs:[]};
  const values={'tr-dir':'receive','tr-party':'P1','tr-method':'check','tr-amount':'500','tr-alloc-inv':'0','tr-desc':'failed check','tr-sayad':'123456789012345678901234','tr-chk-due':'1405/09/01','tr-chk-bank':'بانک تست','tr-bank-acc':'B1'};
  let saves=0; const messages=[];
  const save=load(section('function saveTreasuryEntry()', 'function renderTreasuryModule()'), 'saveTreasuryEntry', {
    state, document:doc(values), getTodayJalaliDate(){return '1405/09/02';},
    getInvoiceOutstanding(){return 0;}, postVoucher(...args){assert.equal(args[3].deferSave,true);throw new Error('simulated journal failure');},
    saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(msg,type){messages.push({msg,type});}, faNum:String
  });
  save();
  assert.equal(state.checks.length,0);
  assert.equal(state.treasuryTxs.length,0);
  assert.equal(state.bankAccounts[0].balance,1000);
  assert.equal(saves,0);
  assert.equal(messages[0].type,'error');
});

test('failed bounced-check journal leaves check status and invoice allocation unchanged', () => {
  const state={
    invoices:[{id:3010,type:'sale',partyId:'P1',grandTotal:1000,paidAmount:400}],
    checks:[{id:'CHK-FAIL',sayad:'777788889999000011112222',status:'in_progress',dir:'receive',amount:400,partyId:'P1',allocations:[{invoiceId:3010,amount:400}]}],
    bankAccounts:[{id:'B1',type:'bank',balance:900}]
  };
  let saves=0; const messages=[];
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...args){assert.equal(args[3].deferSave,true);throw new Error('simulated journal failure');},
    showToast(msg,type){messages.push({msg,type});}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-FAIL','bounced');
  assert.equal(state.checks[0].status,'in_progress');
  assert.equal(state.invoices[0].paidAmount,400);
  assert.equal(state.checks[0].allocationsReleasedAt,undefined);
  assert.equal(saves,0);
  assert.equal(messages[0].type,'error');
});

// A bounced received check restores the customer's receivable once; duplicate transition is rejected.
test('bounced received check posts once and repeated status change has no side effects', () => {
  const state={
    checks:[{id:'CHK-1',sayad:'999988887777666655554444',status:'in_progress',dir:'receive',amount:700,partyId:'P1'}],
    bankAccounts:[{id:'B1',type:'bank',balance:1000}]
  };
  const posted=[]; let saves=0;
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...a){posted.push(a);return 1;}, showToast(){}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-1','bounced');
  update('CHK-1','bounced');
  assert.equal(state.checks[0].status,'bounced');
  assert.equal(posted.length,1);
  assert.equal(posted[0][3].event,'bounced');
  assert.equal(posted[0][3].deferSave,true);
  assert.equal(saves,1);
});


test('bounced cheque releases its original invoice allocations exactly once', () => {
  const state = {
    invoices: [{ id: 3001, type:'sale', partyId:'P1', grandTotal:1000, paidAmount:600 }],
    checks: [{ id:'CHK-ALLOC', sayad:'123456789012345678901234', status:'in_progress', dir:'receive', amount:400, partyId:'P1', allocations:[{invoiceId:3001,amount:400}] }],
    bankAccounts:[]
  };
  const posted=[]; let saves=0;
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...a){posted.push(a);return 1;}, showToast(){}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-ALLOC','bounced');
  update('CHK-ALLOC','bounced');
  assert.equal(state.invoices[0].paidAmount,200);
  assert.equal(state.checks[0].status,'bounced');
  assert.equal(state.checks[0].allocationsReleasedAt !== undefined,true);
  assert.equal(posted.length,1);
  assert.equal(posted[0][3].event,'bounced');
  assert.equal(saves,1);
});

test('voided supplier cheque releases purchase invoice allocation', () => {
  const state = {
    invoices: [{ id: 3002, type:'purchase', partyId:'P1', grandTotal:900, paidAmount:350 }],
    checks: [{ id:'CHK-VOID', sayad:'223456789012345678901234', status:'in_progress', dir:'pay', amount:350, partyId:'P1', allocations:[{invoiceId:3002,amount:350}] }],
    bankAccounts:[]
  };
  const posted=[]; let saves=0;
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...a){posted.push(a);return 1;}, showToast(){}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-VOID','voided');
  assert.equal(state.invoices[0].paidAmount,0);
  assert.equal(state.checks[0].status,'voided');
  assert.equal(posted.length,1);
  assert.equal(posted[0][3].event,'voided');
  assert.equal(saves,1);
});

test('cheque allocation reversal is rejected if invoice balance no longer contains the allocation', () => {
  const state = {
    invoices: [{ id: 3003, type:'sale', partyId:'P1', grandTotal:1000, paidAmount:100 }],
    checks: [{ id:'CHK-STALE', sayad:'323456789012345678901234', status:'in_progress', dir:'receive', amount:400, partyId:'P1', allocations:[{invoiceId:3003,amount:400}] }],
    bankAccounts:[]
  };
  const posted=[]; let saves=0;
  const update=load(section('function updateCheckStatus(id, st)', 'function computeCheckRas()'), 'updateCheckStatus', {
    state, postVoucher(...a){posted.push(a);return 1;}, showToast(){}, addAudit(){}, saveState(){saves++;}, renderAll(){}
  });
  update('CHK-STALE','bounced');
  assert.equal(state.invoices[0].paidAmount,100);
  assert.equal(state.checks[0].status,'in_progress');
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});


test('invoice return amount reduces the open balance used by aging and treasury', () => {
  const outstanding = load(section('function getInvoiceReturnedAmount(inv)', 'function agingBucket(daysPastDue)'), 'getInvoiceOutstanding', {});
  assert.equal(outstanding({ grandTotal:1000, paidAmount:300, returnRefs:[{amount:200},{amount:50}] }),450);
  assert.equal(outstanding({ grandTotal:1000, paidAmount:1000, returnRefs:[{amount:200}] }),0);
});

test('partial return validates every row before changing any stock or invoice quantity', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG',
    invoices:[{id:3101,type:'sale',partyId:'P1',items:[
      {productId:'X1',kg:5,returnedKg:0,price:10},
      {productId:'X2',kg:2,returnedKg:0,price:20}
    ]}],
    products:[{id:'X1',stock:5,kardex:[]},{id:'X2',stock:2,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'3101','pret-qty-0':'2','pret-qty-1':'3'}),
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  assert.equal(state.invoices[0].items[0].returnedKg,0);
  assert.equal(state.products[0].stock,5);
  assert.equal(state.products[1].stock,2);
  assert.equal(posted.length,0);
  assert.equal(saves,0);
});

test('partial return stores return value so the invoice outstanding is reduced', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG',
    invoices:[{id:3102,type:'sale',partyId:'P1',grandTotal:100,paidAmount:0,items:[{productId:'X1',kg:10,returnedKg:0,price:10}]}],
    products:[{id:'X1',stock:4,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'3102','pret-qty-0':'2'}),
    getInvoiceOutstanding(inv){return Math.max(0,Number(inv.grandTotal||0)-(inv.returnRefs||[]).reduce((n,r)=>n+Number(r.amount||0),0)-Number(inv.paidAmount||0));},
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  submit();
  const outstanding=load(section('function getInvoiceReturnedAmount(inv)', 'function agingBucket(daysPastDue)'), 'getInvoiceOutstanding', {});
  assert.equal(state.invoices[0].returnRefs[0].amount,20);
  assert.equal(outstanding(state.invoices[0]),80);
  assert.equal(state.products[0].stock,6);
  assert.equal(posted.length,1);
  assert.equal(saves,1);
});

test('cancelling an invoice after partial returns reverses only its remaining value', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG',
    invoices:[{id:3103,type:'sale',partyId:'P1',grandTotal:1000,paidAmount:0,status:'active',returnRefs:[{id:'RET-OLD',amount:250}],items:[{productId:'X1',kg:10,returnedKg:2,price:100}]}],
    products:[{id:'X1',stock:2,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const cancel=load(section('function cancelInvoice(invId)', 'function printOfficialInvoice('), 'cancelInvoice', {
    state, getInvoiceReturnedAmount(inv) { return (inv.returnRefs || []).reduce((sum, ref) => sum + Number(ref.amount || 0), 0); }, postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, renderAll(){}, showToast(){}, faNum:String
  });
  cancel(3103);
  assert.equal(state.invoices[0].status,'cancelled');
  assert.equal(state.products[0].stock,10);
  assert.equal(posted.length,1);
  assert.equal(posted[0][1][0].debit,750);
  assert.equal(posted[0][1][1].credit,750);
  assert.equal(saves,1);
});


test('return on a fully settled sales invoice creates customer credit instead of negative receivable', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG', treasuryTxs:[],
    invoices:[{id:3201,type:'sale',partyId:'P1',grandTotal:100,paidAmount:100,items:[{productId:'X1',kg:10,returnedKg:0,price:10}]}],
    products:[{id:'X1',stock:0,kardex:[]}]
  };
  const posted=[]; let saves=0;
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'3201','pret-qty-0':'2'}),
    getInvoiceOutstanding(inv){return Math.max(0,Number(inv.grandTotal||0)-(inv.returnRefs||[]).reduce((n,r)=>n+Number(r.amount||0),0)-Number(inv.paidAmount||0));},
    postVoucher(...a){posted.push(a);return 1;}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}, getTodayJalaliDate(){return '1405/08/27';}
  });
  submit();
  assert.equal(state.treasuryTxs.length,1);
  assert.equal(state.treasuryTxs[0].kind,'party_credit');
  assert.equal(state.treasuryTxs[0].creditDirection,'sale');
  assert.equal(state.treasuryTxs[0].remainingAmount,20);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.debit,0),20);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.credit,0),20);
  assert.equal(posted[0][1].find(line=>line.code==='1103').credit,0);
  assert.equal(posted[0][1].find(line=>line.code==='2101').credit,20);
  assert.equal(saves,1);
});

test('return below the unpaid invoice balance does not create excess party credit', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG', treasuryTxs:[],
    invoices:[{id:3202,type:'purchase',partyId:'P2',grandTotal:100,paidAmount:20,items:[{productId:'X2',kg:10,returnedKg:0,price:10}]}],
    products:[{id:'X2',stock:10,kardex:[]}]
  };
  const posted=[];
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'3202','pret-qty-0':'2'}),
    getInvoiceOutstanding(inv){return Math.max(0,Number(inv.grandTotal||0)-(inv.returnRefs||[]).reduce((n,r)=>n+Number(r.amount||0),0)-Number(inv.paidAmount||0));},
    postVoucher(...a){posted.push(a);return 1;}, saveState(){}, closeModal(){}, renderAll(){}, showToast(){}, getTodayJalaliDate(){return '1405/08/27';}
  });
  submit();
  assert.equal(state.treasuryTxs.length,0);
  assert.equal(posted[0][1].find(line=>line.code==='2101').debit,20);
  assert.equal(posted[0][1].some(line=>line.code==='1107' && line.debit>0),false);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.debit,0),20);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.credit,0),20);
});

test('party credit balances are separated by party and customer/supplier direction', () => {
  const state={treasuryTxs:[
    {kind:'party_credit',partyId:'P1',creditDirection:'sale',amount:100,remainingAmount:70},
    {kind:'party_credit',partyId:'P1',creditDirection:'purchase',amount:50,remainingAmount:50},
    {kind:'party_credit',partyId:'P2',creditDirection:'sale',amount:30,remainingAmount:30}
  ]};
  const balance=load(section('function getPartyCreditBalance(partyId, direction)', 'function agingBucket(daysPastDue)'), 'getPartyCreditBalance', {state});
  assert.equal(balance('P1','sale'),70);
  assert.equal(balance('P1','purchase'),50);
  assert.equal(balance('P1'),120);
  assert.equal(balance('P2','sale'),30);
});


test('customer credit applies to the same party sales invoice and reduces both balances', () => {
  const state={
    treasuryTxs:[{id:'CREDIT-1',kind:'party_credit',creditDirection:'sale',partyId:'P1',amount:120,remainingAmount:120}],
    invoices:[{id:3301,type:'sale',status:'active',partyId:'P1',grandTotal:500,paidAmount:100}],
    vouchers:[]
  };
  const posted=[]; let saves=0;
  const apply=load(section('function applyPartyCredit(creditId)', 'function renderTreasuryModule()'), 'applyPartyCredit', {
    state, document:doc({'credit-invoice-CREDIT-1':'3301','credit-amount-CREDIT-1':'80'}),
    getInvoiceOutstanding(inv){return Math.max(0,Number(inv.grandTotal||0)-Number(inv.paidAmount||0)-(inv.returnRefs||[]).reduce((n,r)=>n+Number(r.amount||0),0));},
    createStableId(){return 'APPLY-1';}, postVoucher(...a){posted.push(a);return 44;}, addAudit(){}, saveState(){saves++;}, renderAll(){}, showToast(){}
  });
  apply('CREDIT-1');
  assert.equal(state.invoices[0].paidAmount,180);
  assert.equal(state.treasuryTxs[0].remainingAmount,40);
  assert.equal(state.treasuryTxs[0].applications[0].amount,80);
  assert.equal(posted.length,1);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.debit,0),80);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.credit,0),80);
  assert.equal(saves,1);
});

test('supplier credit cannot be applied to another party or to a sales invoice', () => {
  for (const invoice of [
    {id:3302,type:'purchase',status:'active',partyId:'P2',grandTotal:500,paidAmount:0},
    {id:3303,type:'sale',status:'active',partyId:'P1',grandTotal:500,paidAmount:0}
  ]) {
    const state={treasuryTxs:[{id:'CREDIT-2',kind:'party_credit',creditDirection:'purchase',partyId:'P1',amount:100,remainingAmount:100}],invoices:[invoice]};
    const posted=[]; let saves=0;
    const apply=load(section('function applyPartyCredit(creditId)', 'function renderTreasuryModule()'), 'applyPartyCredit', {
      state, document:doc({'credit-invoice-CREDIT-2':String(invoice.id),'credit-amount-CREDIT-2':'50'}),
      getInvoiceOutstanding(inv){return Number(inv.grandTotal||0)-Number(inv.paidAmount||0);},
      createStableId(){return 'APPLY-2';}, postVoucher(...a){posted.push(a);return 1;}, addAudit(){}, saveState(){saves++;}, renderAll(){}, showToast(){}
    });
    apply('CREDIT-2');
    assert.equal(posted.length,0);
    assert.equal(state.treasuryTxs[0].remainingAmount,100);
    assert.equal(invoice.paidAmount,0);
    assert.equal(saves,0);
  }
});

test('credit application rejects an amount above either the credit or invoice balance', () => {
  const state={treasuryTxs:[{id:'CREDIT-3',kind:'party_credit',creditDirection:'sale',partyId:'P1',amount:100,remainingAmount:40}],invoices:[{id:3304,type:'sale',status:'active',partyId:'P1',grandTotal:30,paidAmount:0}]};
  const posted=[]; let saves=0;
  const apply=load(section('function applyPartyCredit(creditId)', 'function renderTreasuryModule()'), 'applyPartyCredit', {
    state, document:doc({'credit-invoice-CREDIT-3':'3304','credit-amount-CREDIT-3':'50'}),
    getInvoiceOutstanding(inv){return Number(inv.grandTotal||0)-Number(inv.paidAmount||0);},
    createStableId(){return 'APPLY-3';}, postVoucher(...a){posted.push(a);return 1;}, addAudit(){}, saveState(){saves++;}, renderAll(){}, showToast(){}
  });
  apply('CREDIT-3');
  assert.equal(posted.length,0);
  assert.equal(state.treasuryTxs[0].remainingAmount,40);
  assert.equal(state.invoices[0].paidAmount,0);
  assert.equal(saves,0);
});


test('customer credit refund decreases the selected bank balance and customer credit', () => {
  const state={
    treasuryTxs:[{id:'CREDIT-R1',kind:'party_credit',creditDirection:'sale',partyId:'P1',amount:100,remainingAmount:100}],
    bankAccounts:[{id:'B1',type:'bank',balance:500}]
  };
  const posted=[]; let saves=0;
  const refund=load(section('function openPartyCreditRefund(creditId)', 'function renderTreasuryModule()'), 'submitPartyCreditRefund', {
    state, document:doc({'credit-refund-id':'CREDIT-R1','credit-refund-amount':'40','credit-refund-bank':'B1'}),
    createStableId(){return 'REFUND-1';}, postVoucher(...a){posted.push(a);return 77;}, addAudit(){}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  refund();
  assert.equal(state.bankAccounts[0].balance,460);
  assert.equal(state.treasuryTxs[1].remainingAmount,60);
  assert.equal(state.treasuryTxs[0].kind,'party_credit_refund');
  assert.equal(state.treasuryTxs[0].dir,'pay');
  assert.equal(posted[0][1].reduce((n,line)=>n+line.debit,0),40);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.credit,0),40);
  assert.equal(saves,1);
});

test('supplier credit refund records an incoming bank receipt and increases bank balance', () => {
  const state={
    treasuryTxs:[{id:'CREDIT-R2',kind:'party_credit',creditDirection:'purchase',partyId:'P2',amount:80,remainingAmount:80}],
    bankAccounts:[{id:'B2',type:'cash',balance:100}]
  };
  const posted=[];
  const refund=load(section('function openPartyCreditRefund(creditId)', 'function renderTreasuryModule()'), 'submitPartyCreditRefund', {
    state, document:doc({'credit-refund-id':'CREDIT-R2','credit-refund-amount':'30','credit-refund-bank':'B2'}),
    createStableId(){return 'REFUND-2';}, postVoucher(...a){posted.push(a);return 78;}, addAudit(){}, saveState(){}, closeModal(){}, renderAll(){}, showToast(){}
  });
  refund();
  assert.equal(state.bankAccounts[0].balance,130);
  assert.equal(state.treasuryTxs[1].remainingAmount,50);
  assert.equal(state.treasuryTxs[0].dir,'receive');
  assert.equal(posted[0][1].reduce((n,line)=>n+line.debit,0),30);
  assert.equal(posted[0][1].reduce((n,line)=>n+line.credit,0),30);
});

test('party credit refund rejects an amount above the remaining credit', () => {
  const state={treasuryTxs:[{id:'CREDIT-R3',kind:'party_credit',creditDirection:'sale',partyId:'P1',amount:100,remainingAmount:20}],bankAccounts:[{id:'B1',type:'bank',balance:500}]};
  const posted=[]; let saves=0;
  const refund=load(section('function openPartyCreditRefund(creditId)', 'function renderTreasuryModule()'), 'submitPartyCreditRefund', {
    state, document:doc({'credit-refund-id':'CREDIT-R3','credit-refund-amount':'30','credit-refund-bank':'B1'}),
    createStableId(){return 'REFUND-3';}, postVoucher(...a){posted.push(a);return 79;}, addAudit(){}, saveState(){saves++;}, closeModal(){}, renderAll(){}, showToast(){}
  });
  refund();
  assert.equal(posted.length,0);
  assert.equal(state.bankAccounts[0].balance,500);
  assert.equal(state.treasuryTxs[0].remainingAmount,20);
  assert.equal(saves,0);
});



test('fully paid supplier purchase return books excess as supplier prepayment in 1107', () => {
  const state = {
    fiscalYear:'1405', costingMethod:'AVG', treasuryTxs:[],
    invoices:[{id:3401,type:'purchase',partyId:'SUP-1',grandTotal:100,paidAmount:100,items:[{productId:'Y1',kg:10,returnedKg:0,price:10}]}],
    products:[{id:'Y1',stock:10,kardex:[]}]
  };
  const posted=[];
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state, getTodayJalaliDate(){return '1405/09/02';}, document:doc({'partial-ret-inv-id':'3401','pret-qty-0':'2'}),
    getInvoiceOutstanding(inv){return Math.max(0,Number(inv.grandTotal||0)-(inv.returnRefs||[]).reduce((n,r)=>n+Number(r.amount||0),0)-Number(inv.paidAmount||0));},
    postVoucher(...a){posted.push(a);return 1;}, saveState(){}, closeModal(){}, renderAll(){}, showToast(){}, getTodayJalaliDate(){return '1405/08/27';}
  });
  submit();
  const lines=posted[0][1];
  assert.equal(lines.find(line=>line.code==='1107')?.debit,20);
  assert.equal(lines.some(line=>line.code==='1103'),false);
  assert.equal(lines.reduce((n,line)=>n+line.debit,0),20);
  assert.equal(lines.reduce((n,line)=>n+line.credit,0),20);
  assert.equal(state.treasuryTxs[0].creditDirection,'purchase');
});

test('supplier credit application clears supplier payable against prepayment account 1107', () => {
  const state={
    treasuryTxs:[{id:'SUP-CREDIT',kind:'party_credit',creditDirection:'purchase',partyId:'SUP-1',amount:100,remainingAmount:100}],
    invoices:[{id:3402,type:'purchase',status:'active',partyId:'SUP-1',grandTotal:500,paidAmount:0}]
  };
  const posted=[];
  const apply=load(section('function applyPartyCredit(creditId)', 'function renderTreasuryModule()'), 'applyPartyCredit', {
    state, document:doc({'credit-invoice-SUP-CREDIT':'3402','credit-amount-SUP-CREDIT':'60'}),
    getInvoiceOutstanding(inv){return Number(inv.grandTotal||0)-Number(inv.paidAmount||0);},
    createStableId(){return 'SUP-APPLY';}, postVoucher(...a){posted.push(a);return 45;}, addAudit(){}, saveState(){}, renderAll(){}, showToast(){}
  });
  apply('SUP-CREDIT');
  assert.equal(posted[0][1].find(line=>line.code==='2101')?.debit,60);
  assert.equal(posted[0][1].find(line=>line.code==='1107')?.credit,60);
  assert.equal(posted[0][1].some(line=>line.code==='1103'),false);
});

test('supplier credit cash refund clears prepayment account 1107, not receivables', () => {
  const state={
    treasuryTxs:[{id:'SUP-REFUND',kind:'party_credit',creditDirection:'purchase',partyId:'SUP-1',amount:80,remainingAmount:80}],
    bankAccounts:[{id:'BANK-SUP',type:'bank',balance:100}]
  };
  const posted=[];
  const refund=load(section('function openPartyCreditRefund(creditId)', 'function renderTreasuryModule()'), 'submitPartyCreditRefund', {
    state, document:doc({'credit-refund-id':'SUP-REFUND','credit-refund-amount':'30','credit-refund-bank':'BANK-SUP'}),
    createStableId(){return 'SUP-REFUND-1';}, postVoucher(...a){posted.push(a);return 46;}, addAudit(){}, saveState(){}, closeModal(){}, renderAll(){}, showToast(){}
  });
  refund();
  assert.equal(posted[0][1].find(line=>line.code==='1107')?.credit,30);
  assert.equal(posted[0][1].some(line=>line.code==='1103'),false);
});

test('failed return journal leaves stock, invoice quantities and return history untouched', () => {
  const state={
    fiscalYear:'1405',costingMethod:'AVG',treasuryTxs:[],
    invoices:[{id:3403,type:'sale',partyId:'C-1',grandTotal:100,paidAmount:0,items:[{productId:'Y2',kg:10,returnedKg:0,price:10}]}],
    products:[{id:'Y2',stock:0,kardex:[]}]
  };
  let saves=0; const messages=[];
  const submit=load(section('function submitPartialReturn()', 'function cancelInvoice('), 'submitPartialReturn', {
    state,document:doc({'partial-ret-inv-id':'3403','pret-qty-0':'2'}),
    getInvoiceOutstanding(inv){return Number(inv.grandTotal||0)-Number(inv.paidAmount||0);},
    postVoucher(){throw new Error('simulated journal failure');},saveState(){saves++;},closeModal(){},renderAll(){},showToast(msg,type){messages.push({msg,type});}
  });
  submit();
  assert.equal(state.invoices[0].items[0].returnedKg,0);
  assert.equal(state.invoices[0].returnRefs,undefined);
  assert.equal(state.products[0].stock,0);
  assert.equal(state.products[0].kardex.length,0);
  assert.equal(saves,0);
  assert.equal(messages[0].type,'error');
});

console.log(`PASS: ${passed.length} advanced accounting lifecycle tests`);
for (const name of passed) console.log(`- ${name}`);
