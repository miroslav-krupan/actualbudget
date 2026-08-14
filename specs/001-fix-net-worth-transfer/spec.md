# Feature Specification: Fix Net Worth Transfer Date Mismatch

**Feature Branch**: `[001-fix-net-worth-transfer]`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "Issue #6: [Bug]: Net worth widget incorrectly shows change when transferring between accounts. The net worth widget shows an incorrect gain/loss if a transfer between accounts occurs and the dates for each side of the transfer fall on different months. Reproduction: 1. Create a transfer between two accounts. 2. Give one side of the transfer a date of 7/31. 3. Give the other side a date of 8/1. 4. View the net worth graph and observe that the graph changed even though no change in net worth occurred."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Net worth stays flat for split-month transfers (Priority: P1)

A user transfers money between two of their own accounts. The withdrawal side of the transfer is dated the last day of one month and the deposit side is dated the first day of the next month. The user then views the net worth graph/widget to check their overall financial trend.

**Why this priority**: This is the core bug. A transfer between a user's own accounts must never change total net worth, regardless of how the two legs are dated. Showing a false gain or loss undermines trust in the tool's core reporting feature and could lead users to make decisions based on incorrect data.

**Independent Test**: Can be fully tested by creating a transfer where the two legs fall in different months (e.g., one leg dated 7/31, the other dated 8/1) and confirming the net worth graph shows no change in total net worth across the month boundary, while each account's individual balance still reflects its own transaction date.

**Acceptance Scenarios**:

1. **Given** two accounts each with a starting balance, **When** a transfer is created with the withdrawal leg dated 7/31 and the deposit leg dated 8/1, **Then** the net worth graph shows the same total net worth value at the end of July and the start of August (no artificial gain or loss attributed to either month).
2. **Given** the same split-dated transfer, **When** the user views each individual account's balance history, **Then** each account's balance changes on its own transaction's date (the account balances may differ day-to-day, but the combined total does not show a transfer-driven change).
3. **Given** a transfer where both legs share the same date, **When** the user views the net worth graph, **Then** behavior is unchanged from before this fix (no regression for the common case).
4. **Given** a transfer whose legs fall in the same month but on different days, **When** the user views the net worth graph, **Then** total net worth shows no change attributable to the transfer.

### Edge Cases

- What happens when a transfer's two legs fall in different months but the same reporting interval boundary is not a month (e.g., custom date range reports, weekly views)? The fix must generalize to any reporting granularity/date range, not just month boundaries.
- What happens when a transfer's two legs fall in different years (e.g., 12/31 and 1/1)?
- What happens with a transfer between an on-budget and an off-budget/tracking account, where one side may be excluded from certain balance calculations?
- What happens with multiple transfers between the same two accounts on different mismatched dates within the same reporting period?
- What happens when one or both accounts involved in the transfer are closed after the transfer date?
- How does the graph behave when the mismatched-date transfer is the very first or very last transaction in the selected report range?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The net worth graph MUST treat any transfer between two of the user's own accounts as net-worth-neutral, regardless of whether the transfer's two legs are dated on the same day, different days, different months, or different years.
- **FR-002**: The net worth graph MUST NOT display an apparent gain or loss in a reporting period solely because a transfer's withdrawal leg and deposit leg fall in different periods (e.g., different months).
- **FR-003**: Individual account balance calculations and displays MUST continue to reflect each transfer leg on its own recorded date (this fix affects only the aggregated net worth calculation, not per-account balances or transaction dates).
- **FR-004**: The system MUST correctly identify which transactions are transfers between the user's own tracked accounts (as opposed to transfers involving payees/categories or off-budget accounts) when computing net worth.
- **FR-005**: The fix MUST apply consistently across all report time granularities and views that show net worth (e.g., daily, weekly, monthly groupings), not just the specific month-boundary example in the bug report.
- **FR-006**: The system MUST NOT change the total net worth value at any point in time as a result of this fix for data that does not involve mismatched-date transfers (no regression to existing correct calculations).
- **FR-007**: The system MUST [NEEDS CLARIFICATION: should transfers involving off-budget/tracking accounts, or accounts excluded from net worth reports, be treated the same as on-budget-to-on-budget transfers, or should the existing exclusion rules for those account types still apply on top of this fix?]

### Key Entities

- **Transfer**: A pair of linked transactions representing money moved between two of the user's accounts; each leg has its own account, amount, and date, but together they represent a single movement of funds with no net effect on total wealth.
- **Net Worth Snapshot**: The calculated total value of all included accounts as of a given point in time, used to plot the net worth graph over a selected date range.
- **Account**: A financial account (on-budget or off-budget/tracking) whose balance contributes to the net worth calculation, subject to existing inclusion/exclusion rules.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For 100% of transfers between a user's own accounts, the net worth graph shows zero net change attributable to the transfer, regardless of the dates assigned to each leg.
- **SC-002**: Users reviewing the net worth graph after creating a split-month (or split-period) transfer see the same total net worth trend they would see if both legs had been dated identically.
- **SC-003**: No existing net worth graph values change for accounts/data sets that do not contain a mismatched-date transfer, confirmed by comparing before/after results on representative existing budgets.
- **SC-004**: The reported bug's reproduction steps (transfer dated 7/31 and 8/1) no longer produce a visible artificial gain/loss when manually verified against the example budget from the issue.

## Assumptions

- "Transfer" refers to Actual's existing linked-transaction transfer feature between two of the user's own accounts, not a transaction paid to/from an external payee.
- The fix is scoped to the net worth calculation/graph and does not require changing how individual account balances or transaction dates are stored or displayed.
- Existing rules about which accounts are included in net worth (e.g., excluding certain off-budget accounts, if such exclusions exist) remain in place; this feature only removes the false gain/loss caused by mismatched transfer-leg dates, and does not otherwise change which accounts count toward net worth.
- The fix should apply retroactively to existing data (past transfers with mismatched dates) as soon as it ships, since net worth is calculated from stored transaction data rather than being fixed only for newly created transfers.
