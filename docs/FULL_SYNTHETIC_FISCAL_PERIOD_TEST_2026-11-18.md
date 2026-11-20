# Full Synthetic Fiscal Period Test — 2026-11-18

## Purpose and isolation
This test runs only against synthetic in-memory state in Node.js. It does not connect to Supabase, GitHub Pages runtime data, or any live company dataset. It exercises the current `postVoucher`, `getAccountBalances`, `getPartyNetBalance`, and `updateCheckStatus` functions extracted from `index.html`.

## Synthetic company
- Company: شرکت آزمایشی نساجی
- Fiscal year: 1405
- Customer: C-001
- Supplier: S-001
- Product: FAB-01, synthetic fabric
- Opening capital: 10,000,000 IRR

## Scenario
1. Record opening capital in cash.
2. Purchase 100 kg of fabric for 3,000,000 IRR on supplier credit.
3. Pay 1,200,000 IRR to the supplier from cash.
4. Sell 60 kg of fabric for 5,000,000 IRR on customer credit.
5. Recognize 2,000,000 IRR cost of goods sold and reduce inventory.
6. Receive 2,000,000 IRR cash from the customer.
7. Receive a 1,000,000 IRR customer cheque and clear it into the bank.
8. Record 300,000 IRR operating expense paid from cash.
9. Attempt to clear the same cheque a second time; the duplicate transition must not create another voucher or change the bank balance.

## Independently reconciled expected closing values (IRR)

| Account / report | Expected |
|---|---:|
| Cash | 10,500,000 |
| Bank | 1,000,000 |
| Customer receivables | 2,000,000 |
| Cheques receivable | 0 |
| Inventory | 1,000,000 |
| Supplier payables | 1,800,000 |
| Sales revenue | 5,000,000 |
| Cost of goods sold | 2,000,000 |
| Operating expense | 300,000 |
| Net profit | 2,700,000 |
| Total assets | 14,500,000 |
| Liabilities + equity + current profit | 14,500,000 |

The trial balance must satisfy total debit balances = total credit balances. The customer subledger must be +2,000,000 IRR and the supplier subledger -1,800,000 IRR (negative means payable in this app's debit-minus-credit convention). Closing product quantity is 40 kg.

## Automated assertions
The integration test checks balanced vouchers, invoice-to-voucher references, party subledgers, cash/bank/receivable/payable/inventory balances, profit and loss, balance sheet equation, cheque lifecycle idempotency, and closing quantity.

Run locally with:

```bash
node tests/full-fiscal-period.integration.test.js
```

## Scope limitations
This is a synthetic ledger integration test, not a browser/mobile UI test and not a live Supabase concurrency test. Purchase/sale stock quantity movement and the corresponding accounting entries are represented in the synthetic scenario; this does not prove every UI event handler or warehouse workflow. The test deliberately does not write any data to the production cloud database.
