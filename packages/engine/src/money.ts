import { Decimal } from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_EVEN });

export { Decimal };

export const d = (v: number | string | Decimal): Decimal => new Decimal(v);

/** Round to cents for reporting; internal math stays at full precision. */
export const toMoney = (v: Decimal): number => Number(v.toDecimalPlaces(2));

export const monthlyRate = (annualRatePct: number | Decimal): Decimal =>
  d(annualRatePct).div(100).div(12);

/** Advance a "YYYY-MM" key by n months. */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) throw new Error(`Invalid month key: ${month}`);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

export const calendarMonth = (month: string): number => Number(month.split('-')[1]);
