import { enUS } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import {
  computeTransferAdjustments,
  recalculate,
} from './net-worth-spreadsheet';

const format = (value: unknown) => String(value);

type TransferTxn = {
  id: string;
  transfer_id: string | null;
  account: string;
  amount: number;
  date: string;
};

const transferPair = (
  overrides: Partial<{
    idA: string;
    idB: string;
    accountA: string;
    accountB: string;
    amountA: number;
    amountB: number;
    dateA: string;
    dateB: string;
  }> = {},
): TransferTxn[] => {
  const {
    idA = 'txn-a',
    idB = 'txn-b',
    accountA = 'checking',
    accountB = 'savings',
    amountA = -10000,
    amountB = 10000,
    dateA = '2024-07-31',
    dateB = '2024-08-01',
  } = overrides;

  return [
    {
      id: idA,
      transfer_id: idB,
      account: accountA,
      amount: amountA,
      date: dateA,
    },
    {
      id: idB,
      transfer_id: idA,
      account: accountB,
      amount: amountB,
      date: dateB,
    },
  ];
};

describe('computeTransferAdjustments', () => {
  const intervals = ['2024-06', '2024-07', '2024-08', '2024-09'];
  const startDate = '2024-06-01';
  const endDate = '2024-09-30';
  const accountIds = new Set(['checking', 'savings']);

  it('produces no adjustment when both legs share the same date', () => {
    const txns = transferPair({ dateA: '2024-07-15', dateB: '2024-07-15' });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([0, 0, 0, 0]);
  });

  it('produces no adjustment when legs fall in the same month but different days', () => {
    const txns = transferPair({ dateA: '2024-07-05', dateB: '2024-07-20' });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([0, 0, 0, 0]);
  });

  it('neutralizes a transfer split across a month boundary (7/31 -> 8/1)', () => {
    const txns = transferPair({
      dateA: '2024-07-31',
      dateB: '2024-08-01',
      amountA: -10000,
      amountB: 10000,
    });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    // July (idx 1) is "in transit" and needs +10000 added back to offset the
    // withdrawal leg that posted with no matching deposit yet.
    expect(adjustments).toEqual([0, 10000, 0, 0]);
  });

  it('neutralizes a transfer split across a year boundary (12/31 -> 1/1)', () => {
    const yearIntervals = ['2023-11', '2023-12', '2024-01', '2024-02'];
    const txns = transferPair({
      dateA: '2023-12-31',
      dateB: '2024-01-01',
      amountA: -5000,
      amountB: 5000,
    });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      yearIntervals,
      '2023-11-01',
      '2024-02-29',
    );

    expect(adjustments).toEqual([0, 5000, 0, 0]);
  });

  it('does not fabricate an offset when one leg is outside the selected range', () => {
    // Only the withdrawal leg is captured by the query (date <= endDate);
    // the deposit leg (transfer_id target) is simply absent, so no pair is
    // formed and the visible leg shows a real change.
    const txns: TransferTxn[] = [
      {
        id: 'txn-a',
        transfer_id: 'txn-b',
        account: 'checking',
        amount: -10000,
        date: '2024-07-31',
      },
    ];

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([0, 0, 0, 0]);
  });

  it('does not offset a transfer leg belonging to an excluded account', () => {
    const txns = transferPair({
      accountA: 'checking',
      accountB: 'excluded-tracking-account',
      dateA: '2024-07-31',
      dateB: '2024-08-01',
    });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds, // does not include 'excluded-tracking-account'
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([0, 0, 0, 0]);
  });

  it('only neutralizes the matched principal when legs are unequal (fee/FX delta)', () => {
    // Withdrawal of 105 (100 principal + 5 fee), deposit of only 100.
    const txns = transferPair({
      amountA: -10500,
      amountB: 10000,
      dateA: '2024-07-31',
      dateB: '2024-08-01',
    });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    // Only the matched principal (10000) is neutralized in July; the 500
    // residual fee still shows as a real change throughout.
    expect(adjustments).toEqual([0, 10000, 0, 0]);
  });

  it('handles multiple mismatched-date transfers between the same accounts', () => {
    const txns = [
      ...transferPair({
        idA: 'a1',
        idB: 'b1',
        amountA: -10000,
        amountB: 10000,
        dateA: '2024-06-30',
        dateB: '2024-07-01',
      }),
      ...transferPair({
        idA: 'a2',
        idB: 'b2',
        amountA: -2000,
        amountB: 2000,
        dateA: '2024-08-31',
        dateB: '2024-09-01',
      }),
    ];

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([10000, 0, 2000, 0]);
  });

  it('clamps a leg dated before the start of the report to the first interval', () => {
    // Withdrawal happened before the report window even starts, deposit
    // lands in August — the whole window should treat July onward as
    // "in transit" up to (not including) the deposit's interval.
    const txns = transferPair({
      dateA: '2024-05-01',
      dateB: '2024-08-01',
      amountA: -10000,
      amountB: 10000,
    });

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([10000, 10000, 0, 0]);
  });

  it('ignores non-transfer transactions', () => {
    const txns: TransferTxn[] = [
      {
        id: 'txn-a',
        transfer_id: null,
        account: 'checking',
        amount: -5000,
        date: '2024-07-31',
      },
    ];

    const adjustments = computeTransferAdjustments(
      txns,
      accountIds,
      intervals,
      startDate,
      endDate,
    );

    expect(adjustments).toEqual([0, 0, 0, 0]);
  });
});

describe('recalculate', () => {
  // Two accounts, each starting at 0, with the reporting window covering
  // July and August (startDate is the interval *before* the visible range,
  // matching how createSpreadsheet computes it for the lookback balance).
  const baseData = [
    {
      id: 'checking',
      name: 'Checking',
      balances: {},
      starting: 100000,
    },
    {
      id: 'savings',
      name: 'Savings',
      balances: {},
      starting: 50000,
    },
  ];

  it('keeps the combined total flat across a split-month transfer', () => {
    const data = [
      {
        ...baseData[0],
        balances: { '2024-07': { date: '2024-07', amount: -10000 } },
      },
      {
        ...baseData[1],
        balances: { '2024-08': { date: '2024-08', amount: 10000 } },
      },
    ];

    const transferTxns = transferPair({
      dateA: '2024-07-31',
      dateB: '2024-08-01',
      amountA: -10000,
      amountB: 10000,
    });

    const result = recalculate(
      data,
      '2024-06-01',
      '2024-08-31',
      enUS,
      'Monthly',
      '0',
      format,
      transferTxns,
      new Set(['checking', 'savings']),
    );

    const totals = result.graphData.data.map(point => point.y);
    // starting combined total is 150000; it must stay flat across the whole
    // window since the transfer is fully matched and in-range.
    expect(totals).toEqual([150000, 150000, 150000]);
  });

  it('regresses to identical behavior for same-day transfers (no adjustment)', () => {
    const data = [
      {
        ...baseData[0],
        balances: { '2024-07': { date: '2024-07', amount: -10000 } },
      },
      {
        ...baseData[1],
        balances: { '2024-07': { date: '2024-07', amount: 10000 } },
      },
    ];

    const withTransferInfo = recalculate(
      data,
      '2024-06-01',
      '2024-08-31',
      enUS,
      'Monthly',
      '0',
      format,
      transferPair({ dateA: '2024-07-15', dateB: '2024-07-15' }),
      new Set(['checking', 'savings']),
    );

    const withoutTransferInfo = recalculate(
      data,
      '2024-06-01',
      '2024-08-31',
      enUS,
      'Monthly',
      '0',
      format,
    );

    expect(withTransferInfo.graphData.data.map(p => p.y)).toEqual(
      withoutTransferInfo.graphData.data.map(p => p.y),
    );
  });

  it('does not adjust individual account balances, only the aggregate total', () => {
    const data = [
      {
        ...baseData[0],
        balances: { '2024-07': { date: '2024-07', amount: -10000 } },
      },
      {
        ...baseData[1],
        balances: { '2024-08': { date: '2024-08', amount: 10000 } },
      },
    ];

    const transferTxns = transferPair({
      dateA: '2024-07-31',
      dateB: '2024-08-01',
      amountA: -10000,
      amountB: 10000,
    });

    const result = recalculate(
      data,
      '2024-06-01',
      '2024-08-31',
      enUS,
      'Monthly',
      '0',
      format,
      transferTxns,
      new Set(['checking', 'savings']),
    );

    // Each account's own balance still reflects its own leg's date.
    expect(
      result.graphData.data.map(point => point['checking' as never]),
    ).toEqual([100000, 90000, 90000]);
    expect(
      result.graphData.data.map(point => point['savings' as never]),
    ).toEqual([50000, 50000, 60000]);
  });
});
