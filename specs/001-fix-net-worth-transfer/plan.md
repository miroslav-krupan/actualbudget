# Implementation Plan: Fix Net Worth Transfer Date Mismatch

**Branch**: `001-fix-net-worth-transfer` | **Date**: 2026-08-14 | **Spec**: specs/001-fix-net-worth-transfer/spec.md

**Input**: Feature specification from `/specs/001-fix-net-worth-transfer/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

The Net Worth report/widget currently sums each included account's running
balance independently at every graph interval. When a linked transfer's two
legs are dated in different reporting intervals (e.g. withdrawal on 7/31,
deposit on 8/1), the combined total temporarily shows an artificial gain or
loss during the "in transit" span between the two dates, even though no real
change in net worth occurred. The fix detects linked transfer pairs (via the
existing `transfer_id`/`payee.transfer_acct` link) inside
`packages/desktop-client/src/components/reports/spreadsheets/net-worth-spreadsheet.ts`
and neutralizes the matched/transferred principal from the *aggregate* total
for the interval(s) between the two legs' dates, while leaving each
individual account's own balance history untouched. The adjustment only
applies when both legs' accounts are included in the current report and both
legs are captured by the query (in-range or in the pre-range starting
balance); any residual fee/FX difference between unequal legs still shows as
a real change.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 18, targeting the existing `@actual-app/web` (desktop-client) workspace

**Primary Dependencies**: Existing project stack only — `date-fns`, `es-toolkit`, the internal AQL query layer (`@actual-app/core/shared/query`), `@actual-app/core/shared/months`; no new dependencies added

**Storage**: SQLite (via `better-sqlite3`) through the existing AQL/query layer; no schema changes or migrations — the fix is a pure in-memory recalculation over existing `transactions` data (uses the existing `transfer_id` field)

**Testing**: Vitest (`yarn workspace @actual-app/web run vitest`), following the existing spreadsheet test pattern (e.g. `sankey-spreadsheet.test.ts`, `budget-analysis-spreadsheet.test.ts`)

**Target Platform**: Web/desktop client (Electron + browser), same as the existing Net Worth report/widget

**Project Type**: Web application (existing monorepo) — change is scoped to the `desktop-client` workspace's report/spreadsheet layer

**Performance Goals**: No regression to existing report render time; the fix adds O(transfers-in-range) bookkeeping on top of the existing O(accounts × intervals) calculation already performed per render — negligible for typical budget sizes

**Constraints**: Must not change stored transaction dates or per-account balance calculations (FR-003); must respect existing report account-inclusion/exclusion rules (FR-007) and selected date-range boundaries (FR-008); must not regress any net worth values for data without mismatched-date transfers (FR-006, SC-003); no data migration — fix must apply retroactively simply by recalculating on next view (FR-010)

**Scale/Scope**: Single calculation module (`net-worth-spreadsheet.ts`) plus its consumers (`NetWorth.tsx`, `NetWorthCard.tsx` reports) and a new unit test file; no changes to other report types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unfilled
template with no ratified principles for this repository, so there are no
project-specific gates to evaluate. Falling back to the repository's
documented engineering conventions (`AGENTS.md`, `CODE_REVIEW_GUIDELINES.md`):
this plan keeps the change minimal and scoped to the reported bug, avoids
mocked/duplicated logic by reusing the existing `transfer_id` link and
`accounts` inclusion list already passed into the spreadsheet, adds tests
using the existing Vitest conventions, and introduces no new dependencies,
schema changes, or external interfaces. **Gate: PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/001-fix-net-worth-transfer/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

No `contracts/` directory is generated for this feature: it fixes an internal
calculation in an existing report and introduces no new external API,
command schema, or endpoint (see Phase 1 rules — skipped for purely internal
changes).

### Source Code (repository root)

```text
packages/desktop-client/src/components/reports/
├── spreadsheets/
│   ├── net-worth-spreadsheet.ts        # Primary change: detect transfer
│   │                                    # pairs and neutralize matched
│   │                                    # principal in the aggregate total
│   └── net-worth-spreadsheet.test.ts   # New unit tests (edge cases from spec)
└── reports/
    ├── NetWorth.tsx                    # Consumer — no change expected
    └── NetWorthCard.tsx                # Consumer (dashboard widget) — no change expected

upcoming-release-notes/
└── fix-net-worth-transfer-date-mismatch.md   # Release note per FR-010
```

**Structure Decision**: This is a monorepo web application
(`packages/desktop-client`, aliased `@actual-app/web`). The fix is entirely
contained within the existing `reports/spreadsheets` calculation layer of
that single workspace — no `backend/`+`frontend/` split or new project is
needed; the existing single-project layout for this workspace is reused as-is.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations — this section is intentionally left empty.

## References

- Design ticket: https://github.com/miroslav-krupan/actualbudget/issues/6
- Branch: https://github.com/miroslav-krupan/actualbudget/tree/issue-6-bug-net-worth-widget-incorrectly-shows-change-when
- Spec: https://github.com/miroslav-krupan/actualbudget/blob/issue-6-bug-net-worth-widget-incorrectly-shows-change-when/specs/001-fix-net-worth-transfer/spec.md
