---

description: "Task list for Fix Transaction Amount Rounding (cent-short bug)"
---

# Tasks: Fix Transaction Amount Rounding (cent-short bug)

**Input**: Design documents from `/specs/001-fix-transaction-amount-rounding/`

**Prerequisites**: plan.md, spec.md

**Tests**: Explicitly requested by the spec (FR-005, User Story 3) — regression test coverage for `amountToInteger` is required.

**Organization**: Tasks are grouped by user story. Since all three user stories share the single `amountToInteger` fix, the core implementation task lives in the Foundational phase and each story's phase covers its own verification.

## Phase 1: Setup

- [X] T001 Confirm existing test conventions in `packages/loot-core/src/shared/util.test.ts` (imports, describe/it style) before adding new cases.

## Phase 2: Foundational (blocks all user stories)

- [X] T002 Update `amountToInteger` in `packages/loot-core/src/shared/util.ts` to round to the nearest integer cent using half-up rounding (ties toward positive infinity) instead of `Math.floor`, keeping the function signature and default `decimalPlaces = 2` unchanged.

**Checkpoint**: Core conversion fixed; all user stories can now be verified.

---

## Phase 3: User Story 1 - Enter an exact-decimal transaction amount and have it stored correctly (Priority: P1) 🎯 MVP

**Goal**: Manually entered amounts like 19.99 are stored/displayed without cent loss.

**Independent Test**: `amountToInteger(19.99)` returns `1999`; previously-correct amounts (3.10, 5.55) remain unchanged.

### Tests for User Story 1

- [X] T003 [P] [US1] Add regression test in `packages/loot-core/src/shared/util.test.ts` asserting `amountToInteger(19.99) === 1999`.
- [X] T004 [P] [US1] Add tests in `packages/loot-core/src/shared/util.test.ts` asserting previously-correct values still convert correctly, e.g. `amountToInteger(3.10) === 310` and `amountToInteger(5.55) === 555`.

**Checkpoint**: User Story 1 independently verified via unit tests against the fixed `amountToInteger`.

---

## Phase 4: User Story 2 - Import a file containing affected amounts and have totals stay accurate (Priority: P2)

**Goal**: Import paths (which reuse `currencyToInteger` → `amountToInteger`) also produce correct integer-cents values.

**Independent Test**: `currencyToInteger` (and thus import parsing) converts a source amount of 19.99 to 1999 cents, since it shares the fixed conversion function.

### Tests for User Story 2

- [X] T005 [US2] Add a test in `packages/loot-core/src/shared/util.test.ts` covering `currencyToInteger`/`amountToCurrencyInteger` for the 19.99 case to confirm the import-relevant wrappers pick up the fix automatically (depends on T002).

**Checkpoint**: Import-path conversion verified without needing to touch any import-parser code.

---

## Phase 5: User Story 3 - Regression protection for the amount conversion logic (Priority: P3)

**Goal**: Lock in round-half-up tie-breaking behavior for both positive and negative amounts so the defect cannot silently reappear.

**Independent Test**: Automated tests for half-cent tie cases (positive and negative) pass against the corrected implementation.

### Tests for User Story 3

- [X] T006 [P] [US3] Add a test in `packages/loot-core/src/shared/util.test.ts` for a value exactly on a half-cent boundary (e.g. `amountToInteger(0.025)`) confirming ties round up (toward positive infinity).
- [X] T007 [P] [US3] Add a corresponding negative-amount half-cent tie test in `packages/loot-core/src/shared/util.test.ts` (e.g. `amountToInteger(-0.025)`) confirming the same round-toward-positive-infinity rule applies regardless of sign, per FR-006.

**Checkpoint**: All user stories independently verified; defect has regression coverage.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T008 [P] Add a release note file in `upcoming-release-notes/` describing the fix, per repo convention.
- [X] T009 Run `ENV=node yarn workspace @actual-app/core exec vitest run src/shared/util.test.ts` (or the whole `src/shared` directory) to confirm all new and existing tests pass.

---

## Dependencies & Execution Order

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2, T002)**: Must complete before any test task (T003–T007) can pass.
- **User Story 1 (Phase 3)**: Depends on T002. No dependency on US2/US3.
- **User Story 2 (Phase 4)**: Depends on T002. Independent of US1/US3 (verifies a different wrapper function).
- **User Story 3 (Phase 5)**: Depends on T002. Independent of US1/US2 (verifies tie-breaking behavior).
- **Polish (Phase 6)**: Depends on all prior phases.

### Parallel Opportunities

- T003 and T004 can run in parallel (different assertions, same file, no shared state).
- T006 and T007 can run in parallel.
- T003, T004, T005, T006, T007 all touch the same test file, so when implemented by a single author they should be added together in one edit pass rather than truly concurrently; the [P] markers reflect logical independence, not required parallel authorship.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete T001–T002 (Setup + Foundational fix).
2. Complete T003–T004 (US1 tests).
3. **STOP and VALIDATE**: Run the util test suite; 19.99 and previously-correct cases pass.

### Incremental Delivery

1. Foundational fix (T002) unlocks all stories at once since they share one function.
2. Add US1 tests → validate → add US2 test → validate → add US3 tests → validate.
3. Finish with release note and full targeted test run (Phase 6).
