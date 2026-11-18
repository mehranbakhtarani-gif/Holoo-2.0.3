# Import shipment costing and profitability

## Scope

Import shipments support one or multiple product lines. A one-product shipment is represented by a one-element `items` array; the legacy top-level fields remain for backward compatibility.

## Shipment item model

Each new `imports[]` record contains:

- `items[]`: stable item ID, product ID, quantity in KG, cartons, foreign-currency amount, lot, production/expiry dates.
- `allocatedExpenses`: item-level allocated shares for freight, insurance, customs, port, clearance, inland transport, warehouse and bank fees.
- `purchaseRial`, `landedCostRial`, `unitCost`, `landedCostPerKg`: purchase and landed-cost amounts.
- Shipment-level `fxTotal`, `fxRate`, `fxPaid`, `fxPayments`, `supplierPartyId`, and shipment documents/status.

Legacy shipments without `items[]` are normalized to one virtual item at read/receipt time. Historical shipment records and vouchers are not rewritten.

## Expense allocation

Every expense type has an independently selectable allocation basis:

- `weight`: share by KG.
- `cartons`: share by carton count.
- `value`: share by item foreign-currency value.
- `manual`: supported by the pure domain helper for exact item-level allocations; manual entry is not exposed in the current form.

Rial rounding remainder is assigned to the final item so the sum of allocated expense amounts equals the shipment expense total. Invalid/negative amounts, zero allocation bases, duplicate item IDs, and unbalanced manual allocations are rejected.

## Accounting flow

1. Shipment registration capitalizes purchase value and allocated landed costs into inventory-in-transit account 1105.
2. Foreign-currency purchase liability is credited to account 2105 and linked to the selected supplier subledger when supplied.
3. Unpaid/uncleared ancillary import charges are credited to the dedicated 2106 accrued import-payables account. This avoids recording a bank payment that did not occur. Existing historical vouchers are untouched.
4. Warehouse receipt transfers the same total from 1105 to inventory account 1103, while creating a separate batch for every shipment item.
5. Each import batch carries both `sourceRef = shipment.id` and `sourceItemId = item.id`, plus supplier, lot, cost and expiry metadata.

The receipt routine snapshots all affected products and restores stock, batches, average cost and kardex if the receipt voucher fails. It marks the receipt as posted before the voucher save so a repeated receipt is idempotent after a persisted snapshot.

## Supplier FX and staged settlement

Import-level staged payments reduce the shipment foreign-currency balance. Independent FX commitments can optionally link to a supplier party. Settlement requires a real bank account selection, updates its balance, records the payment event and posts realized FX gain/loss to 4104/6104. The original commitment rate is retained for calculating realized differences.

Open-balance unrealized FX is a report estimate until the user explicitly posts a period-end revaluation. The revaluation journal adjusts account 2105 against 4104/6104 and updates the carrying rate; later staged settlements use that carrying rate so the same exchange difference is not recognized twice. Legacy independent commitments created before opening-journal support remain memorandum-only and are excluded from posted revaluation until reconciled. New independent commitments require an offset account (1105 inventory in transit or 6101 expense) and receive a balanced opening voucher.

## Shipment profitability

Sales invoice lines now retain batch allocations in both costing modes:

- FIFO: cost is attributed to the shipment using the exact unit cost of the source batch.
- Weighted average: accounting COGS remains the selected average cost; shipment revenue/COGS is allocated across source batches by quantity for management reporting.

Partial returns reduce net sold quantity and revenue. Recorded batch return allocations are applied first; older returns without batch-level references are conservatively assigned to the earliest FIFO allocations. Sales that have no batch allocations are flagged as untraceable instead of being silently attributed to a shipment.

The report shows shipment and per-item revenue, net sold/returned KG, COGS, gross profit, realized FX and estimated unrealized FX. Gross profit is based on posted sales and returns, not current list prices.

## Compatibility and safeguards

- Existing `imports[]`, invoices, vouchers, stock and Supabase rows are not bulk rewritten.
- Account 2106 is added to the chart and migrated into existing local account catalogs without replacing custom accounts.
- If historical batch remaining quantities exceed the product's current stock, the unexplained on-hand balance is reclassified to a non-shipment legacy opening batch. Original batch records remain for historical references; this prevents new sales from being falsely attributed to old imports.
- No Supabase migration, RLS policy or live data mutation is part of this change.

## Automated tests

- `tests/import-domain.test.js`: multi-item costing, expense allocation, legacy normalization, returns, FIFO/AVG shipment profitability and untraceable history.
- `tests/import-dashboard.test.js`: single and multi-item warehouse receipt, source-item batch links, balanced receipt voucher and rollback on failure.
- `tests/fifo-batch.test.js`: batch reconciliation and FIFO allocation.
- `tests/fx-commitment.test.js`: staged FX settlement.
- `tests/advanced-accounting-lifecycle.test.js` and `tests/extended-workflow.test.js`: invoice, return and cancellation integration.
