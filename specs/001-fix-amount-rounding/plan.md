# Implementation Plan: Fix Cent-Short Amount Rounding


**Input**: Feature specification from `specs/001-fix-amount-rounding/spec.md`

## Summary

`amountToInteger` in `packages/loot-core/src/shared/util.ts` converts a decimal amount to integer smallest-currency-units by doing `Math.floor(amount * multiplier)`. Because floating-point multiplication (e.g. `19.99 * 100 = 1998.9999999999998`) can land just under the intended integer, flooring silently drops a cent for certain values, causing stored/displayed transaction amounts (and imports that reuse this function) to be a cent short. The fix is a small, self-contained change to the rounding strategy inside this single shared utility function: round to the nearest integer (ties round up, i.e. toward positive infinity) instead of flooring, so all callers (manual entry, import, budgeting, rules, etc.) automatically get the corrected behavior with no call-site changes needed. This is a pure logic fix plus new unit tests; no schema, migration, UI, or API surface changes are required.

## Technical Context

**Language/Version**: TypeScript (loot-core package, platform-agnostic shared util)

**Primary Dependencies**: None new — change is contained to existing `packages/loot-core/src/shared/util.ts`, no new libraries required

**Storage**: N/A — historical data is explicitly out of scope per spec Assumptions; only future conversions are affected

**Testing**: Vitest, via existing `packages/loot-core/src/shared/util.test.ts` (run with `yarn workspace @actual-app/core run test` or `yarn test`)

**Target Platform**: Cross-platform (loot-core runs in browser, Electron, and server/node contexts) since `amountToInteger` is a shared, platform-agnostic utility

**Project Type**: Single library fix within the existing monorepo (loot-core shared utilities) — no new project structure needed

**Performance Goals**: N/A — the change replaces one `Math.floor` call with an equivalent-cost rounding operation; no measurable performance impact

**Constraints**: Must preserve existing correct behavior for all previously-working values (e.g. 3.10, 5.55) and for negative amounts; must respect the function's existing `decimalPlaces` parameter (not hardcoded to 2) so non-2-decimal currencies/contexts are unaffected; halfway ties must round up (toward positive infinity) per spec Edge Cases/FR-006, for both positive and negative amounts

**Scale/Scope**: Single function, single file change plus new/updated unit tests; dozens of existing call sites across loot-core and desktop-client are unaffected in behavior other than receiving the corrected result

## Constitution Check

No `.specify/memory/constitution.md` gates apply beyond the repository's standard AGENTS.md conventions (TypeScript strictness for touched code, existing test patterns, no new dependencies). This is a minimal, surgical bugfix with no architectural, dependency, or structural implications, so there are no constitution violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-amount-rounding/
├── spec.md               # Feature specification (already finalized)
└── plan.md               # This file
```

No `research.md`, `data-model.md`, `quickstart.md`, or `contracts/` are produced for this feature — the change is a small, contained bugfix in one existing pure function with no new entities, external contracts, or open unknowns to research.

### Source Code (repository root)

```text
packages/loot-core/
└── src/
    └── shared/
        ├── util.ts        # amountToInteger — fix rounding logic here
        └── util.test.ts   # Add/extend unit tests for amountToInteger here
```

**Structure Decision**: Single project (existing loot-core package). The fix lives entirely inside `packages/loot-core/src/shared/util.ts`, which is imported by both server-side (`packages/loot-core/src/server/...`) and client-side (`packages/desktop-client/src/...`) code; because it is a single shared function, no other files need code changes. Only the corresponding test file `packages/loot-core/src/shared/util.test.ts` needs additions.

## Implementation Approach

1. **Locate and understand the current implementation**: `amountToInteger(amount, decimalPlaces = 2)` in `packages/loot-core/src/shared/util.ts` computes `multiplier = Math.pow(10, decimalPlaces)` and returns `Math.floor(amount * multiplier)`. Confirm all call sites (loot-core server/rules/budget code and desktop-client components) call through this single function so a local fix propagates everywhere without further changes.
2. **Fix the rounding logic**: Replace the flooring behavior with round-to-nearest-cent semantics that also satisfy the spec's tie-breaking rule (halfway values round up/toward positive infinity for both positive and negative amounts). A straightforward approach is `Math.round(amount * multiplier)` after mitigating floating-point drift (e.g. by rounding the raw product to a safe number of digits before the final round, or using an epsilon-correction such as `Math.round((amount * multiplier) + Number.EPSILON * sign-safe-adjustment)`), since `Math.round` already rounds halfway cases toward positive infinity in JavaScript, which matches the required tie-breaking rule directly. Verify the chosen formula still respects the `decimalPlaces` parameter for non-2-decimal cases.
3. **Guard against reintroducing float drift**: Since `amount * multiplier` itself can be imprecise (e.g. `19.99 * 100` = `1998.9999999999998`), ensure the correction happens before rounding (e.g. round the multiplication result to a fixed number of decimal digits, or use a small epsilon nudge) so `Math.round` sees a value close enough to `1999` to round correctly, without breaking already-correct values or introducing new off-by-one errors at other magnitudes.
4. **Add regression tests** in `packages/loot-core/src/shared/util.test.ts` covering: previously-affected values (19.99 → 1999, 9.99 → 999, 29.99 → 2999), previously-correct values that must remain unchanged (3.10 → 310, 5.55 → 555), negative equivalents of the above (e.g. -19.99 → -1999), an explicit halfway-tie case demonstrating round-up behavior, and a non-default `decimalPlaces` case (e.g. 0 or 3 decimal places) to confirm the parameter still works.
5. **Run the full loot-core test suite** to confirm no regressions in other tests that depend on `amountToInteger`, `amountToCurrencyInteger`, or related helpers (e.g. `packages/loot-core/src/server/transactions/import/parse-file.test.ts`, `packages/loot-core/src/server/budget/category-template-context.test.ts`).
6. **Manual/functional sanity check (optional but recommended)**: exercise the "View demo" budget flow, add a transaction of 19.99, and confirm it saves/displays as 19.99, matching spec User Story 1's acceptance scenario.
7. **Add a release note** under `upcoming-release-notes/` describing the user-facing fix in plain language, per repository convention.

## Testing Notes

- Primary coverage lives in `packages/loot-core/src/shared/util.test.ts`; add a dedicated `describe('amountToInteger', ...)` block (the file currently has no direct tests for this function) with cases for: exact previously-affected decimals, already-correct decimals, negative amounts, a halfway-tie value, and a non-default `decimalPlaces` argument.
- Run targeted tests with `yarn workspace @actual-app/core run test util.test` (or the package's vitest invocation) during development, then run `yarn test` from the repo root before finishing to confirm no other workspace's tests regress (particularly loot-core's import/parse and budget/category-template-context suites, which call `amountToInteger` indirectly).
- Confirm `yarn typecheck` still passes, since the function's signature is unchanged but its internal implementation is modified.
- No new mocks are needed — `amountToInteger` is a pure function, so tests should call it directly with real numeric inputs and assert exact integer outputs (per repository convention of minimizing mocking).

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/22
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-22-bug-some-transaction-amounts-are-saved-a-cent-shor
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-22-bug-some-transaction-amounts-are-saved-a-cent-shor/specs/001-fix-amount-rounding/spec.md
