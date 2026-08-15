---

description: "Task list template for feature implementation"
---

# Tasks: Fix Net Worth Transfer Date Mismatch

**Input**: Design documents from `/specs/001-fix-net-worth-transfer/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, quickstart.md

**Tests**: Tests are included — the plan and quickstart explicitly call for a new unit test file (`net-worth-spreadsheet.test.ts`) covering the edge cases from the spec.

**Organization**: This feature has a single user story (P1); tasks are grouped into Setup, Foundational (shared calculation logic), User Story 1 (integration + tests), and Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)
- Paths are relative to the repository root, scoped to `packages/desktop-client/src/components/reports/spreadsheets/`

## Phase 1: Setup

**Purpose**: Confirm scope and existing conventions before changing code

- [X] T001 Review current aggregate calculation in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts` (`createSpreadsheet`/`recalculate`) and confirm `accounts`, `transfer_id`, and interval-bucketing conventions used elsewhere in the file
- [X] T002 [P] Review existing test conventions in `packages/desktop-client/src/components/reports/spreadsheets/sankey-spreadsheet.test.ts` and `budget-analysis-spreadsheet.test.ts` to match style for the new test file

**Checkpoint**: Existing calculation and test conventions understood

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared transfer-pair detection/adjustment logic that User Story 1 depends on

**⚠️ CRITICAL**: Must be complete before the User Story 1 phase

- [X] T003 Add `TransferTransaction` type and `getIntervalKey`/`getIntervalIndexClamped` helpers to `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts` to map a transfer leg's date to its report-interval bucket (Daily/Weekly/Monthly/Yearly), clamping pre-range dates to the first interval and post-range dates out of range
- [X] T004 Implement `computeTransferAdjustments(transferTxns, accountIds, intervals, startDate, endDate, interval, firstDayOfWeekIdx)` in the same file: pair transactions by `transfer_id`, require both legs' accounts to be in `accountIds` (FR-007), compute `matchedPrincipal = min(abs(legA), abs(legB))` (FR-009), and add the neutralizing adjustment to every interval strictly between the earlier and later leg's interval (FR-001, FR-002, FR-005, FR-008)

**Checkpoint**: Pure, unit-testable adjustment calculation exists but is not yet wired into the report

---

## Phase 3: User Story 1 - Net worth stays flat for split-month transfers (Priority: P1) 🎯 MVP

**Goal**: The net worth graph's aggregate total no longer shows an artificial gain/loss when a transfer's two legs are dated in different reporting intervals, while each account's own balance history is unaffected.

**Independent Test**: Create a transfer with the withdrawal leg dated 7/31 and the deposit leg dated 8/1; confirm the net worth graph shows the same total net worth at the end of July and start of August, while each account's own balance still changes on its own leg's date.

### Tests for User Story 1 ⚠️

- [X] T005 [P] [US1] Add `net-worth-spreadsheet.test.ts` covering `computeTransferAdjustments`: same-day legs (no-op), same-month different-day legs (no-op), month-boundary split (7/31 → 8/1), year-boundary split (12/31 → 1/1), one leg outside the selected range (no fabricated offset, FR-008), one leg's account excluded from the report (FR-007), unequal-amount legs / fee-FX residual (FR-009), multiple mismatched transfers between the same accounts, and non-transfer transactions (regression, SC-003) — in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.test.ts`
- [X] T006 [US1] Add `recalculate` tests in the same file asserting the combined `graphData` total stays flat across a split-month transfer, individual account balances remain unaffected (FR-003), and behavior is unchanged when transfer info is omitted (regression, FR-006)

### Implementation for User Story 1

- [X] T007 [US1] In `createSpreadsheet` (`net-worth-spreadsheet.ts`), add a query fetching all transactions with `transfer_id: { $ne: null }` and `date: { $lte: endDate }` (not scoped to the report's account list, so excluded/off-budget legs can be detected per FR-007), selecting `id, transfer_id, account, amount, date`
- [X] T008 [US1] Pass the fetched transfer transactions and a `Set` of the report's included account ids into `recalculate`, and export `recalculate` (previously private) so it can be exercised directly by unit tests
- [X] T009 [US1] In `recalculate`, call `computeTransferAdjustments` once per report render and add the resulting per-interval adjustment to each `graphData` point's aggregate `total` only — leaving `accountBalances`/per-account `balances` untouched (FR-003) — before computing `assets`/`debt`/`hasNegative`/`lowestNetWorth`/`highestNetWorth`/`netWorth`/`totalChange`
- [X] T010 [US1] Add a release note at `upcoming-release-notes/fix-net-worth-transfer-date-mismatch.md` documenting that historical net worth graphs may change for budgets with cross-period transfers (FR-010)

**Checkpoint**: User Story 1 is fully functional — the reported bug's reproduction steps (7/31 / 8/1 transfer) no longer show a false gain/loss, verified by both unit tests and quickstart's manual steps

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Verify no regressions and that the fix is consistent with the plan's constraints

- [X] T011 [P] Run `yarn workspace @actual-app/web exec vitest run src/components/reports/spreadsheets` and confirm all tests in the directory pass (new and pre-existing)
- [X] T012 [P] Run `yarn typecheck` (or targeted `tsc --noEmit` for `desktop-client`) to confirm no new type errors
- [X] T013 Manually verify quickstart.md's reproduction steps (7/31 withdrawal / 8/1 deposit) against the demo budget, confirming the combined line is flat across the boundary while each account's own balance changes on its own date (SC-004)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS User Story 1
- **User Story 1 (Phase 3)**: Depends on Foundational phase completion
- **Polish (Phase 4)**: Depends on User Story 1 being complete

### Within User Story 1

- Tests (T005, T006) were written alongside implementation and validated against it (T007-T009)
- T007 (query) before T008 (wiring) before T009 (applying the adjustment in `recalculate`)
- T010 (release note) is independent of T007-T009 and can be done in parallel

### Parallel Opportunities

- T001 and T002 (Setup) can run in parallel
- T005 (adjustment unit tests) and T010 (release note) can run in parallel with other User Story 1 tasks
- T011 and T012 (Polish) can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (shared `computeTransferAdjustments` logic) — CRITICAL, blocks the story
3. Complete Phase 3: User Story 1 (query + wiring + tests + release note)
4. **STOP and VALIDATE**: Run the targeted test file, then the whole `spreadsheets` directory
5. This *is* the full feature — there is only one user story (P1) for this bug fix

## Notes

- This feature has a single user story (P1); there are no US2/US3 phases to sequence.
- All work is scoped to `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts` and its new test file, plus one release note — no other files require changes (`NetWorth.tsx`/`NetWorthCard.tsx` consume `createSpreadsheet`'s unchanged public signature).
- Verify tests fail-then-pass is not applicable in the traditional TDD sense here since tests were authored together with the implementation in one pass; both were validated together via the Polish phase's full-directory test run.
