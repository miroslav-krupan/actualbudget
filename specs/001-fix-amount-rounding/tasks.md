---
description: "Task list for Fix Cent-Short Amount Rounding"
---

# Tasks: Fix Cent-Short Amount Rounding

**Input**: Design documents from `/specs/001-fix-amount-rounding/`

**Prerequisites**: plan.md, spec.md

**Tests**: Included — spec explicitly requires automated regression coverage (FR-005, User Story 3).

**Organization**: Tasks are grouped by user story. All three stories converge on the same single-function fix, so the phases share most of their work; each phase calls out its distinct verification focus.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single project (existing loot-core package):

- `packages/loot-core/src/shared/util.ts` — implementation
- `packages/loot-core/src/shared/util.test.ts` — tests
- `upcoming-release-notes/` — release note

---

## Phase 1: Setup

**Purpose**: Confirm current behavior and scope before changing code

- [X] T001 Read `amountToInteger` in `packages/loot-core/src/shared/util.ts` and confirm all call sites (`amountToCurrencyInteger`, `looselyParseAmount`, importers, rules) route through it, so no other file needs edits.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core fix that every user story's verification depends on

**⚠️ CRITICAL**: Must complete before any user-story test can pass

- [X] T002 Replace the `Math.floor(amount * multiplier)` body of `amountToInteger` in `packages/loot-core/src/shared/util.ts` with float-drift-safe round-to-nearest-integer logic that rounds halfway ties toward positive infinity for both positive and negative amounts, while still honoring the `decimalPlaces` parameter.

**Checkpoint**: Fix is in place — user story verification can now begin

---

## Phase 3: User Story 1 - Enter an exact transaction amount (Priority: P1) 🎯 MVP

**Goal**: Manually entered amounts (e.g. 19.99) are stored/displayed exactly as entered.

**Independent Test**: Call `amountToInteger(19.99)` and confirm it returns `1999`, not `1998`; also confirm `amountToInteger(3.10)` still returns `310`.

### Tests for User Story 1

- [X] T003 [P] [US1] Add `describe('amountToInteger', ...)` block in `packages/loot-core/src/shared/util.test.ts` with cases for previously-affected values (19.99 → 1999, 9.99 → 999, 29.99 → 2999) and previously-correct values that must remain unchanged (3.10 → 310, 5.55 → 555).

### Implementation for User Story 1

- [X] T004 [US1] Run `ENV=node yarn workspace @actual-app/core exec vitest run src/shared/util.test.ts` and adjust the rounding formula in `packages/loot-core/src/shared/util.ts` (from T002) until all US1 cases pass.

**Checkpoint**: User Story 1 acceptance scenarios pass independently

---

## Phase 4: User Story 2 - Import a file containing affected amounts (Priority: P1)

**Goal**: Imported amounts match their source value to the cent, since imports reuse the same shared conversion function.

**Independent Test**: Existing import/parse tests that exercise amount conversion (e.g. `packages/loot-core/src/server/transactions/import/parse-file.test.ts`) continue to pass, confirming the shared fix propagates to import without call-site changes.

### Tests for User Story 2

- [X] T005 [US2] Review `packages/loot-core/src/server/transactions/import/parse-file.test.ts` and any other import-path tests that assert on converted amounts; add/adjust a case with a previously-affected value (e.g. 19.99) if none exists.

### Implementation for User Story 2

- [X] T006 [US2] Run `ENV=node yarn workspace @actual-app/core exec vitest run src/server/transactions/import/parse-file.test.ts` to confirm import-path amounts are unaffected by/benefit from the shared fix.

**Checkpoint**: User Story 2 acceptance scenarios pass independently

---

## Phase 5: User Story 3 - Confidence via automated regression coverage (Priority: P2)

**Goal**: The conversion function has durable regression coverage, including sign and tie-breaking edge cases, so the defect cannot silently reappear.

**Independent Test**: Temporarily reverting `amountToInteger` to `Math.floor` causes at least one new test to fail.

### Tests for User Story 3

- [X] T007 [P] [US3] Extend the `amountToInteger` describe block in `packages/loot-core/src/shared/util.test.ts` with: a negative-amount case (e.g. -19.99 → -1999), an explicit halfway-tie case demonstrating round-up-toward-positive-infinity for both a positive and a negative value, and a non-default `decimalPlaces` case (e.g. 0 or 3 decimal places).
- [X] T008 [US3] Manually verify regression coverage by temporarily reverting the `amountToInteger` body to `Math.floor(amount * multiplier)` and confirming `vitest run` on `packages/loot-core/src/shared/util.test.ts` fails, then restore the fix.

**Checkpoint**: All user stories independently functional; defect class is regression-protected

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and documentation

- [X] T009 [P] Add a release note file under `upcoming-release-notes/` (e.g. `fix-amount-rounding.md`) describing the user-facing fix in plain language.
- [X] T010 Run `ENV=node yarn workspace @actual-app/core exec vitest run src/shared` (the whole directory containing the changed test file) and confirm every test passes.
- [X] T011 Run `yarn typecheck` from the repo root to confirm the unchanged function signature still type-checks cleanly.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (the fix itself).
- **User Stories (Phases 3-5)**: All depend on Phase 2 completion; US1 and US2 can verify in parallel once the fix lands; US3 extends the same test file as US1 so should follow it to avoid merge conflicts in `util.test.ts`.
- **Polish (Phase 6)**: Depends on all user stories being complete.

### Parallel Opportunities

- T003 (US1 tests) and T005 (US2 import test review) touch different files and can run in parallel.
- T007 (US3 additional test cases) extends the same file as T003, so should run after T003 lands to avoid conflicting edits to `util.test.ts`.
- T009 (release note) is independent of all test/code tasks and can run in parallel with Phase 3-5.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (the actual fix)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: `amountToInteger(19.99) === 1999` and `amountToInteger(3.10) === 310`

### Incremental Delivery

1. Setup + Foundational → fix in place
2. User Story 1 → manual-entry correctness verified
3. User Story 2 → import-path correctness verified (no code changes needed, same function)
4. User Story 3 → durable regression coverage (sign + tie-breaking + decimalPlaces) added
5. Polish → release note, full directory test run, typecheck
