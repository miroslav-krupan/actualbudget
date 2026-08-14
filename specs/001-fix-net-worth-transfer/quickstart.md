# Quickstart: Validating the Net Worth Transfer Fix

This guide describes how to run the automated checks and manually reproduce
and verify the fix for the reported bug (net worth graph shows a false
gain/loss when a transfer's two legs fall in different months).

## Prerequisites

- Node.js >= 22, Yarn ^4.9.1 (see root `AGENTS.md`)
- Dependencies installed: `yarn install` (run once from repo root)

## 1. Run the targeted unit tests

```bash
# From repo root
yarn workspace @actual-app/web run vitest run \
  src/components/reports/spreadsheets/net-worth-spreadsheet.test.ts
```

Expected outcome: all cases pass, including:

- Same-day transfer legs → no change in behavior (regression check, FR-006).
- Transfer legs split across a month boundary (7/31 and 8/1, matching the
  original bug report) → combined net worth is flat across the boundary
  (SC-004).
- Transfer legs split across a year boundary (12/31 and 1/1) → still flat.
- Transfer with one leg outside the selected report range → the visible leg
  shows a real change; no fabricated offset (FR-008).
- Transfer involving an excluded/off-budget account not in the report's
  `accounts` list → the included leg still shows a real change (FR-007).
- Transfer legs with unequal amounts (fee/FX delta) → only the matched
  principal is suppressed; the residual difference still shows (FR-009).
- Non-transfer transactions around the same dates → totals unchanged from
  current behavior (no regression, SC-003).

## 2. Run the full package test suite (regression safety net)

```bash
yarn workspace @actual-app/core run test
yarn test
```

## 3. Manual verification (matches the original issue's reproduction steps)

1. Start the app: `yarn start` (or use "View demo" for a pre-populated test
   budget, then add the accounts/transfer below).
2. Ensure at least two accounts exist (e.g. "Checking" and "Savings"), both
   included in reports (on-budget or otherwise included per your setup).
3. Create a transfer between the two accounts:
   - Withdrawal leg dated **7/31**.
   - Deposit leg dated **8/1**.
4. Open the Net Worth report/widget and view the graph across the July/August
   boundary.
5. **Expected (after fix)**: the combined net worth line is flat across the
   July→August boundary — no artificial dip/spike attributable to the
   transfer. Each account's own balance history still changes on its own
   leg's date when viewed individually (e.g. via the account register or
   per-account balance report).
6. **Before fix (for comparison)**: the combined line would show a temporary
   drop or rise at the boundary that disappears once both legs are in range.

## 4. Type checking and linting

```bash
yarn typecheck
yarn lint
```

## Notes

- This fix changes historical net worth graph values retroactively for any
  existing budget containing mismatched-date transfers (FR-010). No data
  migration or in-app notice is required — values simply recalculate next
  time the report is viewed. A release note documenting this is expected to
  accompany the change (see `/upcoming-release-notes/`).
- No new external API/contract is introduced by this fix, so there is no
  `contracts/` directory for this feature — see `plan.md` Project Structure.
