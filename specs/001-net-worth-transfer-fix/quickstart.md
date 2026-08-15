# Quickstart: Validating the Net Worth Cross-Month Transfer Fix

This guide describes how to validate the fix end-to-end, both via automated tests and by manually reproducing the original bug report (Issue #12).

## Prerequisites

- Repository dependencies installed (`yarn install` from repo root).
- Node.js >=22, Yarn ^4.9.1 (see root `AGENTS.md`).

## 1. Automated validation (unit tests)

The primary validation lives in the co-located test file for the modified module:

```bash
# Fast, targeted run of just the affected spreadsheet's tests
yarn workspace @actual-app/web run test net-worth-spreadsheet

# Or run the full suite for this workspace
yarn workspace @actual-app/web run test

# Or run everything across the monorepo (only if the targeted run above passes)
yarn test
```

Expected test scenarios (see `data-model.md` / `contracts/net-worth-spreadsheet-contract.md` for the exact fields involved), each mapping to a spec acceptance scenario or edge case:

1. **Cross-month transfer, both legs tracked** — transfer with leg dated 7/31 (-100) and leg dated 8/1 (+100), both accounts included in `accounts`. Assert the July and August `change` values contain no swing attributable to the transfer, and the end-of-range `y` equals the real summed balances (User Story 1, FR-001, FR-003, SC-004).
2. **Same-month transfer (regression guard)** — both legs dated within the same month. Assert output is numerically identical to pre-fix behavior (FR-006).
3. **One leg on an untracked account** — transfer between a tracked and an untracked (e.g. closed/off-budget, not present in `accounts`) account. Assert the tracked leg still shows as a real change (FR-007, Acceptance Scenario 4).
4. **Partial-range view** — request a range where only one leg's date is inside `[start, end]`. Assert no fabricated offset is added; the visible leg shows as a real change (FR-008).
5. **Fee/conversion pair** — legs with unequal absolute amounts (e.g., -100 and +98). Assert only 98 is neutralized and the 2-unit difference remains a genuine change (FR-009).
6. **Orphaned leg** — a transaction with a `transfer_id` whose pair is not present in the queried set (deleted/missing). Assert it is treated as an ordinary transaction with no adjustment (FR-011).
7. **Multiple mismatched transfers over a longer range (User Story 2)** — several transfers with varying date gaps across month boundaries. Assert the ending total matches the real sum of account balances with no intermediate transfer-caused spikes/dips.
8. **Manually entered unlinked matching pair (out of scope, FR-010)** — two ordinary transactions with equal-and-opposite amounts but no shared `transfer_id`. Assert they are **not** neutralized (i.e., they continue to show as two independent real changes), confirming the fix does not overreach.

## 2. Manual reproduction of the reported bug

1. Run the app locally: `yarn start` (web) and open the app in the browser, or `yarn start:desktop` for Electron. Use **"View demo"** on the initial setup screen for a pre-populated sample budget if a fresh budget is preferred, or use an existing budget with at least two net-worth-tracked accounts.
2. Create a transfer between two tracked accounts (Actual's built-in transfer entry, which auto-links both legs via `transfer_id`):
   - Leg 1: dated the last day of a month (e.g. `2026-07-31`).
   - Leg 2 (its auto-created transfer counterpart): edit its date to the first day of the next month (e.g. `2026-08-01`).
3. Navigate to the Net Worth report (or the Net Worth dashboard widget) and select a date range spanning both months.
4. **Before the fix**: the graph shows a visible dip in July and a rebound in August (or vice versa, depending on transfer direction) attributable solely to this transfer.
5. **After the fix**: the graph's month-over-month change for July and for August shows no amount attributable to this transfer; the total net worth line remains consistent with the real combined account balances throughout.
6. Repeat with an existing/previously created budget file (do not edit the transaction) to confirm the corrected graph appears immediately on load, without any manual edit (User Story 3, FR-004, SC-003).

## 3. Full quality gate before submitting

```bash
yarn typecheck
yarn lint:fix
yarn test
```

All three must pass (per root `AGENTS.md` code quality checklist) before the change is considered complete.
