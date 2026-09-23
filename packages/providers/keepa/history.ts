export const KEEPA_TIME_OFFSET_MINUTES = 21_564_000;

export const KEEPA_PRICE_HISTORY_INDEX = {
  amazon: 0,
  marketplaceNew: 1,
  marketplaceUsed: 2,
  listPrice: 4,
} as const;

export type PricePoint = Readonly<{
  observedAt: string;
  amountMinor: number | null;
}>;

export function keepaTimeToUnixMilliseconds(keepaMinutes: number): number {
  if (!Number.isSafeInteger(keepaMinutes)) throw new TypeError('Invalid Keepa timestamp');
  const milliseconds = (keepaMinutes + KEEPA_TIME_OFFSET_MINUTES) * 60_000;
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError('Keepa timestamp is outside the safe range');
  return milliseconds;
}

export function decodePriceHistory(history: unknown): PricePoint[] {
  if (history === null || history === undefined) return [];
  if (!Array.isArray(history) || history.length % 2 !== 0) throw new TypeError('Invalid Keepa price history');

  const points: PricePoint[] = [];
  for (let index = 0; index < history.length; index += 2) {
    const keepaMinutes = history[index];
    const amountMinor = history[index + 1];
    if (!Number.isSafeInteger(keepaMinutes) || !Number.isSafeInteger(amountMinor)) {
      throw new TypeError('Invalid Keepa price history point');
    }
    if (amountMinor < -1) throw new TypeError('Unknown Keepa price sentinel');
    points.push({
      observedAt: new Date(keepaTimeToUnixMilliseconds(keepaMinutes)).toISOString(),
      amountMinor: amountMinor === -1 ? null : amountMinor,
    });
  }
  return points;
}
