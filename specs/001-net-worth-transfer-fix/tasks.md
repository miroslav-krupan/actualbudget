---

description: "Task list template for feature implementation"
---

# Tasks: Fix Net Worth Widget Miscalculation on Cross-Month Transfers

**Input**: Design documents from `/specs/001-net-worth-transfer-fix/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Test tasks are included — the plan and contract explicitly require unit tests co-located with `net-worth-spreadsheet.ts` covering the new transfer-pair detection/neutralization behavior.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Single project (existing monorepo). All changes are isolated to:
`packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`
and its co-located test file `net-worth-spreadsheet.test.ts`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm environment and baseline state before making changes

- [X] T001 Confirm `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts` and `packages/loot-core/src/server/aql/schema/index.ts` (`transfer_id` field) exist and match the plan/data-model assumptions (read-only verification, no file changes)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data-fetching and type changes that every user story's neutralization logic depends on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T002 Extend the per-account transaction query in `createSpreadsheet()` (`packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`) to additionally select `id`, `account`, `date`, `amount`, and `transfer_id` for each transaction in the queried range (supplementing, not replacing, the existing per-interval aggregate query), so transfer pairs can be reconstructed
- [X] T003 [P] Add the `TransferPair` internal type (`transferId`, `legA`, `legB?`, `bothLegsTracked`, `bothLegsInRange`, `matchedAmount`, `residualAmount`) to `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts` per `contracts/net-worth-spreadsheet-contract.md` and `data-model.md`
- [X] T004 Implement `findTransferPairs()` in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`: group the per-transaction rows from T002 across all queried accounts by non-null `transfer_id`, producing one `TransferPair` per group (legB left `undefined` when no matching row is found, satisfying FR-011 orphan handling)
- [X] T005 Implement `computeTransferAdjustments()` in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`: given the pairs from T004, the tracked `accounts` array, `[startDate, endDate]`, and the calculated `intervals`, return a signed adjustment-per-interval map that neutralizes only pairs where `bothLegsTracked` and `bothLegsInRange` are true, using `matchedAmount = min(abs(legA.amount), abs(legB.amount))` and leaving `residualAmount` unadjusted (FR-001, FR-003, FR-007, FR-008, FR-009)

**Checkpoint**: Foundation ready — `recalculate()` can now be wired to consume the adjustment map

---

## Phase 3: User Story 1 - Transfer split across month-end does not distort net worth trend (Priority: P1) 🎯 MVP

**Goal**: A transfer with legs dated 7/31 and 8/1 (or any month-boundary-crossing mismatch) produces zero net-worth swing on the graph, while same-month/same-date transfers and per-account balances are unaffected.

**Independent Test**: Create a transfer with legs dated 7/31 and 8/1 between two net-worth-tracked accounts; confirm the graph's total and month-over-month `change` show no gain/loss attributable to the transfer, and that a same-month transfer's behavior is byte-for-byte unchanged.

### Tests for User Story 1 ⚠️

- [X] T006 [P] [US1] Add unit tests in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.test.ts` for the reported bug scenario: a `transfer_id`-linked pair with legs dated 7/31 and 8/1 between two tracked accounts must produce zero `change` attributable to the transfer in both the July and August data points
- [X] T007 [P] [US1] Add a regression unit test in `net-worth-spreadsheet.test.ts` confirming a transfer whose two legs share the same date (or same month, non-boundary-crossing) produces numerically identical `graphData`/`netWorth`/`totalChange` output to the pre-fix behavior (FR-006)
- [X] T008 [P] [US1] Add a unit test in `net-worth-spreadsheet.test.ts` verifying per-account balances (`graphData.data[i][accountId]`) for a cross-month transfer are unchanged from computing each leg on its real date (FR-005)

### Implementation for User Story 1

- [X] T009 [US1] Wire `computeTransferAdjustments()` (T005) into `recalculate()` in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`: apply the signed per-interval adjustment to the aggregate `total` (and therefore `y`, `change`, `assets`, `debt`, `networth`) computed inside the `graphData.reduce`, without altering `accountBalances`/per-account tooltip values
- [X] T010 [US1] Verify `netWorth` (`endNetWorth`) and `totalChange` (`endNetWorth - startNetWorth`) at the top level of `recalculate()`'s return value remain internally consistent with the adjusted `graphData` (i.e., still derived from the adjusted final/first `y` values), satisfying FR-002

**Checkpoint**: At this point, User Story 1 (the core reported bug) is fully fixed and independently testable

---

## Phase 4: User Story 2 - Net worth graph reflects correct running balance at every date point (Priority: P2)

**Goal**: Multiple cross-month transfers (not just one) in the same viewed range do not accumulate drift; the ending total still equals the true sum of account balances.

**Independent Test**: Create several transfers with mismatched dates across different month boundaries and confirm the graph's ending total matches the sum of actual account balances, with no intermediate spike/dip caused solely by any of the transfers.

### Tests for User Story 2 ⚠️

- [X] T011 [P] [US2] Add a unit test in `net-worth-spreadsheet.test.ts` with multiple independent transfer pairs (different `transfer_id`s, different month-boundary offsets) between tracked accounts, asserting no intermediate data point shows a change caused solely by any transfer and the final point's `y` equals the true summed account balances

### Implementation for User Story 2

- [X] T012 [US2] Confirm/adjust `computeTransferAdjustments()` (T005) to correctly accumulate independent, non-overlapping adjustment windows from multiple pairs into the same per-interval map (additive, not overwriting) in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`

**Checkpoint**: User Stories 1 AND 2 both verified independently — single and multi-transfer scenarios both correct

---

## Phase 5: User Story 3 - Historical/existing budgets are corrected without manual user action (Priority: P3)

**Goal**: Pre-existing mismatched-date transfers already stored in a budget are corrected automatically the moment the net worth graph is (re)computed — no migration, no user edits.

**Independent Test**: Feed `recalculate()`/`createSpreadsheet()` a dataset resembling a pre-existing budget's stored transactions with a mismatched-date transfer already present, and confirm the corrected output with no data-shape changes or migration step involved.

### Tests for User Story 3 ⚠️

- [X] T013 [P] [US3] Add a unit test in `net-worth-spreadsheet.test.ts` simulating a "pre-existing" cross-month transfer (i.e., calling `recalculate()`/`createSpreadsheet()` fresh against already-stored-looking transaction data, with no special first-run/migration path) and asserting the corrected, non-distorted output is produced on this first calculation

### Implementation for User Story 3

- [X] T014 [US3] Confirm no persisted/cached state (e.g., memoized prior results) short-circuits recomputation in `createSpreadsheet()`/`recalculate()`, so the fix in T009 always applies fresh on every call — code-review/verification task, file-adjust only if a caching short-circuit is found in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`

**Checkpoint**: All three user stories independently functional — historical data is corrected automatically with zero migration

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases from spec.md, quality gates, and release documentation

- [X] T015 [P] Add unit tests in `net-worth-spreadsheet.test.ts` for the remaining spec edge cases not yet covered: (a) one leg belongs to an untracked/excluded account (FR-007, not neutralized), (b) only one leg falls within the viewed `[start, end]` range (FR-008, no fabricated offset), (c) unequal-amount legs from a fee/currency conversion (FR-009, only matched principal neutralized), (d) an orphaned leg whose `transfer_id` has no matching transaction in the queried set (FR-011, treated as normal)
- [X] T016 [P] Add a release note at `upcoming-release-notes/fix-net-worth-transfer-date-mismatch.md` per the repo's release-note template, describing the net worth graph fix in plain language
- [X] T017 Run `ENV=node yarn workspace @actual-app/web exec vitest run src/components/reports/spreadsheets` and iterate on `net-worth-spreadsheet.ts`/`net-worth-spreadsheet.test.ts` until every test in that directory passes
- [X] T018 Run `yarn typecheck` and `yarn lint:fix` and resolve any issues introduced by this feature's changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories (query/type/detection/adjustment plumbing must exist before any story's tests or wiring)
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - US1 (P1) must land first since US2/US3 build on and verify the same adjustment mechanism
  - US2 and US3 are additional test/verification passes over the same mechanism introduced in US1 and can proceed in either order once US1's wiring (T009) is done
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependency on other stories; this is the MVP
- **User Story 2 (P2)**: Depends on US1's wiring (T009) existing, since it verifies the same adjustment path under multiple pairs; otherwise independently testable
- **User Story 3 (P3)**: Depends on US1's wiring (T009) existing, since it verifies the same fix applies to "pre-existing" data with no special-casing; otherwise independently testable

### Within Each User Story

- Tests are written first (T006-T008, T011, T013) and should fail before the corresponding implementation task
- Foundational detection/adjustment helpers (T003-T005) before wiring (T009)
- Story complete before moving to next priority

### Parallel Opportunities

- T003 can run in parallel with T002 review (both edit the same file sequentially in practice, but are logically independent additions)
- T006, T007, T008 (US1 tests) can be written in parallel (same file, but non-overlapping test blocks — coordinate to avoid merge conflicts)
- T011 (US2) and T013 (US3) can be drafted in parallel once T009 lands
- T015, T016 (Polish) can run in parallel with each other

---

## Parallel Example: User Story 1

```bash
# Draft all three US1 tests together (same file, non-overlapping describe/it blocks):
Task: "Cross-month transfer (7/31 -> 8/1) produces zero change in net-worth-spreadsheet.test.ts"
Task: "Same-month/same-date transfer regression guard in net-worth-spreadsheet.test.ts"
Task: "Per-account balances unchanged for cross-month transfer in net-worth-spreadsheet.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Run the targeted vitest directory and confirm the 7/31 -> 8/1 scenario and same-month regression tests pass
5. This alone resolves the reported bug (Issue #12)

### Incremental Delivery

1. Complete Setup + Foundational → detection/adjustment plumbing ready
2. Add User Story 1 → validate independently → core bug fixed (MVP!)
3. Add User Story 2 → validate independently → multi-transfer drift confirmed absent
4. Add User Story 3 → validate independently → pre-existing data confirmed self-correcting
5. Polish → edge-case coverage, release note, full quality gate

## Notes

- [P] tasks = different files or non-overlapping additions, but most work here concentrates in one module by design (per plan.md's Structure Decision) — coordinate edits to `net-worth-spreadsheet.ts` sequentially even where marked [P]
- [Story] label maps task to specific user story for traceability
- Verify tests fail before implementing (T006-T008, T011, T013 before T009/T012)
- Do not run the full package suite for validation — target `src/components/reports/spreadsheets` per quickstart.md
