# Feature Specification: Fix Cent-Short Amount Rounding

**Feature Branch**: `001-fix-amount-rounding`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Issue #22: [Bug]: Some transaction amounts are saved a cent short (e.g. 19.99 becomes 19.98). Certain amounts are stored one cent lower than what was entered. The clearest example: entering a transaction of 19.99 saves it as 19.98. It doesn't happen for every amount (3.10 and 5.55 are fine), but it is consistent for the ones it affects, so balances and imported totals end up a few cents short over time. The amount to integer-cents conversion (amountToInteger in packages/loot-core/src/shared/util.ts) rounds down instead of to the nearest cent, because floating point multiplication (e.g. 19.99 * 100 = 1998.9999999999998) causes flooring to drop a cent. Steps to reproduce: add a transaction for 19.99 (or import a file containing 19.99); the stored/displayed amount is 19.98. Expected: amounts should be rounded to the nearest cent, so amountToInteger(19.99) should return 1999, not 1998. amountToInteger currently has no unit-test coverage, so a regression test should be added alongside the fix."

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.

  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - Enter an exact transaction amount (Priority: P1)

A user adds a transaction manually and types in an amount that has two decimal places (e.g. 19.99). The amount stored and later displayed for that transaction must exactly match what the user typed.

**Why this priority**: This is the core reported defect. Any silent, unexplained discrepancy between what a user enters and what is stored directly undermines trust in the budgeting tool's accuracy and causes balances to drift over time.

**Independent Test**: Can be fully tested by entering a transaction of 19.99 through the transaction entry UI and confirming the account balance and the displayed transaction amount both show 19.99, not 19.98.

**Acceptance Scenarios**:

1. **Given** a user is creating a new transaction, **When** they enter an amount of 19.99, **Then** the transaction is saved and displayed as 19.99.
2. **Given** a user is creating a new transaction, **When** they enter an amount of 3.10, **Then** the transaction is saved and displayed as 3.10 (already-working case must remain unaffected).
3. **Given** a user is creating a new transaction, **When** they enter an amount known to trigger floating-point drift when multiplied by 100 (e.g. 19.99, 9.99, 29.99), **Then** the saved amount matches the entered amount to the cent.

---

### User Story 2 - Import a file containing affected amounts (Priority: P1)

A user imports a bank statement or other transaction file that contains one or more amounts susceptible to the floating-point rounding defect. After import, every imported amount must match the source file to the cent.

**Why this priority**: Imports are a primary way many users get transactions into the system in bulk; a systemic rounding error here compounds across many transactions and produces balances that silently drift, which is harder for a user to notice and diagnose than a single manual entry.

**Independent Test**: Can be fully tested by importing a file containing a transaction amount of 19.99 and confirming the resulting transaction and account balance reflect 19.99.

**Acceptance Scenarios**:

1. **Given** an import file contains a transaction amount of 19.99, **When** the file is imported, **Then** the resulting transaction amount is 19.99.
2. **Given** an import file contains a mix of amounts (some affected by the defect, some not), **When** the file is imported, **Then** every transaction amount matches its source value to the cent.

---

### User Story 3 - Confidence via automated regression coverage (Priority: P2)

A developer or maintainer wants assurance that this class of rounding defect cannot silently reappear in the future.

**Why this priority**: The underlying conversion function previously had no unit-test coverage, which is why the defect went undetected. Adding coverage protects the fix long-term but does not by itself deliver user-facing value, so it is secondary to the user-facing fixes above.

**Independent Test**: Can be fully tested by running the automated test suite for the affected conversion function and confirming it fails against the old (flooring) behavior and passes against the corrected (nearest-cent) behavior.

**Acceptance Scenarios**:

1. **Given** the amount-to-integer-cents conversion is covered by automated tests, **When** the test suite is run against known previously-affected values (e.g. 19.99, 9.99), **Then** all tests pass with the corrected nearest-cent output.
2. **Given** the automated tests exist, **When** the fix is reverted, **Then** at least one test fails, demonstrating the regression would be caught.

---

### Edge Cases

- What happens for amounts that fall exactly halfway between two cent values (e.g. a raw computed value of x.xx5)? [NEEDS CLARIFICATION: rounding tie-breaking rule not specified — should halves round up, round to nearest even, or round away from zero, and does this differ for negative (expense/outflow) amounts?]
- How should negative amounts (expenses/outflows, which are common in this system) be rounded when floating-point drift pushes them toward or away from zero?
- How does the system handle currencies or contexts that use a different number of decimal places than 2 (e.g. 0 or 3 decimal places), given the conversion function accepts a configurable decimal-places parameter?
- What happens for amounts at the extreme edges of supported magnitude, where floating-point precision loss could exceed a single cent?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: The system MUST convert a user-entered or imported decimal amount into its integer cents (or smallest currency unit) representation by rounding to the nearest whole unit, not by truncating/flooring.
- **FR-002**: The system MUST produce a stored amount that matches the entered/imported decimal value to the cent for all previously-affected values (e.g. 19.99 must convert to 1999, not 1998).
- **FR-003**: The system MUST continue to correctly convert amounts that were already working correctly (e.g. 3.10, 5.55), producing no regression for those cases.
- **FR-004**: The system MUST apply the corrected rounding behavior consistently across all entry points that convert decimal amounts into stored integer amounts, including manual transaction entry and file import.
- **FR-005**: The system MUST have automated regression test coverage for the amount-to-integer-cents conversion, including at minimum the previously-affected example values, so future changes cannot silently reintroduce the defect.
- **FR-006**: The system MUST round amounts consistently regardless of sign (positive/inflow or negative/outflow amounts) [NEEDS CLARIFICATION: exact tie-breaking/rounding direction for negative values and exact-half values is not specified in the source report].

### Key Entities *(include if feature involves data)*

- **Transaction Amount**: A monetary value associated with a transaction, entered by a user or read from an imported file as a decimal value, and stored internally as an integer count of the smallest currency unit (e.g. cents). Key attribute: the stored integer value must correspond to the nearest smallest-unit representation of the original decimal value.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 100% of manually entered transaction amounts are stored and displayed exactly matching the value the user typed (to the cent), including previously-affected values such as 19.99.
- **SC-002**: 100% of imported transaction amounts are stored exactly matching their source value (to the cent), eliminating the cumulative balance drift previously reported.
- **SC-003**: Zero regressions: all amounts that were previously converted correctly continue to convert correctly after the fix.
- **SC-004**: The conversion logic has automated test coverage such that reintroducing the flooring defect causes at least one test failure, giving maintainers confidence the defect cannot silently reoccur.

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- The defect and its fix are scoped to the conversion of a decimal amount into an integer smallest-currency-unit representation, and do not involve changes to how amounts are displayed back to users (decimal formatting), which is assumed to already be correct.
- "Nearest cent" rounding is assumed to be the desired behavior for the common (non-tie) case, as explicitly stated in the issue's expected behavior; only the tie-breaking rule for exact-half values remains unresolved (see NEEDS CLARIFICATION markers).
- This fix applies to all currencies/contexts using the shared conversion utility, not just a single currency, since the reported defect is in a shared utility function rather than currency-specific code.
- Existing transactions already stored with the cent-short defect are out of scope for this feature; this specification covers only the correctness of future conversions, not a data migration/backfill of historical transactions.
