# Remediation log — 2026-11-21 (stage 1)

## Applied changes
- Strengthened invoice-return integrity auditing: a balanced voucher is now checked against the expected 4103 sales-return, 2103 output VAT, 1103 receivable, 2101 customer-credit, and 1105 inventory account movements derived from the return snapshot.
- Corrected revenue/expense audit linkage for valid sales returns (4103), purchase-return gains (4198), and independent FX gains (4104), avoiding false unlinked-revenue findings.
- Corrected the accounting-period-lock boundary test: reopening a month does not silently override an independently active quarter lock.
- Added regression coverage for a deliberately misallocated but balanced sales-return voucher and for return/FX revenue classification.

## Validation
The stage-1 ZIP was tested with `node --test tests/*.test.js`: 100 tests passed, 0 failed.

## Scope and limitations
These changes improve audit detection and regression coverage. They do not complete purchase VAT recoverability, row-level VAT treatment, payroll tax/social insurance, commission-return policy, bank statement reconciliation, physical cash counts, depreciation, fiscal-year closing, taxpayer-system transmission, mobile-device validation, or three-device synchronization testing. No production Supabase rows, RLS policies, migrations, or live accounting records were changed. The change set is proposed for review and is not merged.
