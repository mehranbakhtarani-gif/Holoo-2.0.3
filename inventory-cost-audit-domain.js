;(function(root){'use strict';
const TOLERANCE=1;
function amount(v){return v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;}
function linesFor(v,code){return (Array.isArray(v&&v.lines)?v.lines:[]).filter(x=>String(x&&x.code||'').trim()===code);}
function sum(lines,field){let n=0;for(const line of lines){const v=amount(line&&line[field]);if(v===null)return null;n+=v;}return n;}
function buildInventoryCostAudit(state){
 const s=state&&typeof state==='object'?state:{},invoices=Array.isArray(s.invoices)?s.invoices:[],vouchers=Array.isArray(s.vouchers)?s.vouchers:[],products=Array.isArray(s.products)?s.products:[];
 const issues=[],details=[];let salesChecked=0,purchasesChecked=0,missingInvoiceVouchers=0,duplicateInvoiceVouchers=0,invalidCogsLines=0,cogsAmountMismatches=0,inventoryCounterpartMismatches=0,unbalancedVouchers=0,purchaseQuantityMismatches=0,missingPurchaseProducts=0,returnLinksUnverified=0,returnAmountMismatches=0,orphanReturnVouchers=0;
 const add=(type,invoiceId,message,detail)=>issues.push({type,invoiceId:String(invoiceId??''),message,detail:String(detail??'')});
 const active=invoices.filter(x=>x&&x.status!=='cancelled'&&['sale','purchase'].includes(String(x.type||'')));
 const findInvoiceVouchers=id=>vouchers.filter(v=>v&&v.sourceType==='invoice'&&String(v.sourceId??'')===String(id));
 const checkBalanced=(v,id)=>{const vl=Array.isArray(v&&v.lines)?v.lines:[];let d=0,c=0,valid=true;for(const x of vl){const a=amount(x&&x.debit),b=amount(x&&x.credit);if(a===null||b===null){valid=false;continue;}d+=a;c+=b;}if(!valid||Math.abs(d-c)>TOLERANCE){unbalancedVouchers++;add('voucher-unbalanced',id,'سند مرتبط تراز نیست یا مبلغ نامعتبر دارد.','بدهکار: '+d+' | بستانکار: '+c);}};
 const checkSide=(v,id,code,field,expected,counterField,type,message)=>{const ls=linesFor(v,code),actual=sum(ls,field),opposite=sum(ls,counterField);if(actual===null||opposite===null||Math.abs(actual-expected)>TOLERANCE||opposite>TOLERANCE){if(type==='cogs')cogsAmountMismatches++;else if(type==='inventory')inventoryCounterpartMismatches++;else returnAmountMismatches++;add(type+'-'+code,id,message,'مبنای فاکتور/برگشت: '+expected+' | حساب '+code+': '+actual+' | سمت مقابل: '+opposite);}};
 active.forEach(inv=>{
  const id=String(inv.id??''),matches=findInvoiceVouchers(id),isSale=inv.type==='sale';
  if(isSale)salesChecked++;else purchasesChecked++;
  if(matches.length!==1){if(!matches.length)missingInvoiceVouchers++;else duplicateInvoiceVouchers++;add(matches.length?'invoice-voucher-duplicate':'invoice-voucher-missing',id,matches.length?'برای فاکتور بیش از یک سند با منشأ یکسان ثبت شده است.':'سند حسابداری فاکتور پیدا نشد.',matches.length+' سند');return;}
  const v=matches[0];checkBalanced(v,id);const items=Array.isArray(inv.items)?inv.items:[];
  if(isSale){const costs=items.map(x=>amount(x&&x.costOfGoodsSold));if(!items.length||costs.some(x=>x===null)){invalidCogsLines++;add('cogs-line-invalid',id,'بهای تمام‌شده حداقل یک ردیف فروش ثبت نشده یا نامعتبر است.','');}else{const expected=costs.reduce((a,b)=>a+b,0);checkSide(v,id,'5101','debit',expected,'credit','cogs','بدهکار حساب ۵۱۰۱ با بهای تمام‌شده فاکتور فروش برابر نیست.');checkSide(v,id,'1105','credit',expected,'debit','inventory','بستانکار حساب ۱۱۰۵ با بهای تمام‌شده خروج انبار برابر نیست.');details.push({invoiceId:id,voucherId:String(v.id??''),expectedCogs:expected,account5101Debit:sum(linesFor(v,'5101'),'debit'),account1105Credit:sum(linesFor(v,'1105'),'credit')});}}
  else{items.forEach(line=>{const p=products.find(x=>x&&String(x.id)===String(line&&line.productId));if(!p){missingPurchaseProducts++;add('purchase-product-missing',id,'کالای فاکتور خرید در فهرست کالاها پیدا نشد.',String(line&&line.productId||''));return;}const lot=String(line.lot||('PUR-'+id+'-'+String(line.productId||'')));const received=(Array.isArray(p.batches)?p.batches:[]).filter(b=>b&&b.sourceType==='purchase'&&String(b.sourceRef??'')===id&&String(b.lot??'')===lot).reduce((n,b)=>n+(amount(b.quantity)??0),0);const expected=amount(line.kg);if(expected===null||Math.abs(received-expected)>0.000001){purchaseQuantityMismatches++;add('purchase-batch-quantity',id,'مقدار فاکتور خرید با سری ساخت ورودی تطبیق ندارد.','فاکتور: '+line.kg+' | سری ساخت: '+received);}});const purchaseValue=amount(inv.sub)??items.reduce((n,x)=>n+(amount(x&&x.total)??0),0);checkSide(v,id,'1105','debit',purchaseValue,'credit','inventory','بدهکار حساب ۱۱۰۵ با مبلغ خالص خرید برابر نیست.');}

 });
 active.forEach(inv=>{
  const id=String(inv.id??''),isSale=inv.type==='sale';
  (Array.isArray(inv.returnRefs)?inv.returnRefs:[]).forEach(ref=>{
   const rid=String((ref&&ref.id)??'').trim();
   if(!rid){returnLinksUnverified++;add('return-id-missing',id,'سابقه برگشت شناسه ندارد.','');return;}
   const rv=vouchers.filter(x=>x&&x.sourceType==='invoice_return'&&String(x.sourceId??'')===rid&&String(x.sourceEvent??'')===id);
   if(rv.length!==1){returnLinksUnverified++;add('return-voucher-link',id,'سند برگشت با شناسه برگشت و فاکتور متناظر یکتا پیدا نشد.','شناسه برگشت: '+rid+' | تعداد سند: '+rv.length);return;}
   const ret=rv[0];checkBalanced(ret,id);const retItems=Array.isArray(ref.items)?ref.items:[],returnInventory=retItems.reduce((n,x)=>n+(amount(x&&x.inventoryCost)??0),0);
   if(retItems.some(x=>amount(x&&x.inventoryCost)===null)){returnAmountMismatches++;add('return-cost-invalid',id,'بهای دفتری یکی از ردیف‌های برگشت نامعتبر است.','برگشت: '+rid);}
   if(isSale){const expected=amount(ref.costOfGoodsSold);if(expected===null){returnAmountMismatches++;add('return-cogs-invalid',id,'بهای تمام‌شده برگشت فروش ثبت نشده است.','برگشت: '+rid);}else{checkSide(ret,id,'5101','credit',expected,'debit','return-cogs','بستانکار حساب ۵۱۰۱ با بهای تمام‌شده برگشت فروش برابر نیست.');checkSide(ret,id,'1105','debit',expected,'credit','return-inventory','بدهکار حساب ۱۱۰۵ با بهای برگشت فروش برابر نیست.');}}
   else checkSide(ret,id,'1105','credit',returnInventory,'debit','return-inventory','بستانکار حساب ۱۱۰۵ با بهای دفتری برگشت خرید برابر نیست.');
   details.push({invoiceId:id,returnId:rid,voucherId:String(ret.id??''),returnInventoryCost:returnInventory,returnCogs:amount(ref.costOfGoodsSold)});
  });
 });
 let kardexStockMismatches=0,batchStockMismatches=0,unverifiedStockTrace=0,kardexSequenceMismatches=0,invalidKardexRows=0,negativeKardexBalances=0;
 products.forEach(product=>{
  const stock=amount(product&&product.stock);let unverified=false;
  const kardex=Array.isArray(product&&product.kardex)?product.kardex:[];
  let previousBalance=0;
  kardex.forEach((row,index)=>{
   const inQty=amount(row&&row.inQty),outQty=amount(row&&row.outQty),balance=amount(row&&row.bal);
   const rawBalance=row&&row.bal, numericBalance=rawBalance!==null&&rawBalance!==undefined&&String(rawBalance).trim()!==''?Number(rawBalance):NaN;
   if(!row||typeof row!=='object'||inQty===null||outQty===null||balance===null){
    invalidKardexRows++;unverified=true;
    if(Number.isFinite(numericBalance)&&numericBalance< -0.000001)negativeKardexBalances++;
    add('kardex-row-invalid',String(product.id??''),'ردیف کاردکس دارای مقدار ورود، خروج یا مانده نامعتبر است.','ردیف: '+(index+1)+' | تاریخ: '+String(row&&row.date||'—')+' | شرح: '+String(row&&row.doc||'—'));
    if(Number.isFinite(numericBalance)&&numericBalance>=0)previousBalance=numericBalance;
    return;
   }
   // An initial stocktake can establish the first trusted baseline without a prior movement.
   if(index===0&&String(row.sourceType||'')==='stocktake'){previousBalance=balance;return;}
   const expected=previousBalance+inQty-outQty;
   if(balance< -0.000001||expected< -0.000001)negativeKardexBalances++;
   if(Math.abs(balance-expected)>0.000001){
    kardexSequenceMismatches++;
    add('kardex-sequence-mismatch',String(product.id??''),'مانده ردیف کاردکس با مانده قبلی به‌علاوه ورود و منهای خروج سازگار نیست.','ردیف: '+(index+1)+' | مانده قبلی: '+previousBalance+' | ورود: '+inQty+' | خروج: '+outQty+' | مانده مورد انتظار: '+expected+' | مانده ثبت‌شده: '+balance+' | تاریخ: '+String(row.date||'—')+' | شرح: '+String(row.doc||'—'));
   }
   previousBalance=balance;
  });
  if(kardex.length){const last=kardex[kardex.length-1],balance=amount(last&&last.bal);if(stock===null||balance===null)unverified=true;else if(Math.abs(stock-balance)>0.000001){kardexStockMismatches++;add('kardex-stock-mismatch',String(product.id??''),'موجودی فعلی کالا با مانده آخرین ردیف کاردکس برابر نیست.','موجودی کالا: '+stock+' | مانده آخر کاردکس: '+balance+' | تاریخ: '+String(last.date||'—')+' | شرح: '+String(last.doc||'—'));}}
  else if(stock!==null&&stock>0)unverified=true;
  const batches=Array.isArray(product&&product.batches)?product.batches:[];
  if(batches.length){let total=0,valid=true;batches.forEach(batch=>{const qty=amount(batch&&(batch.remainingQty??batch.quantity));if(qty===null)valid=false;else total+=qty;});if(!valid||stock===null)unverified=true;else if(Math.abs(stock-total)>0.000001){batchStockMismatches++;add('batch-stock-mismatch',String(product.id??''),'جمع مقدار باقی‌مانده سری‌های ساخت با موجودی کالا برابر نیست.','موجودی کالا: '+stock+' | جمع سری ساخت: '+total);}}
  else if(stock!==null&&stock>0)unverified=true;
  if(unverified){unverifiedStockTrace++;add('stock-trace-unverified',String(product.id??''),'ردیابی مقداری کالا به دلیل نبود یا نامعتبر بودن سابقه کاردکس/سری ساخت کامل نیست.','موجودی ثبت‌شده: '+String((product&&product.stock)??'خالی'));}
 });
 const knownReturns=new Set();invoices.forEach(inv=>(Array.isArray(inv&&inv.returnRefs)?inv.returnRefs:[]).forEach(r=>knownReturns.add(String((r&&r.id)??''))));
 vouchers.filter(v=>v&&v.sourceType==='invoice_return').forEach(v=>{if(!knownReturns.has(String(v.sourceId??''))){orphanReturnVouchers++;add('return-voucher-orphan',String(v.sourceEvent??''),'سند برگشت به سابقه برگشت فاکتور متصل نیست.','شناسه برگشت: '+String(v.sourceId??''));}});
 return{salesChecked,purchasesChecked,missingInvoiceVouchers,duplicateInvoiceVouchers,invalidCogsLines,cogsAmountMismatches,inventoryCounterpartMismatches,unbalancedVouchers,purchaseQuantityMismatches,missingPurchaseProducts,returnLinksUnverified,returnAmountMismatches,orphanReturnVouchers,kardexStockMismatches,batchStockMismatches,unverifiedStockTrace,kardexSequenceMismatches,invalidKardexRows,negativeKardexBalances,issueCount:issues.length,issues,details};
}
root.HolooInventoryCostAudit={buildInventoryCostAudit};if(typeof module!=='undefined'&&module.exports)module.exports=root.HolooInventoryCostAudit;
})(typeof globalThis!=='undefined'?globalThis:this);
