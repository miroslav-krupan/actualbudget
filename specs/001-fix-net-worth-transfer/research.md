# Research: Fix Net Worth Transfer Date Mismatch

## Context

The net worth report/widget sums each included account's running balance at
every graph interval. When a linked transfer's two legs (withdrawal + deposit)
land in different reporting intervals (e.g. different months), one leg's
balance change is visible before the other leg's offsetting change, producing
a temporary artificial gain or loss in the combined total even though no real
change in wealth occurred. This research resolves the unknowns needed before
design.

## Decision 1: Where to detect and neutralize transfers

- **Decision**: Detect transfers using the existing linked-transaction
  mechanism (`transactions.transfer_id` / `payee.transfer_acct`), and
  neutralize the *aggregate* net worth calculation in
  `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`
  (the `createSpreadsheet`/`recalculate` functions), not in the underlying
  AQL/query layer or in per-account balance calculations.
- **Rationale**: The bug is specific to the *combined total* line on the net
  worth graph. Per-account balances are explicitly required (FR-003) to keep
  reflecting each leg's own date, so the fix must not touch account-level
  balance queries. `transfer_id` (schema: `packages/loot-core/src/server/aql/schema/index.ts`)
  is the existing, already-computed link between the two transactions of a
  transfer and is the simplest way to identify matched pairs without adding
  new stored fields. The existing cash-flow spreadsheet already uses
  `payee.transfer_acct` to exclude transfers from income/expense sums,
  establishing precedent for filtering transfers at the report/spreadsheet
  layer rather than in shared balance-calculation code.
- **Alternatives considered**:
  - *Modify the shared balance/query layer so every consumer excludes
    transfers automatically* — rejected because other report types (e.g.
    per-account balance history) must continue to include each leg on its own
    date (FR-003); a shared change risks unintended regressions across
    reports/widgets that were not in scope.
  - *Store a precomputed "in-transit" adjustment on transactions at write
    time* — rejected as unnecessary schema/migration complexity when the
    existing `transfer_id` link and a per-report calculation adjustment are
    sufficient, and the fix must apply retroactively to existing data with no
    migration (per Assumptions).

## Decision 2: How to make the aggregate total "net-neutral in transit"

- **Decision**: For each linked transfer pair where both legs' accounts are
  included in the current report (respecting existing inclusion/exclusion
  rules), compute the matched (lesser-magnitude) transferred amount and add an
  offsetting adjustment to the *combined* total for the interval(s) strictly
  between the earlier leg's date and the later leg's date — cancelling out the
  one-sided balance bump that would otherwise appear before the offsetting
  leg posts. Any residual difference between the two legs (fee/FX delta) is
  left untouched and still flows through as a real change (FR-009).
- **Rationale**: This directly implements FR-001/FR-002: the graph must never
  show a temporary swing over the "in transit" interval between the two dated
  legs, while every value outside that window (before the first leg, after
  the last leg, or for same-day transfers where the window is empty) is
  unaffected — satisfying the no-regression requirements (FR-006, SC-003).
- **Alternatives considered**:
  - *Re-date the transfer's earlier leg to match the later leg's date for
    net-worth purposes* — rejected: this would distort the per-account
    balance history for the account whose date got shifted, or require a
    separate "net worth only" transaction date, adding complexity to satisfy
    a requirement (FR-003) that is easier to satisfy by leaving both legs
    alone and only adjusting the combined total.
  - *Only adjust the interval boundary point (start/end of the affected
    period) instead of every intermediate interval* — considered but the
    "different years" and "custom range" edge cases (multi-month/interval
    gaps) require the offset to hold across every intermediate interval, not
    just the two adjacent ones, so the general "in transit for the whole
    span" model was chosen (FR-005).

## Decision 3: Respecting range/window and inclusion-rule boundaries

- **Decision**: The transfer-neutrality adjustment only applies when the AQL
  query used to fetch balances would have returned data for *both* legs (i.e.
  both accounts are in the `accounts` list passed to `createSpreadsheet`, and
  both legs' dates would be considered "known" — either inside the selected
  range or accounted for via the existing "starting balance" pre-range sum).
  If a leg's account is excluded from the report, or a leg falls entirely
  outside the selected date range boundary in a way the existing starting-
  balance/pre-range aggregation does not capture, no offset is fabricated for
  the leg that IS visible/included (FR-007, FR-008).
- **Rationale**: This matches the spec's explicit resolution for these edge
  cases: neutrality only applies when both legs are actually tracked by the
  report. The existing `starting` balance (pre-range sum via
  `date: { $lt: startDate }`) already correctly folds in any leg dated before
  the visible window, so a transfer where one leg is before `startDate` and
  the other is inside the window is naturally "already netted" once both legs
  are captured by either the starting sum or the interval balances — no
  special extra-range query is needed.
- **Alternatives considered**:
  - *Always fetch transfer legs regardless of report account list/date
    range* — rejected; would contradict FR-007/FR-008's explicit "no
    fabricated offset for out-of-scope legs" requirement.

## Decision 4: Testing approach

- **Decision**: Add a unit test file
  `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.test.ts`
  following the existing pattern used by sibling spreadsheet tests (e.g.
  `sankey-spreadsheet.test.ts`, `budget-analysis-spreadsheet.test.ts`), mocking
  `send`/`aqlQuery` to simulate transfer and non-transfer transactions across
  interval boundaries (same day, cross-month, cross-year, partially out of
  range, excluded account, fee/FX residual) and asserting on the resulting
  `graphData`/`netWorth`/`totalChange` values.
- **Rationale**: Matches project convention (Vitest, minimal mocking of only
  the network/query boundary) and gives fast, deterministic coverage of all
  edge cases called out in the spec without needing a full app/e2e harness.
- **Alternatives considered**:
  - *E2E/Playwright test only* — rejected as the primary test; too slow/broad
    for verifying numeric edge cases, though a manual e2e smoke check (see
    quickstart.md) is still useful to validate the real reproduction steps
    from the issue.

## Resolved Technical Context

All "NEEDS CLARIFICATION" items are resolved by the existing project
conventions (see plan.md Technical Context): this is a TypeScript/React web
app fix confined to `packages/desktop-client` (report calculation) with
Vitest for unit tests, no new dependencies, no storage schema changes, and no
new external interface/contract.
