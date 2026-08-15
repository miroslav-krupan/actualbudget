# Feature Specification: Fix Net Worth Widget Miscalculation on Cross-Month Transfers

**Feature Branch**: `[001-net-worth-transfer-fix]`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Issue #12: [Bug]: Net worth widget incorrectly shows change when transferring between accounts. The net worth widget shows an incorrect gain/loss if a transfer between accounts occurs and the dates for each side of the transfer fall on different months. Reproduction: 1) Create a transfer between two accounts. 2) Give one side of the transfer a date of 7/31. 3) Give the other side a date of 8/1. 4) View the net worth graph and observe that the graph changed even though no change in net worth occurred."

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

### User Story 1 - Transfer split across month-end does not distort net worth trend (Priority: P1)

A user records a transfer between two of their own accounts where the outgoing side is dated on the last day of one month (e.g. 7/31) and the incoming side is dated on the first day of the next month (e.g. 8/1). When the user views the net worth graph/widget, the reported net worth and period-over-period change must reflect that no actual gain or loss occurred, regardless of which month each side of the transfer lands in.

**Why this priority**: This is the core defect reported in the bug: the net worth widget currently shows a false gain in one month and a false loss in the adjacent month for a transaction that has zero net effect on total balances. This misleads users about their real financial trend and is the entire reason the feature/fix is requested.

**Independent Test**: Can be fully tested by creating a transfer between two accounts with the outgoing leg dated 7/31 and the incoming leg dated 8/1, then viewing the net worth graph and confirming the total net worth line and the month-over-month change amounts are identical to what they would be if both legs were dated on the same day.

**Acceptance Scenarios**:

1. **Given** two accounts each included in net worth tracking with a combined starting balance of $0 change pending, **When** the user creates a transfer where the withdrawal is dated 7/31 and the deposit is dated 8/1, **Then** the net worth graph shows no change in total net worth attributable to the transfer on either 7/31 or 8/1.
2. **Given** the same cross-month transfer exists, **When** the user views the net worth widget's reported gain/loss for the month of July and for the month of August, **Then** neither month's reported gain/loss includes any amount from the transfer.
3. **Given** a transfer between two accounts where both legs fall within the same month, **When** the user views the net worth graph, **Then** the graph behavior is unchanged from current behavior (no regression for same-month transfers).
4. **Given** a transfer involves an account that is excluded from net worth tracking (e.g., an off-budget or closed account) [NEEDS CLARIFICATION: should the fix also correctly zero out the net-worth effect when one leg of the transfer is to/from an account excluded from net worth, or is that considered a legitimate net worth change and out of scope for this fix?], **When** the user views the net worth graph spanning the transfer's dates, **Then** the system behaves per the clarified rule.

---

### User Story 2 - Net worth graph reflects correct running balance at every date point (Priority: P2)

A user reviews the net worth graph over a date range that spans several cross-month transfers (not just one). The graph's day-by-day (or month-by-month) balance trend must remain accurate throughout, without accumulating drift from multiple mismatched-date transfers.

**Why this priority**: Confirms the fix generalizes beyond a single isolated transfer and holds up for realistic usage where users may have many such transfers over time (e.g., regularly moving money between checking and savings a day apart).

**Independent Test**: Can be fully tested by creating several transfers with intentionally mismatched dates across different month boundaries and verifying the net worth graph's cumulative total at the end of the reviewed period matches the sum of all account balances, with no intermediate spikes or dips caused by the transfers themselves.

**Acceptance Scenarios**:

1. **Given** multiple transfers exist with legs dated on different days (some crossing month boundaries, some not), **When** the user views the net worth graph for a range covering all of them, **Then** the ending total net worth equals the sum of the actual account balances and no intermediate data point shows a change caused solely by a transfer.

---

### User Story 3 - Historical/existing budgets are corrected without manual user action (Priority: P3)

A user who already has existing transfers with mismatched dates in their budget file (created before the fix) opens their budget after upgrading and sees the net worth graph display correctly, without needing to re-enter or edit any transactions.

**Why this priority**: Ensures the fix is a true bug fix (corrects the calculation) rather than only preventing the issue for newly created transfers going forward, which matters for users who already have affected data (as in the reporter's example budget).

**Independent Test**: Can be fully tested by importing an existing budget file containing a cross-month-dated transfer (such as the example budget attached to the bug report) and confirming the net worth graph shows correct values without any manual edits to the transactions.

**Acceptance Scenarios**:

1. **Given** a previously created budget file containing a transfer with mismatched transfer-leg dates across a month boundary, **When** the user opens that budget after the fix is applied, **Then** the net worth graph immediately displays the corrected trend without requiring the user to edit or re-save the affected transactions.

---

### Edge Cases

- What happens when both legs of a transfer fall in the same month but on different days (no month boundary crossed)? Behavior must remain correct (this already works today per the bug report, which is specific to month boundaries).
- What happens when a transfer's two legs are dated more than one month apart (e.g., one leg dated in January, the other in March)? The graph must not show a false gain/loss in any month between the two dates.
- What happens when a transfer occurs between an account tracked in net worth and one that is not (e.g., a tracking-only or off-budget account)? [NEEDS CLARIFICATION: see clarification marker in User Story 1, Acceptance Scenario 4]
- What happens when a transfer is edited after creation to change one leg's date across a month boundary (or back within the same month)? The net worth graph must recompute correctly to reflect the edit.
- What happens when a transfer is deleted? The net worth graph must no longer reflect any distortion that the transfer previously introduced.
- How does the system handle a net worth graph view whose date range starts or ends between the two mismatched transfer-leg dates (i.e., only one leg of the transfer falls within the viewed range)? [NEEDS CLARIFICATION: when only one leg of a transfer is within the visible reporting range, should the visible leg still be treated as having zero net-worth impact, or is it acceptable/expected for the visible portion to show a balance change since the offsetting leg is outside the viewed range?]

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: The net worth graph/widget MUST NOT show a net worth gain or loss that is attributable solely to a transfer between two accounts both included in net worth tracking, regardless of whether the transfer's two legs are dated in the same month or in different months.
- **FR-002**: The net worth graph/widget MUST report the same total net worth value at any given date as the sum of the actual balances of all accounts included in net worth tracking as of that date.
- **FR-003**: The system MUST correctly compute net worth trends for transfers whose two legs are dated on different days, including but not limited to cases where the legs fall on the last day of one month and the first day of the next month.
- **FR-004**: The system MUST apply the corrected calculation to existing (previously created) transfers automatically when the net worth graph is displayed, without requiring the user to edit, delete, or re-create any transactions.
- **FR-005**: The system MUST continue to correctly reflect genuine net worth changes (e.g., income, expenses, or transfers involving an account not tracked in net worth) alongside the corrected handling of same-tracking-status transfers.
- **FR-006**: The fix MUST NOT change the displayed net worth graph behavior for transfers whose two legs share the same date or fall within the same month (no regression for the currently-working case).

### Key Entities *(include if feature involves data)*

- **Transfer**: A pair of linked transactions representing money moving between two accounts, where each side (leg) has its own date, amount, and account, and the two legs together should represent zero net change to total net worth when both accounts are tracked in net worth.
- **Net Worth Data Point**: A calculated total balance (and period-over-period change) for a specific date or month, derived from the balances of all accounts included in net worth tracking, used to render the net worth graph/widget.
- **Account (net worth tracking status)**: An account that may be included in or excluded from net worth calculations, which determines whether a transfer touching it should net to zero or represent a real change.

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: 100% of transfers between two net-worth-tracked accounts show zero net worth impact on the net worth graph, regardless of the date difference between the transfer's two legs.
- **SC-002**: Users viewing the net worth graph over any date range see a total net worth at each point that exactly matches the sum of their actual account balances at that point in time, with zero discrepancy caused by transfer-leg date mismatches.
- **SC-003**: Users with pre-existing budgets containing mismatched-date transfers see the corrected net worth graph immediately upon opening their budget, with no manual data correction steps required.
- **SC-004**: The reported bug scenario (transfer legs dated 7/31 and 8/1) no longer produces any visible month-over-month gain or loss on the net worth graph attributable to the transfer.

## Assumptions

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right assumptions based on reasonable defaults
  chosen when the feature description did not specify certain details.
-->

- A "transfer" refers to two linked transactions in Actual Budget representing a movement of funds between two accounts owned by the user, as opposed to a transaction reflecting external income or expense.
- Existing correct behavior for same-date and same-month transfers must be preserved; this fix is scoped to date mismatches, particularly ones crossing a month boundary.
- The fix should apply automatically to previously recorded data purely through recalculation of the net worth graph, without requiring any migration step that rewrites transaction data.
- Transfers between two accounts that are both included in net worth tracking are the primary scope of this fix; behavior for transfers involving an account excluded from net worth tracking is addressed via the clarification markers above rather than assumed.
- This fix concerns the net worth graph/widget display and its underlying calculation logic; it does not require changes to how transfers are created, edited, or matched by the user.
