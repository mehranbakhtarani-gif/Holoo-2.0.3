const assert=require('node:assert/strict');const audit=require('../inventory-cost-audit-domain.js').buildInventoryCostAudit;
const voucher=(id,sourceId,lines)=>({id,sourceType:'invoice',sourceId,lines});
const inv=(id,items,extra={})=>({id,type:'sale',items,...extra});
function test(name,fn){fn();console.log('PASS '+name);}
test('matches invoice COGS to 5101 debit and 1105 credit',()=>{const r=audit({invoices:[inv('S1',[{costOfGoodsSold:300}])],vouchers:[voucher('V1','S1',[{code:'5101',debit:300,credit:0},{code:'1105',debit:0,credit:300}])]});assert.equal(r.issueCount,0);assert.equal(r.details[0].status,'matched');});
test('flags missing sale voucher',()=>{assert.equal(audit({invoices:[inv('S2',[{costOfGoodsSold:10}])]}).missingSaleVouchers,1);});
test('flags duplicate vouchers instead of selecting one',()=>{const v=[voucher('V1','S3',[]),voucher('V2','S3',[])];assert.equal(audit({invoices:[inv('S3',[{costOfGoodsSold:10}])],vouchers:v}).duplicateSaleVouchers,1);});
test('flags missing and invalid COGS values',()=>{assert.equal(audit({invoices:[inv('S4',[{costOfGoodsSold:''}])],vouchers:[voucher('V4','S4',[])]}).invalidCogsLines,1);});
test('detects 5101 mismatch',()=>{const r=audit({invoices:[inv('S5',[{costOfGoodsSold:100}])],vouchers:[voucher('V5','S5',[{code:'5101',debit:90,credit:0},{code:'1105',debit:0,credit:100}])]});assert.equal(r.cogsAmountMismatches,1);});
test('detects missing 1105 counterpart',()=>{const r=audit({invoices:[inv('S6',[{costOfGoodsSold:100}])],vouchers:[voucher('V6','S6',[{code:'5101',debit:100,credit:0}])]});assert.equal(r.inventoryCounterpartMismatches,1);});
test('detects unbalanced voucher',()=>{const r=audit({invoices:[inv('S7',[{costOfGoodsSold:100}])],vouchers:[voucher('V7','S7',[{code:'5101',debit:100,credit:0},{code:'1105',debit:0,credit:90}])]});assert.equal(r.unbalancedVouchers,1);});
test('checks purchase batch quantities',()=>{const r=audit({invoices:[{id:'P1',type:'purchase',items:[{productId:'K1',kg:5}]}],products:[{id:'K1',batches:[{sourceType:'purchase',sourceRef:'P1',lot:'PUR-P1-K1',quantity:4}]}]});assert.equal(r.purchaseQuantityMismatches,1);});
test('does not mutate input data',()=>{const state={invoices:[inv('S8',[{costOfGoodsSold:10}])],vouchers:[voucher('V8','S8',[{code:'5101',debit:10,credit:0},{code:'1105',debit:0,credit:10}])]};const before=JSON.stringify(state);audit(state);assert.equal(JSON.stringify(state),before);});
test('flags return refs without unique return voucher',()=>{const r=audit({invoices:[inv('S9',[{costOfGoodsSold:10}],{returnRefs:[{id:'R9'}]})],vouchers:[voucher('V9','S9',[{code:'5101',debit:10,credit:0},{code:'1105',debit:0,credit:10}])]});assert.equal(r.returnLinksUnverified,1);});
console.log('PASS inventory cost audit suite');