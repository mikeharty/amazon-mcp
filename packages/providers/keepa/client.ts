import { decodePriceHistory, KEEPA_PRICE_HISTORY_INDEX, keepaTimeToUnixMilliseconds, type PricePoint } from './history.js';

const DEFAULT_BASE_URL = 'https://api.keepa.com/';
const DEFAULT_MAX_ITEMS = 10;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export type KeepaTokenState = Readonly<{
  tokensLeft?: number;
  tokensConsumed?: number;
  refillRate?: number;
  refillInMs?: number;
}>;

export type KeepaError = Readonly<{
  code: 'keepa_not_configured' | 'invalid_request' | 'rate_limited' | 'session_budget_exhausted' | 'provider_error';
  retryAt?: string;
}>;

export type KeepaResult<T> = Readonly<{
  status: 'ok' | 'partial' | 'unsupported' | 'failed';
  data?: T;
  tokens?: KeepaTokenState;
  coverage: Readonly<{ complete: false; missing: readonly string[]; reason: string }>;
  error?: KeepaError;
}>;

export type ProductPriceHistory = Readonly<{
  asin: string;
  marketplace: 'amazon.com';
  title?: string;
  source: 'keepa';
  sourceUpdatedAt?: string;
  requestedDays: number;
  histories: Readonly<{
    amazon: PriceSeries;
    marketplaceNew: PriceSeries;
    marketplaceUsed: PriceSeries;
    listPrice: PriceSeries;
  }>;
}>;

export type PriceSeries = Readonly<{
  currency: 'USD';
  shippingIncluded: false;
  points: readonly PricePoint[];
}>;

export type KeepaSeller = Readonly<{
  sellerId: string;
  marketplace: 'amazon.com';
  name?: string;
  businessName?: string;
  address?: readonly string[];
  hasFba?: boolean;
  updatedAt?: string;
  positiveRatingPercent?: readonly number[];
  ratingCount?: readonly number[];
  source: 'keepa';
}>;

export type KeepaProvider = Readonly<{
  enabled: boolean;
  productHistory(input: { asins: readonly string[]; days?: number }): Promise<KeepaResult<readonly ProductPriceHistory[]>>;
  sellers(input: { sellerIds: readonly string[] }): Promise<KeepaResult<readonly KeepaSeller[]>>;
}>;

export type KeepaProviderOptions = Readonly<{
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  maxItemsPerRequest?: number;
  maxCallsPerSession?: number;
  maxTokensPerSession?: number;
  maxResponseBytes?: number;
  timeoutMs?: number;
  now?: () => number;
}>;

export function createKeepaProvider(options: KeepaProviderOptions = {}): KeepaProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return disabledProvider();
  const configuredApiKey = apiKey;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = validatedBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const maxItems = boundedInteger(options.maxItemsPerRequest ?? DEFAULT_MAX_ITEMS, 1, 100, 'maxItemsPerRequest');
  const maxCalls = boundedInteger(options.maxCallsPerSession ?? 100, 1, 10_000, 'maxCallsPerSession');
  const maxTokens = boundedInteger(options.maxTokensPerSession ?? 100, 1, 100_000, 'maxTokensPerSession');
  const maxResponseBytes = boundedInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    1,
    50 * 1024 * 1024,
    'maxResponseBytes',
  );
  const timeoutMs = boundedInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1, 60_000, 'timeoutMs');
  const now = options.now ?? Date.now;
  let blockedUntil = 0;
  let callsStarted = 0;
  let tokensCommitted = 0;
  let queue: Promise<void> = Promise.resolve();

  async function request(
    endpoint: 'product' | 'seller',
    params: URLSearchParams,
    estimatedTokens: number,
  ): Promise<KeepaResult<unknown>> {
    const operation = async (): Promise<KeepaResult<unknown>> => {
      if (callsStarted >= maxCalls || tokensCommitted + estimatedTokens > maxTokens) {
        return failure('session_budget_exhausted', 'The configured Keepa session budget is exhausted');
      }
      if (now() < blockedUntil) {
        return failure('rate_limited', 'Keepa token bucket has not refilled', new Date(blockedUntil).toISOString());
      }
      callsStarted += 1;
      tokensCommitted += estimatedTokens;

      const url = new URL(endpoint, baseUrl);
      params.set('key', configuredApiKey);
      url.search = params.toString();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json', 'accept-encoding': 'gzip' },
          redirect: 'error',
          signal: controller.signal,
        });
        const payload = await readBoundedJson(response, maxResponseBytes);
        const tokens = readTokenState(payload);
        tokensCommitted += Math.max(0, (tokens.tokensConsumed ?? estimatedTokens) - estimatedTokens);
        if (tokens.tokensLeft !== undefined && tokens.tokensLeft <= 0 && tokens.refillInMs !== undefined) {
          blockedUntil = now() + Math.max(0, tokens.refillInMs);
        }
        if (!response.ok || hasProviderError(payload)) {
          const retryAt = response.status === 429 && blockedUntil > now() ? new Date(blockedUntil).toISOString() : undefined;
          return {
            ...failure(response.status === 429 ? 'rate_limited' : 'provider_error', 'Keepa request failed', retryAt),
            tokens,
          };
        }
        return {
          status: 'ok',
          data: payload,
          tokens,
          coverage: incompleteCoverage('Keepa coverage depends on its observation history and source availability.'),
        };
      } catch {
        return failure('provider_error', 'Keepa request failed');
      } finally {
        clearTimeout(timeout);
      }
    };

    const scheduled = queue.then(operation, operation);
    queue = scheduled.then(() => undefined, () => undefined);
    return scheduled;
  }

  return {
    enabled: true,
    async productHistory({ asins, days = 365 }) {
      const validAsins = validateIdentifiers(asins, /^[A-Z0-9]{10}$/, maxItems, 'ASIN');
      if (!validAsins.ok) return invalidRequest(validAsins.reason);
      let validDays: number;
      try {
        validDays = boundedInteger(days, 1, 3650, 'days');
      } catch {
        return invalidRequest('Invalid history window');
      }

      const response = await request(
        'product',
        new URLSearchParams({
          domain: '1',
          asin: validAsins.values.join(','),
          history: '1',
          days: String(validDays),
          update: '-1',
        }),
        validAsins.values.length,
      );
      if (response.status !== 'ok') return response as KeepaResult<readonly ProductPriceHistory[]>;

      try {
        const payload = asRecord(response.data);
        const products = Array.isArray(payload.products) ? payload.products : [];
        const requestedAsins = new Set(validAsins.values);
        const productsByAsin = new Map<string, ProductPriceHistory>();
        for (const product of products) {
          const decodedProduct = decodeProduct(product, validDays);
          if (!requestedAsins.has(decodedProduct.asin) || productsByAsin.has(decodedProduct.asin)) {
            throw new TypeError('Unexpected or duplicate ASIN in Keepa response');
          }
          productsByAsin.set(decodedProduct.asin, decodedProduct);
        }
        const decoded = validAsins.values.flatMap((asin) => {
          const product = productsByAsin.get(asin);
          return product ? [product] : [];
        });
        return {
          ...response,
          status: 'partial',
          data: decoded,
          coverage: incompleteCoverage(
            decoded.length === validAsins.values.length
              ? 'Keepa history is observational and may contain gaps.'
              : 'One or more requested ASINs were absent; Keepa history is observational and may contain gaps.',
            decoded.length === validAsins.values.length ? ['historical observation gaps'] : ['missing ASINs', 'historical observation gaps'],
          ),
        };
      } catch {
        return { ...failure('provider_error', 'Invalid Keepa response'), tokens: response.tokens };
      }
    },
    async sellers({ sellerIds }) {
      const validIds = validateIdentifiers(sellerIds, /^[A-Z0-9]{4,32}$/, maxItems, 'seller ID');
      if (!validIds.ok) return invalidRequest(validIds.reason);

      const response = await request(
        'seller',
        new URLSearchParams({ domain: '1', seller: validIds.values.join(','), storefront: '0' }),
        validIds.values.length,
      );
      if (response.status !== 'ok') return response as KeepaResult<readonly KeepaSeller[]>;

      try {
        const payload = asRecord(response.data);
        const sellers = asRecord(payload.sellers);
        const decoded = validIds.values.flatMap((sellerId) => {
          const seller = sellers[sellerId];
          return seller === undefined ? [] : [decodeSeller(seller, sellerId)];
        });
        return {
          ...response,
          status: 'partial',
          data: decoded,
          coverage: incompleteCoverage(
            decoded.length === validIds.values.length
              ? 'Keepa seller data can be stale or incomplete; storefront data was not requested.'
              : 'One or more sellers were absent; Keepa seller data can be stale or incomplete.',
            decoded.length === validIds.values.length
              ? ['live Amazon seller state', 'storefront inventory']
              : ['missing sellers', 'live Amazon seller state', 'storefront inventory'],
          ),
        };
      } catch {
        return { ...failure('provider_error', 'Invalid Keepa response'), tokens: response.tokens };
      }
    },
  };
}

function disabledProvider(): KeepaProvider {
  const result = (): KeepaResult<never> => ({
    status: 'unsupported',
    coverage: incompleteCoverage('Keepa is disabled because no API key is configured.', ['all Keepa data']),
    error: { code: 'keepa_not_configured' },
  });
  return {
    enabled: false,
    productHistory: async () => result(),
    sellers: async () => result(),
  };
}

function decodeProduct(value: unknown, requestedDays: number): ProductPriceHistory {
  const product = asRecord(value);
  const asin = requiredString(product.asin);
  const csv = Array.isArray(product.csv) ? product.csv : [];
  return {
    asin,
    marketplace: 'amazon.com',
    title: optionalString(product.title),
    source: 'keepa',
    sourceUpdatedAt: optionalKeepaTime(product.lastUpdate),
    requestedDays,
    histories: {
      amazon: priceSeries(csv[KEEPA_PRICE_HISTORY_INDEX.amazon]),
      marketplaceNew: priceSeries(csv[KEEPA_PRICE_HISTORY_INDEX.marketplaceNew]),
      marketplaceUsed: priceSeries(csv[KEEPA_PRICE_HISTORY_INDEX.marketplaceUsed]),
      listPrice: priceSeries(csv[KEEPA_PRICE_HISTORY_INDEX.listPrice]),
    },
  };
}

function priceSeries(history: unknown): PriceSeries {
  return {
    currency: 'USD',
    shippingIncluded: false,
    points: decodePriceHistory(history),
  };
}

function decodeSeller(value: unknown, expectedSellerId: string): KeepaSeller {
  const seller = asRecord(value);
  const sellerId = requiredString(seller.sellerId);
  if (sellerId !== expectedSellerId) throw new TypeError('Mismatched seller ID');
  return {
    sellerId,
    marketplace: 'amazon.com',
    name: optionalString(seller.sellerName),
    businessName: optionalString(seller.businessName),
    address: optionalStringArray(seller.address),
    hasFba: typeof seller.hasFBA === 'boolean' ? seller.hasFBA : undefined,
    updatedAt: optionalKeepaTime(seller.lastUpdate),
    positiveRatingPercent: optionalIntegerArray(seller.positiveRating),
    ratingCount: optionalIntegerArray(seller.ratingCount),
    source: 'keepa',
  };
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maxBytes) throw new TypeError('Keepa response too large');
  if (!response.body) throw new TypeError('Keepa response body missing');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maxBytes) {
        await reader.cancel('Keepa response too large');
        throw new TypeError('Keepa response too large');
      }
      length += value.byteLength;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function readTokenState(payload: unknown): KeepaTokenState {
  const value = asRecord(payload);
  return {
    tokensLeft: optionalNumber(value.tokensLeft),
    tokensConsumed: optionalNumber(value.tokensConsumed),
    refillRate: optionalNumber(value.refillRate),
    refillInMs: optionalNumber(value.refillIn),
  };
}

function validateIdentifiers(
  values: readonly string[],
  pattern: RegExp,
  maxItems: number,
  label: string,
): { ok: true; values: string[] } | { ok: false; reason: string } {
  const normalized = [...new Set(values.map((value) => value.trim().toUpperCase()))];
  if (normalized.length === 0) return { ok: false, reason: `At least one ${label} is required` };
  if (normalized.length > maxItems) return { ok: false, reason: `At most ${maxItems} ${label}s are allowed` };
  if (normalized.some((value) => !pattern.test(value))) return { ok: false, reason: `Invalid ${label}` };
  return { ok: true, values: normalized };
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new TypeError('Keepa base URL must use HTTPS');
  }
  return url;
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function incompleteCoverage(reason: string, missing: readonly string[] = ['complete historical coverage']) {
  return { complete: false as const, missing, reason };
}

function invalidRequest(_reason: string): KeepaResult<never> {
  return {
    status: 'failed',
    coverage: incompleteCoverage('The request was rejected before contacting Keepa.'),
    error: { code: 'invalid_request' },
  };
}

function failure(code: KeepaError['code'], reason: string, retryAt?: string): KeepaResult<never> {
  return {
    status: code === 'keepa_not_configured' ? 'unsupported' : 'failed',
    coverage: incompleteCoverage(reason),
    error: { code, retryAt },
  };
}

function hasProviderError(payload: unknown): boolean {
  return typeof asRecord(payload).error === 'object' && asRecord(payload).error !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Expected object');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new TypeError('Expected string');
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalIntegerArray(value: unknown): number[] | undefined {
  return Array.isArray(value) && value.every(Number.isSafeInteger) ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : undefined;
}

function optionalKeepaTime(value: unknown): string | undefined {
  return Number.isSafeInteger(value) ? new Date(keepaTimeToUnixMilliseconds(value as number)).toISOString() : undefined;
}
