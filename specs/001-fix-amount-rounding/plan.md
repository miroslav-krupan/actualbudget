# Implementation Plan: Fix Transaction Amounts Rounding a Cent Short


## Summary

`amountToInteger` in `packages/loot-core/src/shared/util.ts` converts a currency amount to integer cents by flooring `amount * multiplier`, which drops a cent for values like 19.99 because `19.99 * 100` evaluates to `1998.9999999999998` in floating point; flooring that yields 1998 instead of 1999. The fix is to round to the nearest cent instead of flooring, using a rounding strategy that also correctly handles exact/near-halfway values (round half up in magnitude, symmetric for negative amounts per FR-006/FR-007) and does not change already-correct conversions (e.g., 3.10, 5.55). Since manual entry and file import both funnel through this same conversion function, fixing it here fixes both flows (FR-004) without touching any UI, import-specific code, or previously-saved data (FR-008).

## Files to change

- `packages/loot-core/src/shared/util.ts` — update `amountToInteger` to round to the nearest cent instead of flooring, with half-up rounding on the magnitude so negative amounts behave symmetrically.
- `packages/loot-core/src/shared/util.test.ts` — add regression tests for `amountToInteger` covering the previously-affected value (19.99 → 1999), previously-unaffected values (3.10 → 310, 5.55 → 555), a negative affected value (-19.99 → -1999), and a halfway case rounded half up.
- `upcoming-release-notes/fix-amount-rounding.md` — new release note describing the bug fix for users, per repo convention.

## Implementation approach

Replace the `Math.floor(amount * multiplier)` body of `amountToInteger` with a rounding implementation that avoids floating-point truncation error, e.g. round the absolute value with `Math.round` (which rounds half away from zero for positive inputs) and reapply the original sign, such as `const sign = amount < 0 ? -1 : 1; return sign * Math.round(Math.abs(amount) * multiplier);` — this fixes the 19.99 case because `Math.round(1998.9999999999998)` correctly yields 1999, keeps already-correct values unchanged since they were already at or very near an integer cent boundary, and satisfies the half-up-in-magnitude requirement for exact halfway values (FR-007) while remaining symmetric for negative amounts (FR-006). No other call sites need to change since `amountToInteger` is the single shared conversion point used by both manual entry and import paths; no data migration is needed or wanted per FR-008.

## Testing notes

Add unit tests to the existing `packages/loot-core/src/shared/util.test.ts` suite (Vitest) asserting `amountToInteger(19.99)` returns `1999`, `amountToInteger(-19.99)` returns `-1999`, `amountToInteger(3.10)` returns `310`, `amountToInteger(5.55)` returns `555`, and a halfway case (e.g. `amountToInteger(0.005)`) rounds up in magnitude to `1`. Run `yarn workspace @actual-app/core run test util.test.ts` (or `yarn test` from root) to confirm the new tests fail against the old flooring implementation and pass after the fix, then run `yarn typecheck` since `util.ts` is a shared, type-strict module.

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/32
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-32-bug-some-transaction-amounts-are-saved-a-cent-shor
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-32-bug-some-transaction-amounts-are-saved-a-cent-shor/specs/001-fix-amount-rounding/spec.md
