# Contract: Net Worth Spreadsheet Calculation

This project has no external HTTP/API surface for this feature. The "contract" here is the **internal module interface** between the net worth spreadsheet calculation and its callers (`NetWorth.tsx`, `NetWorthCard.tsx`), which must remain stable so no consuming component needs to change.

Module: `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`

## `createSpreadsheet(...)` — unchanged public signature

```ts
function createSpreadsheet(
  start: string,
  end: string,
  accounts: AccountEntity[],
  conditions?: RuleConditionEntity[],
  conditionsOp?: 'and' | 'or',
  locale: Locale,
  interval?: string,
  firstDayOfWeekIdx?: string,
  format: (value: unknown, type?: FormatType) => string,
): (spreadsheet, setData) => Promise<void>
```

**Contract guarantees (post-fix)**:

1. **Signature stability** — no new required parameters; existing callers (`NetWorth.tsx`, `NetWorthCard.tsx`) require no changes. `accounts` continues to be the authoritative "net-worth-tracked accounts" set (see data-model.md, Account).
2. **Output shape stability** — the object passed to `setData` keeps its existing shape: `{ graphData: { data, hasNegative, start, end }, netWorth, totalChange, lowestNetWorth, highestNetWorth, accounts }`. Each `graphData.data[i]` keeps all existing fields (`x, y, assets, debt, change, networth, date, [accountId]: number`).
3. **New internal behavior, no new output fields**:
   - `graphData.data[i].y` / `.change` / `.assets` / `.debt` for any interval affected by an in-range, both-tracked transfer pair no longer include the transient swing caused by the pair's two legs landing in different intervals (FR-001, FR-003).
   - `graphData.data[i][accountId]` (per-account balance) values are **byte-for-byte unchanged** versus current behavior — computed from each leg's real date exactly as today (FR-005).
   - When `start`/`end` (the viewed range) contains only one leg of a transfer pair, no adjustment is applied for that pair; the visible leg's real amount is reflected as before (FR-008).
   - When a transfer pair's two legs are equal in absolute amount but one or both accounts are not present in `accounts`, no adjustment is applied (FR-007).
   - When a transfer pair's two legs differ in absolute amount (fee/conversion), only the smaller (matched) magnitude is neutralized; the difference remains part of `y`/`change` (FR-009).
   - Orphaned legs (no matching `transfer_id` transaction present, or a `transfer_id` referencing a transaction no longer present) are treated exactly like ordinary non-transfer transactions — no special-casing, no adjustment applied (FR-011).
   - Same-date and same-month transfer pairs (no month boundary crossed, or literally the same date) produce a zero-width adjustment and are therefore numerically identical to current output (FR-006, regression guard).

## Internal helper contract (new, private to this module unless reuse emerges)

Introduced for R2/R3/R4 in `research.md`. Exact naming is an implementation detail for `/speckit-tasks`, but the calculation must expose (at minimum, as internal functions covered by unit tests) behavior equivalent to:

```ts
type TransferPair = {
  transferId: string;
  legA: { account: string; date: string; amount: number };
  legB?: { account: string; date: string; amount: number };
};

// Given the transactions already being queried per account (extended to also
// select `transfer_id`), reconstruct pairs by shared, non-null transfer_id.
function findTransferPairs(perAccountTransactions: ...): TransferPair[];

// Given the tracked `accounts` set and the current [startDate, endDate] view,
// compute per-interval aggregate adjustments (added to `total`/`change`/etc.)
// so that fully in-range, both-tracked pairs no longer produce a transient
// swing between the interval containing the earlier leg and the interval
// containing the later leg. Untracked-account or partial-range pairs yield a
// zero adjustment. Unequal-amount pairs neutralize only the matched
// (smaller-magnitude) principal.
function computeTransferAdjustments(
  pairs: TransferPair[],
  accounts: AccountEntity[],
  startDate: string,
  endDate: string,
  intervals: string[],
): Record<string /* interval */, number /* signed adjustment */>;
```

These are internal contracts to guide task breakdown and unit testing; they are not exported from the package and carry no external compatibility guarantee beyond this feature's own tests.

## Non-goals / explicitly out of contract scope

- No AQL schema changes — `transfer_id` is already queryable.
- No changes to transfer creation/edit/matching behavior (spec Assumptions).
- No new IPC/API endpoints between `desktop-client` and `loot-core`/server.
- No data migration or rewrite of stored transactions (FR-004).
