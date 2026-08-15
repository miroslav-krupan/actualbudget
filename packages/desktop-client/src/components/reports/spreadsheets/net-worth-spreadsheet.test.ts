import { enUS } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';

import { computeTransferAdjustments, findTransferPairs, recalculate } from './net-worth-spreadsheet';
import type { TransferPair } from './net-worth-spreadsheet';

const format = (value: unknown) => String(value);

type Balance = { date: string; amount: number };

type AccountInput = {
  id: string;
  name: string;
  starting: number;
  balances: Balance[];
  transactions?: Array<{
    id: string;
    account: string;
    date: string;
    amount: number;
    transferId: string | null;
  }>;
};

function buildAccount(input: AccountInput) {
  return {
    id: input.id,
    name: input.name,
    starting: input.starting,
    balances: Object.fromEntries(
      input.balances.map(b => [b.date, b]),
    ) as Record<string, Balance>,
    transactions: input.transactions ?? [],
  };
}

describe('net-worth-spreadsheet: cross-month transfer neutralization', () => {
  it('shows no false gain/loss for a transfer split across a month boundary (7/31 -> 8/1)', () => {
    // Baseline: identical account balances but with no transfer_id present,
    // reproducing the pre-fix (unadjusted) behavior for comparison.
    const result = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-08', amount: 100 }],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-1',
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-08', amount: 100 }],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-08-01',
              amount: 100,
              transferId: 'transfer-1',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    // Two data points: July, August
    const [july, august] = withTransactions.graphData.data;
    expect(july.change).toBe('0');
    expect(august.change).toBe('0');
    // Sanity check against the un-neutralized baseline: without transfer
    // detection, July would show a real -100 change and August a real +100.
    const [rawJuly, rawAugust] = result.graphData.data;
    expect(rawJuly.change).toBe('-100');
    expect(rawAugust.change).toBe('100');
  });

  it('does not change output for a same-month transfer (regression guard)', () => {
    const withoutTransfer = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-07', amount: 100 }],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const withTransfer = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-10',
              amount: -100,
              transferId: 'transfer-2',
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-07', amount: 100 }],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-07-15',
              amount: 100,
              transferId: 'transfer-2',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    expect(withTransfer.graphData.data).toEqual(withoutTransfer.graphData.data);
    expect(withTransfer.netWorth).toBe(withoutTransfer.netWorth);
    expect(withTransfer.totalChange).toBe(withoutTransfer.totalChange);
  });

  it('leaves per-account balances unchanged for a cross-month transfer', () => {
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-1',
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-08', amount: 100 }],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-08-01',
              amount: 100,
              transferId: 'transfer-1',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july, august] = withTransactions.graphData.data as unknown as Array<
      Record<string, number>
    >;
    // Per-account balances still reflect each leg on its real date.
    expect(july.checking).toBe(900);
    expect(july.savings).toBe(1000);
    expect(august.checking).toBe(900);
    expect(august.savings).toBe(1100);
  });

  it('does not neutralize a transfer touching an untracked account (only one leg queried)', () => {
    // The untracked account is simply never included in `accounts`, so only
    // the tracked leg is ever queried/seen — this alone reproduces FR-007.
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-3',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july] = withTransactions.graphData.data;
    expect(july.change).toBe('-100');
  });

  it('does not fabricate an offset when only one leg falls within the viewed range', () => {
    // Only the July leg is queried (August leg would only appear if the
    // range extended into August), simulating a partial-range view.
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-4',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-07',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july] = withTransactions.graphData.data;
    expect(july.change).toBe('-100');
  });

  it('neutralizes only the matched principal for a transfer with a fee/conversion spread', () => {
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-5',
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-08', amount: 98 }],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-08-01',
              amount: 98,
              transferId: 'transfer-5',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july, august] = withTransactions.graphData.data;
    // Only the matched $98 is neutralized in July; the $2 fee remains a
    // genuine change, fully visible once it lands in August.
    expect(july.change).toBe('-2');
    expect(august.change).toBe('0');
  });

  it('treats an orphaned transfer leg (no matching pair present) as an ordinary transaction', () => {
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-orphan',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july] = withTransactions.graphData.data;
    expect(july.change).toBe('-100');
  });

  it('does not neutralize manually entered, unlinked matching inflow/outflow pairs (no transfer_id)', () => {
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [{ date: '2026-07', amount: -100 }],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: null,
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [{ date: '2026-08', amount: 100 }],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-08-01',
              amount: 100,
              transferId: null,
            },
          ],
        }),
      ],
      '2026-07',
      '2026-08',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july, august] = withTransactions.graphData.data;
    expect(july.change).toBe('-100');
    expect(august.change).toBe('100');
  });

  it('does not accumulate drift across multiple independent cross-month transfers (User Story 2)', () => {
    const withTransactions = recalculate(
      [
        buildAccount({
          id: 'checking',
          name: 'Checking',
          starting: 1000,
          balances: [
            { date: '2026-07', amount: -100 },
            { date: '2026-08', amount: -50 },
          ],
          transactions: [
            {
              id: 't1',
              account: 'checking',
              date: '2026-07-31',
              amount: -100,
              transferId: 'transfer-a',
            },
            {
              id: 't3',
              account: 'checking',
              date: '2026-08-31',
              amount: -50,
              transferId: 'transfer-b',
            },
          ],
        }),
        buildAccount({
          id: 'savings',
          name: 'Savings',
          starting: 1000,
          balances: [
            { date: '2026-08', amount: 100 },
            { date: '2026-09', amount: 50 },
          ],
          transactions: [
            {
              id: 't2',
              account: 'savings',
              date: '2026-08-01',
              amount: 100,
              transferId: 'transfer-a',
            },
            {
              id: 't4',
              account: 'savings',
              date: '2026-09-01',
              amount: 50,
              transferId: 'transfer-b',
            },
          ],
        }),
      ],
      '2026-07',
      '2026-09',
      enUS,
      'Monthly',
      '0',
      format,
    );

    const [july, august, september] = withTransactions.graphData.data;
    expect(july.change).toBe('0');
    expect(august.change).toBe('0');
    expect(september.change).toBe('0');

    const trueEndingTotal = 1000 - 100 - 50 + (1000 + 100 + 50);
    expect(september.y).toBe(trueEndingTotal);
    expect(withTransactions.netWorth).toBe(trueEndingTotal);
  });
});

describe('findTransferPairs', () => {
  it('groups two transactions sharing a non-null transfer_id into one pair', () => {
    const pairs = findTransferPairs([
      {
        id: 't1',
        account: 'a',
        date: '2026-07-31',
        amount: -100,
        transferId: 'x',
      },
      {
        id: 't2',
        account: 'b',
        date: '2026-08-01',
        amount: 100,
        transferId: 'x',
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({
      transferId: 'x',
      legA: { account: 'a', date: '2026-07-31', amount: -100 },
      legB: { account: 'b', date: '2026-08-01', amount: 100 },
      bothLegsTracked: true,
      bothLegsInRange: true,
      matchedAmount: 100,
      residualAmount: 0,
    });
  });

  it('produces an unmatched pair (legB undefined) for an orphaned leg', () => {
    const pairs = findTransferPairs([
      {
        id: 't1',
        account: 'a',
        date: '2026-07-31',
        amount: -100,
        transferId: 'x',
      },
    ]);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].legB).toBeUndefined();
    expect(pairs[0].bothLegsTracked).toBe(false);
    expect(pairs[0].matchedAmount).toBe(0);
  });

  it('ignores transactions with a null transfer_id', () => {
    const pairs = findTransferPairs([
      {
        id: 't1',
        account: 'a',
        date: '2026-07-31',
        amount: -100,
        transferId: null,
      },
      {
        id: 't2',
        account: 'b',
        date: '2026-08-01',
        amount: 100,
        transferId: null,
      },
    ]);

    expect(pairs).toHaveLength(0);
  });
});

describe('computeTransferAdjustments', () => {
  it('returns an empty adjustment map when there are no eligible pairs', () => {
    const pairs: TransferPair[] = [
      {
        transferId: 'x',
        legA: { account: 'a', date: '2026-07-31', amount: -100 },
        bothLegsTracked: false,
        bothLegsInRange: false,
        matchedAmount: 0,
        residualAmount: 0,
      },
    ];

    const adjustments = computeTransferAdjustments(
      pairs,
      ['2026-07', '2026-08'],
      'Monthly',
      '0',
    );

    expect(adjustments).toEqual({});
  });
});
