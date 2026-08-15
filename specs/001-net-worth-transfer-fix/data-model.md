# Phase 1 Data Model: Net Worth Widget Cross-Month Transfer Fix

This feature does not introduce new persisted entities or schema changes. It reasons about existing entities (transactions, accounts) as consumed by the net worth reporting calculation, plus one new in-memory/derived concept (the "transfer adjustment") introduced purely for the aggregate graph calculation.

## Existing Entities (read-only, unchanged shape)

### Transaction (as queried via AQL `transactions` table)

| Field | Type | Notes |
|---|---|---|
| `id` | string | Transaction id |
| `account` | string (account id) | Which account this leg belongs to |
| `date` | string (`YYYY-MM-DD`) | Leg's own date — the source of the bug when it differs from the other leg's date |
| `amount` | number (integer cents) | Signed amount; opposite sign pair for a transfer's two legs |
| `transfer_id` | string \| null | Present and non-null on both legs of a linked transfer feature transaction; `null`/absent for ordinary transactions (income, expenses, or an orphaned leg whose pair was deleted) |

Source: `packages/loot-core/src/server/aql/schema/index.ts` (`transactions.transfer_id: f('id')`, aliased `transferred_id`).

### Account

| Field | Type | Notes |
|---|---|---|
| `id` | string | Account id |
| `name` | string | Display name |
| (tracking status) | derived | An account is "tracked" for this fix purely by virtue of being present in the `accounts` array passed into `createSpreadsheet()` (see research.md R5) — no new field is added to the `AccountEntity` type |

## Derived Concepts (introduced by this fix, in-memory only)

### Transfer Pair

A **Transfer Pair** is reconstructed at calculation time, not stored:

| Field | Type | Description |
|---|---|---|
| `transferId` | string | The shared `transfer_id` linking both legs |
| `legA` | `{ account: string; date: string; amount: number }` | One leg (e.g., the outgoing/negative side) |
| `legB` | `{ account: string; date: string; amount: number } \| undefined` | The matching leg, if found within the queried transaction set; `undefined` denotes an orphaned leg (see FR-011) |
| `bothLegsTracked` | boolean | `true` only if both `legA.account` and `legB.account` are members of the `accounts` array passed to `createSpreadsheet()` (FR-007) |
| `bothLegsInRange` | boolean | `true` only if both `legA.date` and `legB.date` fall within `[startDate, endDate]` of the current view (FR-008) |
| `matchedAmount` | number | `min(abs(legA.amount), abs(legB.amount))` — the neutralizable principal (FR-009) |
| `residualAmount` | number | `abs(legA.amount) - abs(legB.amount)` (may be 0) — always left as a genuine change (FR-009) |

**Validity rules**:
- A Transfer Pair is only eligible for neutralization when `legB` is defined, `bothLegsTracked` is `true`, and `bothLegsInRange` is `true`. Otherwise it contributes to the aggregate exactly as an ordinary transaction would today (no adjustment applied) — this covers untracked-account legs (FR-007), partial-range views (FR-008), and orphaned/broken links (FR-011).
- A Transfer Pair with `legA.date === legB.date` (same date, including same-month, non-boundary-crossing cases) naturally produces a zero-width adjustment window, so behavior for already-correct same-date/same-month transfers is unchanged (FR-006) — this is a boundary condition of the same mechanism rather than a separate code path, but must be verified by tests.

### Net Worth Data Point (per interval, as returned by `recalculate()` — existing shape, values corrected)

| Field | Type | Description |
|---|---|---|
| `x` | string | Formatted interval label for the x-axis |
| `y` | number | Total net worth at this interval (aggregate across accounts, now transfer-pair-adjusted per matched pairs whose window covers this interval) |
| `assets` | string (formatted) | Sum of positive account balances |
| `debt` | string (formatted) | Sum of negative account balances (as a positive figure) |
| `change` | string (formatted) | `total - previous total` (or `total - priorPeriodNetWorth` for the first point) — no longer includes the transient swing from a matched, in-range, both-tracked transfer pair |
| `networth` | string (formatted) | Same value as `y`, formatted |
| `date` | string | Tooltip-formatted date |
| `[accountId]` | number | Per-account balance at this interval — **unchanged** by this fix; still reflects each leg on its real date |

## Relationships

```
Account (tracked, from `accounts` param)
   1..2 ── legs of ──▶ Transaction (has `transfer_id`)
Transaction ── paired via `transfer_id` ──▶ Transaction   (0 or 1 match)
Transfer Pair ── (if eligible) adjusts ──▶ Net Worth Data Point.y / .change
                                            (aggregate only; never Account-level balances)
```

## State Transitions

Not applicable — this fix is a pure (side-effect-free) recalculation over existing, already-persisted transaction data every time the net worth graph/widget is displayed (FR-004); there is no new stored state or migration, and editing/deleting a transfer leg simply changes the inputs to the next recalculation (spec Edge Cases: edited dates, deleted transfers).
