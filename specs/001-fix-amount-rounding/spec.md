# Feature Specification: Fix Transaction Amount Rounding to Nearest Cent

**Feature Branch**: `[001-fix-amount-rounding]`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Issue #27: [Bug]: Some transaction amounts are saved a cent short (e.g. 19.99 becomes 19.98). Certain amounts are stored one cent lower than what was entered. Entering a transaction of 19.99 saves it as 19.98. It doesn't happen for every amount (3.10 and 5.55 are fine), but it is consistent for the ones it affects, so balances and imported totals end up a few cents short over time. The amount-to-integer-cents conversion rounds down instead of to the nearest cent due to floating point imprecision (19.99 * 100 = 1998.9999999999998, which floors to 1998 instead of rounding to 1999). Expected behaviour: amounts should be rounded to the nearest cent, so converting 19.99 should return 1999, not 1998. Note: the conversion currently has no unit-test coverage, so a regression test should be added alongside the fix."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Entered Amount Is Stored Exactly (Priority: P1)

A user enters a monetary amount (manually, via a form, or through a file import) that is affected by floating-point imprecision when converted to the smallest currency unit (e.g. cents). The system must store and display the amount the user actually entered, not an amount that is one unit lower due to a rounding error.

**Why this priority**: This is the core bug. Silent, systematic under-recording of amounts erodes trust in account balances and reporting, and can compound over many transactions into materially incorrect totals. This must be fixed for the feature to have any value.

**Independent Test**: Can be fully tested by entering a transaction amount known to trigger the floating-point issue (e.g. 19.99) and confirming the stored and displayed amount matches exactly what was entered (19.99, not 19.98).

**Acceptance Scenarios**:

1. **Given** a user is creating a new transaction, **When** they enter an amount of 19.99, **Then** the transaction is saved and displayed as 19.99.
2. **Given** a user is creating a new transaction, **When** they enter an amount that does not trigger floating-point imprecision (e.g. 3.10 or 5.55), **Then** the transaction continues to be saved and displayed correctly, with no regression in behavior.
3. **Given** a user imports a file containing a transaction amount of 19.99, **When** the import is processed, **Then** the imported transaction amount is 19.99, not 19.98.

---

### User Story 2 - Existing Balances Reflect Correct Historical Amounts (Priority: P2)

A user who has previously entered or imported transactions affected by the rounding bug expects that once the fix is applied, newly entered amounts stop losing a cent, so their balances stop drifting further off over time.

**Why this priority**: While correcting future entries is the most urgent need, users are also concerned about the cumulative effect on their balances ("a few cents short over time"). This story addresses stopping further drift; it is secondary to the core fix because it depends on the core conversion behavior being corrected first.

**Independent Test**: Can be tested by entering a sequence of transactions that include amounts known to trigger the bug, over multiple entries, and confirming the running balance matches the sum of the amounts as entered by the user.

**Acceptance Scenarios**:

1. **Given** the amount conversion fix is applied, **When** a user enters multiple transactions including amounts previously affected by the bug, **Then** the account balance equals the exact sum of the entered amounts.

---

### Edge Cases

- What happens when an amount is exactly halfway between two cent values (e.g. due to floating-point representation) — the system rounds to the nearest cent using "round half away from zero" as the tie-breaking rule for exact halfway cases (see Assumptions).
- How does the system handle negative amounts (e.g. refunds or negative transactions) with the same floating-point rounding issue — the rounding fix must produce correct results for both positive and negative amounts.
- How does the system handle currencies or locales that use a different number of decimal places (e.g. zero-decimal or three-decimal currencies) — confirmed out of scope: the two-decimal-place (cent) assumption is acceptable for all supported currencies.
- What happens to transactions and balances that were already stored incorrectly before the fix is deployed — confirmed out of scope: the fix applies only to amounts entered or imported after it ships; no migration or recalculation of previously affected historical records will be performed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST convert a user-entered or imported monetary amount to its integer smallest-currency-unit (cent) representation by rounding to the nearest whole cent, rather than truncating or flooring the result.
- **FR-002**: The system MUST correctly convert amounts that are susceptible to floating-point representation error (such as 19.99) to the exact cent value the user intended (1999), not a value one cent lower.
- **FR-003**: The system MUST continue to correctly convert amounts that were already unaffected by the floating-point issue (such as 3.10 and 5.55), with no change in their resulting stored value.
- **FR-004**: The system MUST apply the corrected rounding behavior consistently across all entry points that convert a decimal amount to an integer cent value, including manual transaction entry and file import.
- **FR-005**: The system MUST have automated regression test coverage verifying that the amount-to-integer-cents conversion produces the correct rounded result for a representative set of amounts, including values previously known to fail (e.g. 19.99) and values that already worked correctly (e.g. 3.10, 5.55).
- **FR-006**: The system MUST correctly round negative monetary amounts to the nearest cent, preserving sign and magnitude accuracy.

### Key Entities

- **Transaction Amount**: A monetary value entered or imported by a user, represented internally as an integer number of the smallest currency unit (e.g. cents); the entity affected by the conversion rounding behavior described in this spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of monetary amounts entered or imported by users are stored as the exact cent value corresponding to the amount entered, with zero systematic one-cent discrepancies.
- **SC-002**: Users report no further instances of account balances or imported totals drifting short by small cent amounts due to entry or import of affected values.
- **SC-003**: A verifiable, automated test suite confirms correct rounding for previously failing amounts (e.g. 19.99) and previously passing amounts (e.g. 3.10, 5.55), achieving 100% pass rate before the fix is considered complete.

## Assumptions

- The amounts involved are expressed in a two-decimal-place (cent-based) currency, consistent with current system behavior; the business has confirmed this assumption is acceptable for all supported currencies, so multi-decimal or zero-decimal currency support is not part of this fix.
- The fix targets the amount-to-integer-cents conversion behavior wherever it is used in the system (manual entry, imports, and any other callers), not a single isolated code path.
- No changes to the user-facing input format (e.g. decimal separators, currency symbols) are required; only the internal conversion accuracy is in scope.
- Correcting previously stored, already-affected historical data is out of scope: the business has confirmed the fix applies only to amounts entered or imported after it ships; existing balances are not migrated or recalculated.
- For amounts that fall exactly halfway between two cent values, the fix uses "round half away from zero" as the tie-breaking rule, consistent with conventional currency rounding; this was not explicitly raised with the business and is assumed as the reasonable default since no alternative (e.g. banker's rounding) was requested.
