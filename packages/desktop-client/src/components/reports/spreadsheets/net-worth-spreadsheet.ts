import { send } from '@actual-app/core/platform/client/connection';
import * as monthUtils from '@actual-app/core/shared/months';
import { q } from '@actual-app/core/shared/query';
import type {
  AccountEntity,
  RuleConditionEntity,
} from '@actual-app/core/types/models';
import * as d from 'date-fns';
import type { Locale } from 'date-fns';
import { keyBy } from 'es-toolkit';

import { ReportOptions } from '#components/reports/ReportOptions';
import type { FormatType } from '#hooks/useFormat';
import type { useSpreadsheet } from '#hooks/useSpreadsheet';
import { aqlQuery } from '#queries/aqlQuery';

type Balance = {
  date: string;
  amount: number;
};

// A single transaction row, queried only for the purpose of reconstructing
// linked transfer pairs (see `findTransferPairs`). `transferId` is `null`/
// absent for ordinary (non-transfer) transactions.
type RawTransaction = {
  id: string;
  account: string;
  date: string;
  amount: number;
  transferId: string | null;
};

export type TransferLeg = {
  account: string;
  date: string;
  amount: number;
};

// A reconstructed pair of linked transfer transactions (matched by shared
// `transfer_id`). `legB` is `undefined` when no matching leg was found in the
// queried transaction set (e.g. the other leg's account isn't net-worth
// tracked, falls outside the viewed date range, or the link is broken/the
// other leg was deleted) — see FR-007, FR-008, FR-011.
export type TransferPair = {
  transferId: string;
  legA: TransferLeg;
  legB?: TransferLeg;
  // Both fields are `true` whenever `legB` is present: the raw transaction
  // query that feeds `findTransferPairs` only ever selects transactions from
  // the tracked `accounts` passed into `createSpreadsheet()` and dated within
  // the current [startDate, endDate] view, so finding both legs here already
  // guarantees both conditions (FR-007, FR-008).
  bothLegsTracked: boolean;
  bothLegsInRange: boolean;
  matchedAmount: number;
  residualAmount: number;
};

// Given the transactions already being queried per account (including
// `transferId`), reconstruct linked transfer pairs by shared, non-null
// `transferId`. An orphaned leg (no matching row found) produces a pair with
// `legB: undefined`, which callers must treat as non-neutralizable (FR-011).
export function findTransferPairs(
  transactions: RawTransaction[],
): TransferPair[] {
  const byTransferId = new Map<string, RawTransaction[]>();
  for (const txn of transactions) {
    if (!txn.transferId) continue;
    const group = byTransferId.get(txn.transferId);
    if (group) {
      group.push(txn);
    } else {
      byTransferId.set(txn.transferId, [txn]);
    }
  }

  const pairs: TransferPair[] = [];
  byTransferId.forEach((group, transferId) => {
    const [first, second] = group;
    const legA: TransferLeg = {
      account: first.account,
      date: first.date,
      amount: first.amount,
    };
    const legB: TransferLeg | undefined = second
      ? { account: second.account, date: second.date, amount: second.amount }
      : undefined;

    pairs.push({
      transferId,
      legA,
      legB,
      bothLegsTracked: legB != null,
      bothLegsInRange: legB != null,
      matchedAmount: legB
        ? Math.min(Math.abs(legA.amount), Math.abs(legB.amount))
        : 0,
      residualAmount: legB ? Math.abs(legA.amount) - Math.abs(legB.amount) : 0,
    });
  });

  return pairs;
}

// Maps a transaction date to the same interval key used to bucket account
// balances (`intervals` in `recalculate()`), so a transfer leg's date can be
// located within the current graph's interval list.
function getIntervalKeyForDate(
  date: string,
  interval: string,
  firstDayOfWeekIdx: string,
): string {
  if (interval === 'Daily') {
    return date;
  } else if (interval === 'Weekly') {
    return monthUtils.weekFromDate(date, firstDayOfWeekIdx);
  } else if (interval === 'Yearly') {
    return date.slice(0, 4);
  }
  return monthUtils.getMonth(date);
}

// Given the reconstructed transfer pairs and the current view's interval
// list, compute a signed aggregate adjustment per interval so that fully
// in-range, both-tracked pairs no longer produce a transient swing between
// the interval containing the earlier leg and the interval containing the
// later leg (FR-001, FR-003). Untracked-account or partial-range pairs (no
// `legB`) yield no adjustment. Unequal-amount pairs neutralize only the
// matched (smaller-magnitude) principal, leaving any fee/conversion
// difference visible (FR-009). Same-interval pairs produce a zero-width
// window and therefore no adjustment (FR-006).
export function computeTransferAdjustments(
  pairs: TransferPair[],
  intervals: string[],
  interval: string,
  firstDayOfWeekIdx: string,
): Record<string, number> {
  const adjustments: Record<string, number> = {};

  for (const pair of pairs) {
    if (!pair.legB || !pair.bothLegsTracked || !pair.bothLegsInRange) {
      continue;
    }
    if (pair.matchedAmount === 0) {
      continue;
    }

    const keyA = getIntervalKeyForDate(
      pair.legA.date,
      interval,
      firstDayOfWeekIdx,
    );
    const keyB = getIntervalKeyForDate(
      pair.legB.date,
      interval,
      firstDayOfWeekIdx,
    );
    const idxA = intervals.indexOf(keyA);
    const idxB = intervals.indexOf(keyB);
    if (idxA === -1 || idxB === -1) continue;

    const earlierIdx = Math.min(idxA, idxB);
    const laterIdx = Math.max(idxA, idxB);
    if (earlierIdx === laterIdx) continue;

    const earlierLeg = pair.legA.date <= pair.legB.date ? pair.legA : pair.legB;
    const sign = Math.sign(earlierLeg.amount);
    if (sign === 0) continue;

    const adjustmentValue = -sign * pair.matchedAmount;
    for (let i = earlierIdx; i < laterIdx; i++) {
      const key = intervals[i];
      adjustments[key] = (adjustments[key] ?? 0) + adjustmentValue;
    }
  }

  return adjustments;
}

export function createSpreadsheet(
  start: string,
  end: string,
  accounts: AccountEntity[],
  conditions: RuleConditionEntity[] = [],
  conditionsOp: 'and' | 'or' = 'and',
  locale: Locale,
  interval: string = 'Monthly',
  firstDayOfWeekIdx: string = '0',
  format: (value: unknown, type?: FormatType) => string,
) {
  return async (
    spreadsheet: ReturnType<typeof useSpreadsheet>,
    setData: (data: ReturnType<typeof recalculate>) => void,
  ) => {
    const { filters } = await send('make-filters-from-conditions', {
      conditions: conditions.filter(cond => !cond.customName),
    });
    const conditionsOpKey = conditionsOp === 'or' ? '$or' : '$and';

    // Go back exactly one interval before the selected range start
    // to get the correct starting balance for the first period
    const rangeStart = d.parseISO(monthUtils.firstDayOfMonth(start));
    let startDate: string;
    if (interval === 'Daily') {
      startDate = monthUtils.dayFromDate(d.subDays(rangeStart, 1));
    } else if (interval === 'Weekly') {
      startDate = monthUtils.weekFromDate(
        d.subDays(rangeStart, 1),
        firstDayOfWeekIdx,
      );
    } else {
      // Monthly or yearly
      startDate = monthUtils.firstDayOfMonth(monthUtils.prevMonth(start));
    }

    // If the earliest transaction is on or after the first day of the start
    // month, the prior period lookback would be empty (all zeros). Skip it to
    // avoid rendering an empty data point.
    const earliestTransaction = await send('get-earliest-transaction');
    if (
      earliestTransaction &&
      earliestTransaction.date >= monthUtils.firstDayOfMonth(start)
    ) {
      if (interval === 'Daily') {
        startDate = earliestTransaction.date;
      } else if (interval === 'Weekly') {
        startDate = monthUtils.weekFromDate(
          earliestTransaction.date,
          firstDayOfWeekIdx,
        );
      } else {
        // Monthly or Yearly
        startDate = monthUtils.firstDayOfMonth(start);
      }
    }

    // Start with the provided end-of-month date, then adjust for current context
    let endDate = monthUtils.lastDayOfMonth(end);

    if (interval === 'Daily') {
      const today = monthUtils.currentDay();
      if (monthUtils.isAfter(endDate, today)) {
        endDate = today;
      }
    } else if (interval === 'Weekly') {
      // Include the ongoing (current) week up to today instead of clamping to the
      // start of the current week. This ensures the current week appears in the
      // report even if the week hasn't finished yet.
      const today = monthUtils.currentDay();
      if (monthUtils.isAfter(endDate, today)) {
        endDate = today;
      }
    }

    const data = await Promise.all(
      accounts.map(async acct => {
        const [starting, balances, rawTransactions]: [
          number,
          Balance[],
          Array<Omit<RawTransaction, 'account'>>,
        ] = await Promise.all([
          aqlQuery(
            q('transactions')
              .filter({
                [conditionsOpKey]: filters,
                account: acct.id,
                date: { $lt: startDate },
              })
              .calculate({ $sum: '$amount' }),
          ).then(({ data }) => data),

          aqlQuery(
            q('transactions')
              .filter({
                [conditionsOpKey]: filters,
              })
              .filter({
                account: acct.id,
                $and: [
                  { date: { $gte: startDate } },
                  { date: { $lte: endDate } },
                ],
              })
              .groupBy(
                interval === 'Yearly'
                  ? { $year: '$date' }
                  : interval === 'Daily' || interval === 'Weekly'
                    ? 'date'
                    : { $month: '$date' },
              )
              .select([
                {
                  date:
                    interval === 'Yearly'
                      ? { $year: '$date' }
                      : interval === 'Daily' || interval === 'Weekly'
                        ? 'date'
                        : { $month: '$date' },
                },
                { amount: { $sum: '$amount' } },
              ]),
          ).then(({ data }) => data),

          // Fetched only to reconstruct linked transfer pairs (see
          // `findTransferPairs`) so cross-period transfers between two
          // net-worth-tracked accounts no longer distort the aggregate
          // total/change. Restricted to this account and the current
          // [startDate, endDate] view, matching the scope of `balances`.
          aqlQuery(
            q('transactions')
              .filter({
                [conditionsOpKey]: filters,
              })
              .filter({
                account: acct.id,
                $and: [
                  { date: { $gte: startDate } },
                  { date: { $lte: endDate } },
                ],
              })
              .select(['id', 'date', 'amount', { transferId: 'transfer_id' }]),
          ).then(({ data }) => data),
        ]);

        // For weekly intervals, transform dates to week format and properly aggregate
        let processedBalances: Record<string, Balance>;
        if (interval === 'Weekly') {
          // Group transactions by week and sum their amounts
          const weeklyBalances: Record<string, number> = {};
          balances.forEach(b => {
            const weekDate = monthUtils.weekFromDate(b.date, firstDayOfWeekIdx);
            weeklyBalances[weekDate] =
              (weeklyBalances[weekDate] || 0) + b.amount;
          });

          // Convert back to Balance format
          processedBalances = {};
          Object.entries(weeklyBalances).forEach(([date, amount]) => {
            processedBalances[date] = { date, amount };
          });
        } else {
          processedBalances = keyBy(balances, b => b.date);
        }

        return {
          id: acct.id,
          name: acct.name,
          balances: processedBalances,
          starting,
          transactions: rawTransactions.map(txn => ({
            ...txn,
            account: acct.id,
          })),
        };
      }),
    );

    setData(
      recalculate(
        data,
        startDate,
        endDate,
        locale,
        interval,
        firstDayOfWeekIdx,
        format,
      ),
    );
  };
}

export function recalculate(
  data: Array<{
    id: string;
    name: string;
    balances: Record<string, Balance>;
    starting: number;
    transactions?: RawTransaction[];
  }>,
  startDate: string,
  endDate: string,
  locale: Locale,
  interval: string = 'Monthly',
  firstDayOfWeekIdx: string = '0',
  format: (value: unknown, type?: FormatType) => string,
) {
  // Get intervals using the same pattern as other working spreadsheets
  const intervals =
    interval === 'Weekly'
      ? monthUtils.weekRangeInclusive(startDate, endDate, firstDayOfWeekIdx)
      : interval === 'Daily'
        ? monthUtils.dayRangeInclusive(startDate, endDate)
        : interval === 'Yearly'
          ? monthUtils.yearRangeInclusive(startDate, endDate)
          : monthUtils.rangeInclusive(
              monthUtils.getMonth(startDate),
              monthUtils.getMonth(endDate),
            );

  const accountBalances = data.map(account => {
    let balance = account.starting;
    return intervals.map(intervalItem => {
      if (account.balances[intervalItem]) {
        balance += account.balances[intervalItem].amount;
      }
      return balance;
    });
  });

  const priorPeriodNetWorth = data.reduce(
    (sum, account) => sum + account.starting,
    0,
  );

  // Neutralize the aggregate (graph-only) effect of linked transfers whose
  // legs land in different intervals, without altering any account's own
  // running balance above (FR-001, FR-003, FR-005).
  const transferPairs = findTransferPairs(
    data.flatMap(account => account.transactions ?? []),
  );
  const transferAdjustments = computeTransferAdjustments(
    transferPairs,
    intervals,
    interval,
    firstDayOfWeekIdx,
  );

  let hasNegative = false;
  let startNetWorth = 0;
  let endNetWorth = 0;
  let lowestNetWorth: number | null = null;
  let highestNetWorth: number | null = null;

  const graphData = intervals.reduce<
    Array<{
      x: string;
      y: number;
      assets: string;
      debt: string;
      change: string;
      networth: string;
      date: string;
    }>
  >((arr, intervalItem, idx) => {
    let debt = 0;
    let assets = 0;
    let total = 0;
    const last = arr.length === 0 ? null : arr[arr.length - 1];

    const balances: Record<string, number> = {};
    accountBalances.forEach((acctBalances, i) => {
      const balance = acctBalances[idx];
      balances[data[i].id] = balance;

      if (balance < 0) {
        debt += -balance;
      } else {
        assets += balance;
      }
      total += balance;
    });

    // Apply the transfer-neutralization adjustment (if any) for this
    // interval to the aggregate figures only; per-account `balances` above
    // are left untouched (FR-005).
    const adjustment = transferAdjustments[intervalItem] ?? 0;
    if (adjustment > 0) {
      assets += adjustment;
    } else if (adjustment < 0) {
      debt += -adjustment;
    }
    total += adjustment;

    if (total < 0) {
      hasNegative = true;
    }

    // Parse dates based on interval type - following the working pattern
    let x: Date;
    if (interval === 'Daily' || interval === 'Weekly') {
      x = d.parseISO(intervalItem);
    } else if (interval === 'Yearly') {
      x = d.parseISO(intervalItem + '-01-01');
    } else {
      x = d.parseISO(intervalItem + '-01');
    }

    const change = last ? total - last.y : total - priorPeriodNetWorth;

    if (arr.length === 0) {
      startNetWorth = total;
    }
    endNetWorth = total;

    // Use standardized format from ReportOptions
    const displayFormat =
      ReportOptions.intervalFormat.get(interval) ?? "MMM ''yy";

    const tooltipFormat =
      interval === 'Daily'
        ? 'MMMM d, yyyy'
        : interval === 'Weekly'
          ? 'MMM d, yyyy'
          : interval === 'Yearly'
            ? 'yyyy'
            : 'MMMM yyyy';

    const graphPoint = {
      x: d.format(x, displayFormat, { locale }),
      y: total,
      assets: format(assets, 'financial'),
      debt: `-${format(debt, 'financial')}`,
      change: format(change, 'financial'),
      networth: format(total, 'financial'),
      date: d.format(x, tooltipFormat, { locale }),
      ...balances,
    };

    arr.push(graphPoint);

    // Track min/max for the current point only
    if (lowestNetWorth === null || graphPoint.y < lowestNetWorth) {
      lowestNetWorth = graphPoint.y;
    }
    if (highestNetWorth === null || graphPoint.y > highestNetWorth) {
      highestNetWorth = graphPoint.y;
    }

    return arr;
  }, []);

  const hasBalance = accountBalances.map(balances =>
    balances.some(b => b !== 0),
  );

  return {
    graphData: {
      data: graphData,
      hasNegative,
      start: startDate,
      end: endDate,
    },
    netWorth: endNetWorth,
    totalChange: endNetWorth - startNetWorth,
    lowestNetWorth,
    highestNetWorth,
    accounts: data
      .filter((_, i) => hasBalance[i])
      .map(d => ({ id: d.id, name: d.name })),
  };
}
