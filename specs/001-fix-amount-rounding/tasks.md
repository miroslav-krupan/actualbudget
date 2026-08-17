---

description: "Task list for Fix Transaction Amount Rounding to Nearest Cent"
---

# Tasks: Fix Transaction Amount Rounding to Nearest Cent

**Input**: Design documents from `/specs/001-fix-amount-rounding/`

**Prerequisites**: plan.md (required), spec.md (required for user stories)

**Tests**: Explicitly requested by the spec (FR-005) and plan.md — regression tests are included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: No new project scaffolding is required; this is a targeted bug fix in an existing package.

- [x] T001 Confirm current failing behavior by inspecting `amountToInteger` in `packages/loot-core/src/shared/util.ts` and noting the `Math.floor` truncation bug (no file changes yet).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No shared infrastructure changes are needed beyond the single conversion function; this phase is a no-op for this feature.

**Checkpoint**: Foundation ready - user story implementation can now begin.

---

## Phase 3: User Story 1 - Entered Amount Is Stored Exactly (Priority: P1) 🎯 MVP

**Goal**: Ensure amounts entered manually or imported are converted to integer cents by rounding to the nearest cent (round half away from zero), fixing floating-point truncation bugs like `19.99` → `1998`.

**Independent Test**: Call `amountToInteger(19.99)` and confirm it returns `1999` (not `1998`), while `amountToInteger(3.10)` and `amountToInteger(5.55)` continue to return `310` and `555` respectively.

### Tests for User Story 1 ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T002 [P] [US1] Add `describe('amountToInteger')` regression tests in `packages/loot-core/src/shared/util.test.ts` covering: previously-failing case `amountToInteger(19.99) === 1999`; previously-passing cases `amountToInteger(3.10) === 310` and `amountToInteger(5.55) === 555`; negative equivalents `amountToInteger(-19.99) === -1999`; a halfway tie-break case for both positive and negative inputs (round half away from zero); and a non-default `decimalPlaces` case.

### Implementation for User Story 1

- [x] T003 [US1] Fix `amountToInteger` in `packages/loot-core/src/shared/util.ts` to round to the nearest integer cent instead of flooring, compensating for floating-point drift and handling negative amounts correctly via round-half-away-from-zero (depends on T002 tests existing and failing first).
- [x] T004 [US1] Run `ENV=node yarn workspace @actual-app/core exec vitest run src/shared/util.test.ts` and confirm all tests pass, including the new `amountToInteger` suite and pre-existing tests in the same file.

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently — manual entry and import both route through the fixed `amountToInteger`.

---

## Phase 4: User Story 2 - Existing Balances Reflect Correct Historical Amounts (Priority: P2)

**Goal**: Confirm that once the fix lands, newly entered transactions (including previously-affected amounts) no longer drift balances short over time. No additional code changes beyond US1 are required since all entry points funnel through `amountToInteger`.

**Independent Test**: Enter a sequence of transactions including amounts like `19.99` and confirm the running balance equals the exact sum of entered amounts.

### Implementation for User Story 2

- [x] T005 [US2] Verify (via the same unit tests in T002/T004, no new source changes) that all callers of `amountToInteger` (`amountToCurrencyInteger`, `currencyToInteger`, etc.) inherit the corrected rounding automatically, satisfying FR-004 without additional call-site edits.

**Checkpoint**: Both user stories work independently; no migration of historical data is performed per spec's out-of-scope note.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Documentation and release communication.

- [x] T006 [P] Add a short, user-facing release note describing the bug fix in `upcoming-release-notes/` following the template in `packages/docs/docs/contributing/index.md`.
- [x] T007 Run `yarn typecheck` to confirm no type errors were introduced.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately.
- **Foundational (Phase 2)**: No-op for this feature.
- **User Story 1 (Phase 3)**: Depends on Phase 1. This is the MVP and the only code change required.
- **User Story 2 (Phase 4)**: Depends on Phase 3 completion (relies on the same fix); verification-only, no new code.
- **Polish (Phase 5)**: Depends on Phase 3 completion.

### Within User Story 1

- Tests (T002) MUST be written and FAIL before implementation (T003).
- T004 (verification) runs after T003.

### Parallel Opportunities

- T002 (tests) can be written in parallel with T001 (inspection), though logically written first per TDD.
- T006 (release note) can be done in parallel with T007 (typecheck) once T003 lands.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (inspection only).
2. Phase 2: Foundational is a no-op.
3. Complete Phase 3: User Story 1 — write failing tests, fix `amountToInteger`, verify tests pass.
4. **STOP and VALIDATE**: Confirm `amountToInteger(19.99) === 1999` and no regressions in existing amounts.
5. This is the complete, shippable fix.

### Incremental Delivery

1. Phase 3 (US1) ships the actual bug fix and is functionally complete on its own.
2. Phase 4 (US2) is a verification pass confirming the fix's downstream effect on balances — no additional code.
3. Phase 5 adds the release note and final typecheck before considering the change complete.

---

## Notes

- [P] tasks = different files or independent verification steps, no dependencies.
- [Story] label maps task to specific user story for traceability.
- Verify tests fail before implementing (T002 before T003).
- No changes to previously stored/historical data (explicitly out of scope per spec).
