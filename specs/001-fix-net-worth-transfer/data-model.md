# Data Model: Fix Net Worth Transfer Date Mismatch

This feature does not introduce new persisted entities or schema changes. It
adjusts an in-memory calculation over existing entities. The relevant
existing entities and the new derived/computed concept are documented below.

## Existing Entities (unchanged)

### Transaction

Source: `packages/loot-core/src/types/models/transaction.ts`,
AQL schema `packages/loot-core/src/server/aql/schema/index.ts`.

Relevant fields used by this fix (no new fields added):

| Field | Type | Notes |
|---|---|---|
| `id` | string | Transaction identifier |
| `account` | string (account id) | Owning account |
| `amount` | integer (cents) | Signed amount; negative = money leaving the account |
| `date` | string (`YYYY-MM-DD`) | Transaction's own recorded date — never modified by this fix |
| `transfer_id` | string (transaction id), optional | Links a transfer's two legs to each other |
| `payee.transfer_acct` | string (account id), optional | Present when the transaction's payee represents a transfer to/from another account; used by existing reports (e.g. cash flow) to detect transfers |

### Account

Source: `packages/loot-core/src/types/models/account.ts` (via `AccountEntity`).

Relevant fields: `id`, `name`, `offbudget`/inclusion flags — governs whether
an account is part of the `accounts` list passed into
`createSpreadsheet(start, end, accounts, ...)`. This fix does not change
account inclusion/exclusion logic; it only respects the `accounts` list it is
given (FR-007).

## Derived Concept (new, in-memory only): Transfer Pair Neutrality Adjustment

Not persisted — computed each time the net worth spreadsheet recalculates.

| Concept | Description |
|---|---|
| **Transfer Pair** | Two transactions sharing a `transfer_id` link (or one leg's `payee.transfer_acct` pointing at the other leg's account), each on its own account and date. |
| **Matched Principal** | `min(abs(legA.amount), abs(legB.amount))` — the amount common to both legs; this portion is treated as net-worth-neutral "in transit". |
| **Residual Delta** | `abs(legA.amount) - abs(legB.amount)` (if non-zero) — a fee/FX conversion difference; NOT neutralized, still shown as a real change (FR-009). |
| **In-Transit Interval** | The set of report intervals strictly between `min(legA.date, legB.date)` (exclusive of the interval containing the earlier date's *own* posting, i.e. from the interval immediately after the earlier leg through the interval containing the later leg) during which the combined/aggregate total would otherwise show a one-sided bump. |
| **Eligibility** | A Transfer Pair only produces an adjustment when both legs' accounts are present in the `accounts` array passed to `createSpreadsheet` for the current report (i.e. both included per existing rules) AND both legs are captured by the query (either inside `[startDate, endDate]` or folded into the pre-range `starting` balance). Otherwise no adjustment is made for the visible leg (FR-007, FR-008). |

### Validation / Invariants

- The adjustment must sum to zero across the full report range for any fully
  in-scope, in-range transfer pair (net worth at `endDate` is unaffected by
  whether legs are dated the same day or different periods) — this is the
  core invariant behind FR-001/FR-006/SC-001/SC-003.
- Per-account balances (`accountBalances` in
  `net-worth-spreadsheet.ts`) are never adjusted — only the aggregated
  `total`/`graphData` values are (FR-003).
- When both legs share the same date/interval, the In-Transit Interval is
  empty and the adjustment is a no-op (FR-006 — no regression for the common
  case).
- When a transfer pair's legs are not equal in magnitude, only the Matched
  Principal is neutralized; the Residual Delta continues to affect the total
  normally (FR-009).

## State Transitions

None — this is a stateless, pure recalculation over existing stored
transaction data each time the report renders (Assumptions: fix applies
retroactively without a data migration).
