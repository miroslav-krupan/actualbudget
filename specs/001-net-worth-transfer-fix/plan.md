# Implementation Plan: Fix Net Worth Widget Miscalculation on Cross-Month Transfers

**Branch**: `001-net-worth-transfer-fix` | **Date**: 2026-08-15 | **Spec**: `specs/001-net-worth-transfer-fix/spec.md`

**Input**: Feature specification from `/specs/001-net-worth-transfer-fix/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

The net worth graph currently sums each account's running balance independently per interval and adds the results together. When a linked transfer's two legs are dated in different periods (e.g. 7/31 and 8/1), the outgoing leg reduces one period's total and the incoming leg restores it in the next period, producing a false dip/rebound in the reported gain/loss even though no real net worth change occurred. The fix detects linked transfer pairs (`transfer_id`) whose two legs both belong to net-worth-tracked accounts, and neutralizes their effect on the aggregate total/-change calculation in `net-worth-spreadsheet.ts` while leaving each account's own individual balance (and any transfer touching an untracked account) unaffected. The recalculation happens entirely client-side against existing data, so historical budgets are corrected automatically with no migration.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode for new code), React 18

**Primary Dependencies**: `date-fns` (date math), `@actual-app/core` AQL query layer (`q()`/`aqlQuery`), `es-toolkit` (`keyBy`), React (Vite-bundled `@actual-app/web` client)

**Storage**: SQLite (`v_transactions`/`transactions` AQL view) accessed via the existing AQL query engine; no schema migration — the fix is a pure read-time recalculation

**Testing**: Vitest (`*.test.ts`, co-located with source), run via `yarn workspace @actual-app/web run test` or `yarn test` (lage)

**Target Platform**: Web/Electron desktop client (`packages/desktop-client`), sharing calculation code with `@actual-app/core` where applicable

**Project Type**: Web application (existing monorepo: `desktop-client` UI + `loot-core`/`@actual-app/core` shared logic) — single-project structure, no new packages

**Performance Goals**: No perceptible regression to net worth graph render time; the added transfer-pairing lookup must stay O(n) over the transactions already fetched for the selected accounts/range (no additional network/DB round trips beyond what is already queried per account)

**Constraints**: Fix must operate purely by recalculating already-stored transaction data (FR-004); must not alter how transfers are created/edited/matched (spec Assumptions); must not suppress genuine fees/conversion differences (FR-009) or genuine changes from untracked-account legs (FR-007)

**Scale/Scope**: Per-budget transaction volumes typical of personal finance use (thousands to tens of thousands of transactions); net worth graph ranges from a single month up to all-time

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` in this repository is still the unfilled template (`[PROJECT_NAME] Constitution` with all placeholder tokens) — no ratified project-specific principles exist to gate against. This plan instead follows the repository's `AGENTS.md` / `CODE_REVIEW_GUIDELINES.md` conventions (functional TypeScript, no new `@ts-strict-ignore`, tests colocated with source, minimal mocking, `yarn typecheck`/`yarn lint`/`yarn test` as quality gates). No violations to record; **Complexity Tracking** is not needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-net-worth-transfer-fix/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── net-worth-spreadsheet-contract.md
├── checklists/
│   └── requirements.md
├── clarifications-round-1.json
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

Single project (existing monorepo). This fix touches the net worth reporting slice of the `desktop-client` package, with any shared date/transfer helpers placed in `loot-core`/`@actual-app/core` if reuse is warranted:

```text
packages/desktop-client/src/components/reports/
├── spreadsheets/
│   ├── net-worth-spreadsheet.ts          # Primary calculation: add transfer-pair detection
│   │                                       #   and neutralization to createSpreadsheet()/recalculate()
│   └── net-worth-spreadsheet.test.ts     # New/expanded unit tests (co-located, per convention)
├── reports/
│   ├── NetWorth.tsx                       # Full net worth report (consumes the spreadsheet)
│   └── NetWorthCard.tsx                   # Dashboard widget (consumes the spreadsheet)
└── graphs/
    └── NetWorthGraph.tsx                  # Renders graphData; no changes expected

packages/loot-core/src/server/aql/schema/index.ts   # Reference only: confirms `transfer_id`
                                                      #   is already queryable on `transactions`

upcoming-release-notes/
└── fix-net-worth-transfer-date-mismatch.md          # Release note for this bug fix
```

**Structure Decision**: No new packages, services, or directories are introduced. The fix is isolated to the existing net worth spreadsheet calculation module (`packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`) and its co-located test file, consumed unchanged by `NetWorth.tsx` and `NetWorthCard.tsx`. `transfer_id` is already exposed by the AQL schema, so no schema/query-layer changes are anticipated unless research determines additional per-transaction fields (account, date, amount, transfer_id) must be fetched instead of the current pre-aggregated per-interval sums.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — no constitution violations identified.

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/12
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-12-bug-net-worth-widget-incorrectly-shows-change-when
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-12-bug-net-worth-widget-incorrectly-shows-change-when/specs/001-net-worth-transfer-fix/spec.md
