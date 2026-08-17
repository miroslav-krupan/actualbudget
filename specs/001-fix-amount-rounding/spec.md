# Feature Specification: Fix Transaction Amounts Rounding a Cent Short

**Feature Branch**: `001-fix-amount-rounding`

**Created**: 2026-08-17

**Status**: Clarified

**Input**: User description: "Issue #32: [Bug]: Some transaction amounts are saved a cent short (e.g. 19.99 becomes 19.98). Certain amounts are stored one cent lower than what the user entered. The clearest example: entering a transaction of 19.99 saves it as 19.98. It doesn't happen for every amount (3.10 and 5.55 are fine), but it is consistent for the ones it affects, so balances and imported totals end up a few cents short over time. It looks like the amount → integer-cents conversion (`amountToInteger` in `packages/loot-core/src/shared/util.ts`) rounds down instead of to the nearest cent. Because 19.99 * 100 is 1998.9999999999998 in floating point, flooring it drops it to 1998 (i.e. 19.98) instead of rounding to 1999 (19.99). Reproduction: add a transaction for 19.99 (or import a file containing 19.99); the stored/displayed amount is 19.98. Expected behaviour: amounts should be rounded to the nearest cent; amountToInteger(19.99) should return 1999, not 1998. Notes: amountToInteger currently has no unit-test coverage, so a regression test should be added alongside the fix."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entering a Transaction Amount Saves the Exact Value (Priority: P1)

As a user managing my budget, when I manually enter a transaction amount (such as 19.99), I want the amount that is saved and displayed to exactly match what I typed, so that my account balances and category totals stay accurate over time.

**Why this priority**: This is the core reported bug. Silent, cent-level discrepancies erode trust in the tool's accuracy and compound over many transactions, directly undermining the product's core value proposition (accurate budgeting).

**Independent Test**: Manually add a transaction with an amount known to previously trigger the bug (e.g., 19.99) and confirm the transaction list, account balance, and category totals all reflect exactly 19.99, not 19.98.

**Acceptance Scenarios**:

1. **Given** a user is adding a new transaction, **When** they enter an amount of 19.99, **Then** the transaction is saved and displayed as 19.99.
2. **Given** a user is adding a new transaction, **When** they enter an amount that already converts correctly today (e.g., 3.10 or 5.55), **Then** the transaction continues to be saved and displayed with the same correct value (no new discrepancy is introduced).
3. **Given** a user edits an existing transaction's amount, **When** they change it to an amount previously affected by the rounding bug, **Then** the updated amount is saved exactly as entered.

---

### User Story 2 - Imported Transactions Reflect Exact Amounts (Priority: P2)

As a user importing transactions from a bank file or other external source, I want every imported amount to be stored exactly as it appears in the source file, so that my imported account totals match my bank's records.

**Why this priority**: Imports are a common, often bulk, entry point for transactions. A systemic rounding error here can silently shift many balances at once, making it a high-impact but slightly lower priority than the direct manual-entry fix since it depends on the same underlying conversion logic.

**Independent Test**: Import a file containing one or more amounts known to trigger the bug (e.g., 19.99) and confirm the resulting transactions show the exact source amount.

**Acceptance Scenarios**:

1. **Given** a user imports a file containing a transaction amount of 19.99, **When** the import completes, **Then** the resulting transaction shows 19.99, not 19.98.
2. **Given** a user imports a file containing a mix of previously-affected and previously-unaffected amounts, **When** the import completes, **Then** all amounts match the source file exactly.

---

### User Story 3 - Confidence That the Fix Prevents Future Regressions (Priority: P3)

As a maintainer of the budgeting tool, I want automated tests covering the amount-to-cents conversion, so that this class of rounding bug cannot silently reappear in the future.

**Why this priority**: Important for long-term quality but does not by itself change what end users experience today; it protects the fix delivered in User Stories 1 and 2.

**Independent Test**: Run the automated test suite for the amount conversion logic and confirm it fails against the old (buggy) behavior and passes against the corrected behavior, including the specific 19.99 case and other known-affected values.

**Acceptance Scenarios**:

1. **Given** the amount conversion logic, **When** it is given a value known to previously trigger the bug (e.g., 19.99), **Then** an automated test verifies it converts to the correct nearest-cent integer value.
2. **Given** the amount conversion logic, **When** it is given values that previously converted correctly, **Then** an automated test verifies those values still convert correctly.

### Edge Cases

- What happens when an entered amount falls exactly halfway between two cent values (e.g., due to floating-point representation, a value effectively at x.xx5)? The amount is rounded half up (to the next higher cent).
- What happens with negative amounts (e.g., a -19.99 expense) that are affected by the same floating-point conversion issue?
- What happens with very large amounts or amounts with more than 2 decimal places entered by a user or present in an import file?
- What happens to transactions and balances that were already saved incorrectly (a cent short) before this fix is applied? Existing, previously-saved transactions are left as-is; the fix only prevents the issue for new entries and imports going forward.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST convert a user-entered or imported currency amount to its integer-cents representation by rounding to the nearest cent, rather than truncating or flooring the result.
- **FR-002**: The system MUST produce the correct integer-cents value for amounts previously affected by the rounding bug (e.g., 19.99 MUST convert to 1999, not 1998).
- **FR-003**: The system MUST continue to produce the same correct integer-cents value for amounts that already convert correctly today (e.g., 3.10, 5.55), so the fix introduces no new discrepancies.
- **FR-004**: The system MUST apply the corrected rounding behavior consistently to amounts entered manually and amounts brought in through file imports.
- **FR-005**: The system MUST include automated regression tests for the amount-to-cents conversion covering both previously-affected and previously-unaffected representative values.
- **FR-006**: The system MUST round amounts consistently for negative values in a way that is symmetric with positive-value rounding (i.e., the magnitude of a negative amount is rounded the same way as the equivalent positive amount).
- **FR-007**: For amounts that fall exactly (or effectively, due to floating-point representation) halfway between two cent values, the system MUST round half up (i.e., round to the next higher cent value; for negative amounts, symmetrically round the magnitude up, per FR-006).
- **FR-008**: The system MUST NOT modify or migrate the amounts of transactions that were already saved before this fix ships; the corrected rounding behavior applies only to new entries and imports going forward.

### Key Entities

- **Transaction Amount**: A monetary value associated with a transaction, entered by a user or sourced from an imported file, expressed by users in standard currency notation (e.g., "19.99") and stored internally as an integer number of cents.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of manually entered transaction amounts are saved and displayed exactly as entered, with zero cent-level discrepancies, across a representative test set including all previously known-affected values.
- **SC-002**: 100% of imported transaction amounts match their source file values exactly, with zero cent-level discrepancies, across a representative test set including all previously known-affected values.
- **SC-003**: Account balances and category totals computed from a batch of transactions that include previously-affected amounts equal the sum of the exact entered/imported values, with no cumulative drift.
- **SC-004**: The amount conversion logic has automated test coverage that would have caught this specific bug (i.e., a test exists that fails under the old flooring behavior and passes under the corrected behavior).

## Assumptions

- The scope of this fix is limited to the currency amount → integer-cents conversion behavior and does not include a broader redesign of how amounts are entered, displayed, or formatted.
- Standard two-decimal-place currency entry (e.g., "19.99") is the primary supported input format; behavior for currencies with different decimal precision is out of scope unless already supported today.
- The fix applies to the conversion logic used by both manual transaction entry and file import, since both currently rely on the same underlying conversion behavior.
- Users have not made manual accounting workarounds to compensate for the existing bug that a fix might disrupt; no explicit backward-compatibility handling for such workarounds is assumed.
- Confirmed by the business analyst: previously-saved transactions that were affected by the rounding bug are left as-is; the fix only prevents the issue for new entries and imports going forward (no data migration/backfill).
- Confirmed by the business analyst: exact/near-halfway amounts are rounded half up (to the next higher cent, with negative amounts rounded symmetrically per FR-006).
