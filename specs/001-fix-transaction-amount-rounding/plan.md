# Implementation Plan: Fix Transaction Amount Rounding (cent-short bug)


## Summary

`amountToInteger` in `packages/loot-core/src/shared/util.ts` currently does `Math.floor(amount * multiplier)`, which truncates toward negative infinity instead of rounding to the nearest cent, so floating-point artifacts (e.g. `19.99 * 100 === 1998.9999999999998`) cause affected amounts to be stored a cent short (19.99 → 1998 instead of 1999). The fix is to change the conversion to round to the nearest integer cent, with ties rounding half up (toward positive infinity) per the BA-confirmed rule, applied uniformly for both positive and negative amounts. Because `amountToInteger` is the single shared conversion function used by manual transaction entry, `amountToCurrencyInteger`, and `currencyToInteger` (which import parsing relies on), fixing it in one place covers both User Story 1 (manual entry) and User Story 2 (import) without touching call sites. No historical/existing transaction data is migrated or modified, per FR-007. Add unit tests covering the previously-failing case (19.99 → 1999), previously-correct cases (3.10, 5.55), and a half-cent tie case to lock in the round-half-up behavior for both positive and negative signs.

## Files to change

- `packages/loot-core/src/shared/util.ts` — update `amountToInteger` to round to the nearest cent using half-up rounding instead of `Math.floor`.
- `packages/loot-core/src/shared/util.test.ts` — add/extend test cases for `amountToInteger` covering the regression case, previously-correct cases, and half-up tie-breaking for positive and negative amounts.
- `upcoming-release-notes/` — add a new release note file for this bug fix, per repo convention.

## Implementation approach

- Replace `Math.floor(amount * multiplier)` with a half-up rounding implementation, e.g. `Math.floor(amount * multiplier + 0.5)` for non-negative amounts is not sufficient on its own for negative amounts under the "ties round toward positive infinity" rule described in the spec, so implement it as `Math.floor(amount * multiplier + 0.5)` applied directly to the signed value (this naturally rounds ties toward positive infinity for both positive and negative inputs, matching FR-006), or equivalently use a small epsilon-tolerant round such as `Math.round(amount * multiplier)` only if its native tie-breaking behavior is verified against the negative-amount case in the spec; prefer the explicit `Math.floor(x + 0.5)` form since its tie behavior is unambiguous and easy to test.
- Keep the function signature and default `decimalPlaces = 2` unchanged so all existing call sites (`amountToCurrencyInteger`, `currencyToInteger`, manual entry forms, import parsers) pick up the fix automatically with no other code changes.
- Do not add any migration or backfill logic for previously-saved incorrect amounts, per FR-007 and the spec's explicit assumption that historical data is left as-is.
- Do not change `integerToAmount` or any decimal-to-integer-cents-to-decimal round-trip logic beyond `amountToInteger`, since the spec scopes the defect to the amount → integer-cents direction only.

## Testing notes

- Add unit tests in `packages/loot-core/src/shared/util.test.ts` asserting `amountToInteger(19.99) === 1999` (the regression case from the issue) and that previously-correct values continue to work, e.g. `amountToInteger(3.10) === 310` and `amountToInteger(5.55) === 555`.
- Add a test for a value that is exactly on a half-cent boundary due to floating-point representation to confirm ties round up (toward positive infinity), and a corresponding negative-amount case to confirm the same rounding direction is used regardless of sign, per FR-006.
- Run `yarn workspace @actual-app/core run test util` (or the broader `yarn test` via lage) to confirm the new and existing tests pass.
- Manually verify via the running app (or existing e2e coverage, if any touches transaction entry) that entering 19.99 now displays and saves as 19.99, satisfying User Story 1's acceptance scenario; import-path verification (User Story 2) is covered indirectly since import parsing shares the same `amountToInteger`/`currencyToInteger` conversion path.

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/38
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-38-bug-some-transaction-amounts-are-saved-a-cent-shor
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-38-bug-some-transaction-amounts-are-saved-a-cent-shor/specs/001-fix-transaction-amount-rounding/spec.md
