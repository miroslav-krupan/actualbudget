# Feature Specification: Fix Transaction Amount Rounding (cent-short bug)

**Feature Branch**: `001-fix-transaction-amount-rounding`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Issue #38: [Bug]: Some transaction amounts are saved a cent short (e.g. 19.99 becomes 19.98). Certain amounts are stored one cent lower than what I entered. The clearest example: entering a transaction of 19.99 saves it as 19.98. It doesn't happen for every amount (3.10 and 5.55 are fine), but it is consistent for the ones it affects, so my balances and imported totals end up a few cents short over time. It looks like the amount → integer-cents conversion (amountToInteger in packages/loot-core/src/shared/util.ts) rounds down instead of to the nearest cent. Because 19.99 * 100 is 1998.9999999999998 in floating point, flooring it drops it to 1998 (i.e. 19.98) instead of rounding to 1999 (19.99). Steps to reproduce: 1. Add a transaction for 19.99 (or import a file containing 19.99). 2. The stored/displayed amount is 19.98. Expected behaviour: Amounts should be rounded to the nearest cent. amountToInteger(19.99) should return 1999, not 1998. Notes: amountToInteger currently has no unit-test coverage, so a regression test should be added alongside the fix."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Enter an exact-decimal transaction amount and have it stored correctly (Priority: P1)

A user manually adds a transaction with a monetary amount that has exactly two decimal digits (e.g. 19.99). The amount stored and displayed for that transaction must exactly match what the user entered, with no cent lost due to floating-point conversion artifacts.

**Why this priority**: This is the core defect. If amounts are silently altered, users lose trust in account balances and reconciliation becomes unreliable. This must be fixed for the feature to deliver any value.

**Independent Test**: Can be fully tested by entering a transaction amount known to trigger the defect (e.g. 19.99) and verifying the stored/displayed amount is unchanged (19.99), independent of any import workflow.

**Acceptance Scenarios**:

1. **Given** a user is adding a new transaction, **When** they enter an amount of 19.99, **Then** the transaction is stored and displayed as 19.99 (not 19.98).
2. **Given** a user is adding a new transaction, **When** they enter amounts that previously worked correctly (e.g. 3.10, 5.55), **Then** those amounts continue to be stored and displayed unchanged.

---

### User Story 2 - Import a file containing affected amounts and have totals stay accurate (Priority: P2)

A user imports a file (e.g. bank statement, OFX/QFX/CSV) that contains one or more amounts susceptible to the floating-point rounding defect. After import, the imported transaction amounts and any resulting account totals must match the source file exactly.

**Why this priority**: Import is a common, often bulk, entry path, and the same defect compounds across many transactions, making balances "a few cents short over time" as described in the issue. It depends on the same underlying conversion logic as User Story 1 but is a distinct, independently verifiable workflow.

**Independent Test**: Can be fully tested by importing a file containing a known affected amount (e.g. 19.99) and verifying the resulting transaction and account balance reflect the correct value.

**Acceptance Scenarios**:

1. **Given** a user imports a file containing a transaction amount of 19.99, **When** the import completes, **Then** the transaction is recorded as 19.99 and the account balance reflects that exact amount.

---

### User Story 3 - Regression protection for the amount conversion logic (Priority: P3)

A developer or maintainer needs confidence that the amount-to-integer-cents conversion behaves correctly for previously-untested inputs, so the defect cannot silently reappear in the future.

**Why this priority**: This does not change user-facing behavior directly but protects the fix long-term. It is lower priority than the user-facing fixes themselves but is explicitly called out as required by the issue reporter.

**Independent Test**: Can be fully tested by running the added automated tests covering the amount conversion function and confirming they fail against the old (pre-fix) behavior and pass against the corrected behavior.

**Acceptance Scenarios**:

1. **Given** the amount conversion logic, **When** it is given a value known to previously round down incorrectly (e.g. 19.99), **Then** an automated test verifies it returns the correct nearest-cent integer value (1999).

---

### Edge Cases

- What happens when the entered amount is exactly halfway between two cent values due to floating-point representation (e.g. values that resolve to `X.YY5` after multiplication)? [NEEDS CLARIFICATION: tie-breaking rule for rounding exact half-cent boundaries is not specified in the issue — round half up, round half away from zero, or round half to even?]
- How does the system handle negative amounts (expenses/refunds) that are subject to the same floating-point conversion? Does "round to nearest" mean nearest in absolute value (away from zero) or strictly numerically nearest (toward positive infinity)? [NEEDS CLARIFICATION: rounding direction for negative amounts is not specified]
- What happens to transactions that were already saved incorrectly (a cent short) before this fix is applied — are existing/historical records corrected, or does the fix only apply to amounts entered or imported going forward? [NEEDS CLARIFICATION: whether already-affected historical transactions must be corrected/migrated, or only new entries going forward, is not specified in the issue]
- How does the system handle amounts with more than two decimal digits of precision (e.g. from imported files with sub-cent precision)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST convert a user-entered or imported monetary amount into its integer-cents representation such that the result reflects the nearest whole cent to the original decimal value, rather than truncating/flooring toward zero.
- **FR-002**: System MUST correctly convert amounts that are known to be affected by floating-point representation error during the cents conversion (e.g. 19.99) to their exact intended integer-cents value (e.g. 1999), with no loss of a cent.
- **FR-003**: System MUST continue to correctly convert amounts that were already unaffected by the defect (e.g. 3.10, 5.55), producing the same correct results as before.
- **FR-004**: System MUST apply the corrected conversion consistently across all entry points that create or modify transaction amounts, including manual transaction entry and file import.
- **FR-005**: System MUST include automated regression test coverage for the amount-to-integer-cents conversion logic, including at least one case that previously failed due to the floating-point rounding defect.
- **FR-006**: System MUST handle [NEEDS CLARIFICATION: tie-breaking rule for exact half-cent values] when the entered amount falls exactly between two cent values.

### Key Entities

- **Transaction Amount**: The monetary value associated with a transaction, entered by a user or read from an imported file, ultimately persisted internally as an integer number of cents.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of manually entered transaction amounts with up to two decimal digits are stored and displayed with the exact cent value the user entered.
- **SC-002**: 100% of imported transaction amounts with up to two decimal digits match the source file's amount exactly, with no discrepancy in resulting account balances attributable to the conversion defect.
- **SC-003**: The specific previously-failing case from the issue (19.99) is verified via automated test to convert to 1999 integer cents, and the test suite continues to pass for previously-correct cases (e.g. 3.10, 5.55).
- **SC-004**: Zero user-reported instances of balances drifting due to cent-level rounding discrepancies in amount entry or import after the fix ships.

## Assumptions

- The defect is isolated to the decimal-amount-to-integer-cents conversion step; the reverse conversion (integer cents back to a displayed decimal amount) is assumed to already be correct and is out of scope unless testing reveals otherwise.
- "Nearest cent" rounding for amounts that are not exactly on a cent boundary due to floating-point error follows standard commercial rounding conventions (round half up) unless clarified otherwise.
- This fix addresses newly entered and newly imported amounts going forward; whether historical data requires correction is called out explicitly as a clarification above rather than assumed.
- The fix applies only to the conversion of decimal currency amounts with up to two decimal digits (the standard precision for supported currencies); behavior for currencies or inputs with different decimal precision is not in scope.
