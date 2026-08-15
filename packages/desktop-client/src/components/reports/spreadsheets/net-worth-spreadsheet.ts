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

type TransferTransaction = {
  id: string;
  transfer_id: string | null;
  account: string;
  amount: number;
  date: string;
};

/**
 * Maps a transaction date to the interval "bucket" key used by the
 * `intervals` array for the given report granularity (matching the
 * `groupBy` keys produced by the per-account balance query above).
 */
function getIntervalKey(
  date: string,
  interval: string,
  firstDayOfWeekIdx: string,
): string {
  if (interval === 'Yearly') {
    return monthUtils.yearFromDate(date);
  } else if (interval === 'Daily') {
    return date;
  } else if (interval === 'Weekly') {
    return monthUtils.weekFromDate(date, firstDayOfWeekIdx);
  }
  // Monthly (default)
  return monthUtils.getMonth(date);
}

/**
 * Resolves a transfer leg's date to an index into `intervals`, clamping
 * dates before the report's start to the first interval (they are already
 * folded into the per-account `starting` balance) and dates after the
 * report's end to just past the last interval (not yet visible/captured).
 */
function getIntervalIndexClamped(
  date: string,
  intervals: string[],
  startDate: string,
  endDate: string,
  interval: string,
  firstDayOfWeekIdx: string,
): number {
  if (date < startDate) return 0;
  if (date > endDate) return intervals.length;

  const key = getIntervalKey(date, interval, firstDayOfWeekIdx);
  const idx = intervals.indexOf(key);
  return idx === -1 ? intervals.length : idx;
}

/**
 * Computes, for each report interval, the net-worth adjustment needed to
 * neutralize the "in transit" principal of transfers between two of the
 * user's own included accounts whose legs are dated in different intervals.
 *
 * Only the matched/transferred principal (`min(abs(legA), abs(legB))`) is
 * neutralized; any residual fee/FX delta between unequal legs continues to
 * show up as a real change (FR-009). A transfer pair only produces an
 * adjustment when both legs' accounts are included in the report (FR-007)
 * and both legs are captured by the query, i.e. in-range or folded into the
 * pre-range starting balance (FR-008).
 */
export function computeTransferAdjustments(
  transferTxns: TransferTransaction[],
  accountIds: Set<string>,
  intervals: string[],
  startDate: string,
  endDate: string,
  interval: string = 'Monthly',
  firstDayOfWeekIdx: string = '0',
): number[] {
  const adjustments = new Array(intervals.length).fill(0);

  const pairsById = new Map<string, TransferTransaction[]>();
  for (const txn of transferTxns) {
    if (!txn.transfer_id) continue;
    const key = [txn.id, txn.transfer_id].sort().join('|');
    const list = pairsById.get(key) ?? [];
    list.push(txn);
    pairsById.set(key, list);
  }

  for (const legs of pairsById.values()) {
    if (legs.length !== 2) continue;
    const [a, b] = legs;

    // Both legs' accounts must be included in this report (FR-007).
    if (!accountIds.has(a.account) || !accountIds.has(b.account)) continue;

    const [earlier, later] = a.date <= b.date ? [a, b] : [b, a];
    if (earlier.amount === 0) continue;

    const matchedPrincipal = Math.min(Math.abs(a.amount), Math.abs(b.amount));
    if (matchedPrincipal === 0) continue;

    const earlierIdx = getIntervalIndexClamped(
      earlier.date,
      intervals,
      startDate,
      endDate,
      interval,
      firstDayOfWeekIdx,
    );
    const laterIdx = getIntervalIndexClamped(
      later.date,
      intervals,
      startDate,
      endDate,
      interval,
      firstDayOfWeekIdx,
    );

    if (laterIdx <= earlierIdx) continue;

    const adjustmentAmount = -Math.sign(earlier.amount) * matchedPrincipal;

    for (
      let idx = earlierIdx;
      idx < Math.min(laterIdx, intervals.length);
      idx++
    ) {
      adjustments[idx] += adjustmentAmount;
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
        const [starting, balances]: [number, Balance[]] = await Promise.all([
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
        };
      }),
    );

    // Fetch all transfer legs (not scoped to the report's accounts) up to
    // the report's end date, so we can detect transfer pairs where one leg
    // belongs to an excluded/off-budget account (FR-007) or falls before
    // the report's start date (FR-008), and neutralize the matched
    // principal of any mismatched-date transfer pair for the aggregate
    // total (FR-001, FR-009).
    const { data: transferTxns }: { data: TransferTransaction[] } =
      await aqlQuery(
        q('transactions')
          .filter({
            transfer_id: { $ne: null },
            date: { $lte: endDate },
          })
          .select(['id', 'transfer_id', 'account', 'amount', 'date']),
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
        transferTxns,
        new Set(accounts.map(acct => acct.id)),
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
  }>,
  startDate: string,
  endDate: string,
  locale: Locale,
  interval: string = 'Monthly',
  firstDayOfWeekIdx: string = '0',
  format: (value: unknown, type?: FormatType) => string,
  transferTxns: TransferTransaction[] = [],
  accountIds: Set<string> = new Set(data.map(account => account.id)),
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

  // Neutralize the "in transit" principal of mismatched-date transfers
  // between included accounts for the aggregate total only (FR-001,
  // FR-003, FR-007, FR-008, FR-009).
  const transferAdjustments = computeTransferAdjustments(
    transferTxns,
    accountIds,
    intervals,
    startDate,
    endDate,
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

    // Apply the transfer-in-transit adjustment to the aggregate total only;
    // each account's own `balance` above (and `balances` map) is untouched.
    total += transferAdjustments[idx];

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
