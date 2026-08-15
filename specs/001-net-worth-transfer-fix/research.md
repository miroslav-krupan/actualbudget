# Phase 0 Research: Net Worth Widget Cross-Month Transfer Fix

All business-rule ambiguities called out in the spec (`## Assumptions`, Edge Cases) were already resolved by BA sign-off in `clarifications-round-1.json` before this plan was written, so no `NEEDS CLARIFICATION` markers remain in the spec itself. The research below focuses on the *technical* unknowns needed to design the fix: how to detect a linked transfer pair from data the client already has, and where in the existing calculation to neutralize it without breaking the per-account balances the graph also reports.

## R1: Where does the false gain/loss actually originate?

**Decision**: The distortion is produced by `recalculate()` in `packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`. Each account's running balance is summed independently per interval (`accountBalances`), then the per-interval `total` is the sum across accounts at that interval index. Because a transfer's two legs are independent transactions with independent dates, if leg A (e.g. -$100, dated 7/31) falls in one interval and leg B (+$100, dated 8/1) falls in the next interval, the *combined* total genuinely drops by $100 for the interval containing only leg A and genuinely recovers for the interval containing leg B — the running total at every date is mathematically the true sum of the two accounts' recorded balances (satisfying FR-002 as currently written), but the `change` field (`total - last.y`) reports a transient gain/loss that has no counterpart in the user's real overall net worth, since the same $100 belongs to the user throughout.

**Rationale**: Confirmed by reading `recalculate()` line-by-line: `balance += account.balances[intervalItem].amount` per account, then `total += balance` per account inside the `graphData.reduce`. There is no existing transfer-awareness anywhere in this file or in `NetWorth.tsx`/`NetWorthCard.tsx`.

**Alternatives considered**: Fixing it in the AQL query layer (e.g., a `transfer_id`-aware SQL view) was considered but rejected — the distortion is inherently about *cross-account, cross-period* netting, which is a reporting-level concern, not a storage-level one, and keeping the fix client-side avoids touching the shared query engine used by many other reports.

## R2: How to detect which transactions are linked transfer pairs

**Decision**: Extend the per-account per-transaction query (or a supplementary query) to also select `transfer_id` per transaction row (already exposed on the `transactions` AQL table per `packages/loot-core/src/server/aql/schema/index.ts`), instead of only fetching pre-aggregated interval sums. Group transactions by `transfer_id` across the full set of accounts passed into `createSpreadsheet()` to reconstruct pairs: two transactions with the same non-null `transfer_id` are a linked transfer.

**Rationale**: `transfer_id` is already a first-class AQL field (`transfer_id: f('id')` in the schema, aliased as `transferred_id` on the transactions view), so no new backend/query-layer capability is required — only a change to what the existing `aqlQuery` calls select/group by. This directly satisfies FR-010 (only `transfer_id`-linked pairs are in scope) and FR-011 (an orphaned leg, i.e. a `transfer_id` whose matching leg does not appear in the queried set at all or refers to a deleted transaction, is naturally left ungrouped and therefore treated as a normal transaction).

**Alternatives considered**: Matching by amount/date heuristics (equal-and-opposite amounts within N days) was rejected — it cannot reliably distinguish real transfers from coincidental same-amount transactions and contradicts FR-010's explicit scope limitation to `transfer_id`-linked pairs.

## R3: How to neutralize a cross-period transfer without corrupting per-account balances

**Decision**: Keep each account's own running balance (`accountBalances`, and the per-account `balances[data[i].id]` values shown in tooltips/legend) computed exactly as today, using each leg's real date — these are the account-level truth and must not change (FR-005, "genuine net worth changes... alongside... same-tracking-status transfers"). Introduce a separate **transfer-adjustment** pass that only affects the *aggregate* `total`/`change`/`assets`/`debt` figures used for the graph: for each detected transfer pair where both legs' accounts are in the tracked `accounts` set passed to `createSpreadsheet()`, compute the matched (neutralizable) amount as `min(abs(leg1Amount), abs(leg2Amount))` (see R4) and, for any interval that falls strictly between the two legs' dates (exclusive of the interval containing the later leg, inclusive of the interval containing the earlier leg through the gap), add back the matched amount with the correct sign so the aggregate total/change no longer shows a transient move. Because both legs are within the queried accounts and range by construction, this does not fabricate a value from outside the viewed window (FR-008) — if only one leg is inside `[startDate, endDate]`, the pair is not treated as fully matched and no adjustment is applied, leaving the visible leg as a real change per FR-008.

**Rationale**: This isolates the "no false gain/loss" requirement (FR-001, FR-003, SC-001, SC-004) to the aggregate figures actually rendered as the graph's gain/loss, while leaving FR-002 (total equals real sum of balances) intact for the *end* of any range, and leaving FR-005/FR-007 (untracked-account legs, non-transfer transactions) completely unaffected since the adjustment pass only ever touches transactions identified as matched transfer pairs between two tracked accounts.

**Alternatives considered**:
- *Re-dating both legs to a single canonical date* (e.g., always attribute both legs to the earlier or later date) was rejected because it would change which interval each leg's amount is bucketed into for the *per-account* balances too (unless carefully isolated), risking violating FR-002 for intermediate dates and being harder to reason about than a separate adjustment pass.
- *Suppressing the transfer transactions entirely from the aggregate sum* was rejected because it would also remove them from the account-level running balance if not carefully scoped, and doesn't naturally generalize to partial/fee cases (R4).

## R4: Transfers with fees or currency conversion (unequal leg amounts)

**Decision**: When the two linked legs' absolute amounts differ (fee or conversion spread), only neutralize `min(abs(leg1Amount), abs(leg2Amount))` — the matched principal — in the aggregate adjustment from R3. The residual difference (`abs(leg1Amount) - abs(leg2Amount)`) is left fully visible in the aggregate total/change, exactly as it already is in the per-account balances.

**Rationale**: Directly implements FR-009 and the corresponding BA-confirmed assumption; guarantees the fix can never hide a real fee or exchange-rate cost.

**Alternatives considered**: Neutralizing the full larger-leg amount (over-correcting, would hide the fee) and neutralizing nothing when amounts differ even slightly (under-correcting, would leave the original bug for the common case of a small rounding/fee difference) were both rejected as contradicting FR-009.

## R5: Determining "net-worth-tracked" status for the two legs' accounts

**Decision**: An account counts as "tracked" for this fix if and only if it is present in the `accounts: AccountEntity[]` array already passed into `createSpreadsheet()` — i.e., the same account set the report is already summing into its total. If a transfer's other leg's account is not in that array (e.g., it was filtered out by the report's own account/offbudget selection), the pair is not neutralized and the leg belonging to the included account is shown as a genuine change (FR-007).

**Rationale**: `createSpreadsheet()` already receives exactly the caller-resolved (`NetWorth.tsx`/`NetWorthCard.tsx`) set of accounts that should count toward net worth; reusing this array avoids re-deriving "is this account tracked" logic and keeps the fix consistent with whatever account-inclusion rules the report already applies (offbudget/closed toggles, user-selected account filters, etc.).

**Alternatives considered**: Re-querying each account's `offbudget`/`closed` flags directly was rejected as redundant and riskier — it could disagree with the `accounts` array the caller already computed (e.g. if a report explicitly restricts to a subset of on-budget accounts), which would violate FR-007's "included in net worth tracking" framing (tracking status is about report inclusion, not just the raw account flag).

## Summary of resolved unknowns

| Area | Resolution |
|---|---|
| Root cause location | `recalculate()` in `net-worth-spreadsheet.ts` |
| Transfer-pair detection | Group same non-null `transfer_id` transactions across queried accounts |
| Neutralization scope | Separate aggregate-only adjustment pass; per-account balances untouched |
| Fee/conversion handling | Neutralize only `min(abs(leg1), abs(leg2))` |
| Tracked-account definition | Membership in the `accounts` array passed to `createSpreadsheet()` |
| Partial-range visibility | No adjustment when only one leg falls inside `[startDate, endDate]` |
| Orphaned/broken links | Naturally excluded — no matching `transfer_id` found in queried set |
