# Implementation Plan: Fix Transaction Amount Rounding to Nearest Cent


## Summary

The root cause is `amountToInteger` in `packages/loot-core/src/shared/util.ts`, which converts a decimal amount to its integer cent representation using `Math.floor(amount * multiplier)`. Because `19.99 * 100` evaluates to `1998.9999999999998` in floating-point arithmetic, flooring truncates it down to `1998` instead of the correct `1999`. Since every other conversion helper in the codebase (currency parsing, imports, budgets, schedules, rules) funnels through this single function, fixing it in one place fixes all call sites at once. The fix replaces the floor with a round-to-nearest-cent operation that also handles negative amounts correctly (round half away from zero) and adds direct unit test coverage for the previously-uncovered function, including the specific regression case from the bug report and known-good cases that must continue to pass unchanged.

## Files to change

- `packages/loot-core/src/shared/util.ts` — fix `amountToInteger` to round to the nearest integer cent instead of flooring, with correct handling of negative amounts (round half away from zero) and the existing floating-point imprecision case (e.g. `19.99` → `1999`).
- `packages/loot-core/src/shared/util.test.ts` — add a new `describe('amountToInteger')` block (this file currently has no coverage for the function) with regression cases for previously-failing amounts (`19.99`), previously-passing amounts (`3.10`, `5.55`), negative amounts, and a halfway tie-break case, per FR-001 through FR-006.
- `upcoming-release-notes/` — add a short release note describing the bug fix (user-facing, no technical detail), following the existing template in `packages/docs/docs/contributing/index.md`.

## Implementation approach

Change `amountToInteger` from `Math.floor(amount * multiplier)` to a rounding-based calculation that first compensates for floating-point drift before rounding (e.g. rounding the product of `amount * multiplier` to a small number of extra decimal digits before applying `Math.round`, or equivalently using a small epsilon nudge in the direction of the amount's sign prior to rounding) so that values like `19.99 * 100 = 1998.9999999999998` round to `1999` rather than truncating to `1998`. `Math.round` alone is not sufficient for negative halfway cases because JavaScript's `Math.round` rounds `-0.5` toward positive infinity (e.g. `Math.round(-2.5) === -2`), which would violate the spec's "round half away from zero" tie-breaking rule (FR-006, Edge Cases); the implementation must therefore compute the sign separately, round the absolute value away from zero, and reapply the sign, or use an equivalent symmetric-rounding formula. No other call sites need to change since `amountToCurrencyInteger`, `currencyToInteger`, and all other conversions already delegate to `amountToInteger`; this satisfies FR-004 (consistent behavior across all entry points) without touching manual entry, import, or rule-action code directly. No changes to previously stored data are made, consistent with the spec's explicit out-of-scope note on historical migration.

## Testing notes

Add unit tests to `packages/loot-core/src/shared/util.test.ts` covering: the regression case `amountToInteger(19.99) === 1999` (previously produced `1998`); previously-correct cases `amountToInteger(3.10) === 310` and `amountToInteger(5.55) === 555` to confirm no regression; negative equivalents such as `amountToInteger(-19.99) === -1999`; a halfway tie-break case demonstrating round-half-away-from-zero for both positive and negative inputs; and at least one case with non-default `decimalPlaces` to confirm the fix generalizes beyond the two-decimal (cent) default. Run the targeted test file with `yarn workspace @actual-app/core run test util.test.ts` (or `yarn test` for the full suite) and `yarn typecheck` before considering the change complete, per FR-005 and SC-003.

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/27
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-27-bug-some-transaction-amounts-are-saved-a-cent-shor
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-27-bug-some-transaction-amounts-are-saved-a-cent-shor/specs/001-fix-amount-rounding/spec.md
