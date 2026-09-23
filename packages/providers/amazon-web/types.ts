export type Money = { currency: 'USD'; minorUnits: number };
export type SourceObservation = { observedAt: string; source: 'amazon-web'; contextRef: string };

export function money(text?: string | null): Money | undefined {
  if (!text) return undefined;
  const normalized = text.replace(/,/g, '');
  const match = normalized.match(/(?:US\$|\$)\s*(\d+(?:\.\d{1,2})?)/i) ?? normalized.match(/(\d+(?:\.\d{1,2})?)\s*(?:USD)/i);
  if (!match?.[1]) return undefined;
  return { currency: 'USD', minorUnits: Math.round(Number(match[1]) * 100) };
}

export function integer(text?: string | null): number | undefined {
  const match = text?.replace(/,/g, '').match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

export function rating(text?: string | null): number | undefined {
  const match = text?.match(/([0-5](?:\.\d+)?)\s*(?:out of 5|stars?)/i);
  return match?.[1] ? Number(match[1]) : undefined;
}

export function asinFrom(value?: string | null): string | undefined {
  if (!value) return undefined;
  const direct = value.trim().toUpperCase();
  if (/^[A-Z0-9]{10}$/.test(direct)) return direct;
  return value.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase();
}
