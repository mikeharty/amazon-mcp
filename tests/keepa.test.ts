import { describe, expect, it, vi } from "vitest";

import {
  createKeepaProvider,
  decodePriceHistory,
  keepaTimeToUnixMilliseconds,
} from "../packages/providers/keepa/index.js";

describe("Keepa provider", () => {
  it("is disabled without credentials and never contacts the network", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const provider = createKeepaProvider({ fetch });

    expect(provider.enabled).toBe(false);
    expect(await provider.productHistory({ asins: ["B00M0QVG3W"] })).toEqual(
      expect.objectContaining({
        status: "unsupported",
        error: { code: "keepa_not_configured" },
      }),
    );
    expect(await provider.sellers({ sellerIds: ["A2L77EE7U53NWQ"] })).toEqual(
      expect.objectContaining({
        status: "unsupported",
        error: { code: "keepa_not_configured" },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requests bounded stored product history and decodes price observations", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        tokensLeft: 24,
        tokensConsumed: 1,
        refillRate: 5,
        refillIn: 42_000,
        products: [
          {
            asin: "B00M0QVG3W",
            title: "Camera",
            lastUpdate: 7_664_520,
            csv: [[0, 2999, 1, -1], [0, 2799], null, null, [0, 3999]],
          },
        ],
      }),
    );
    const provider = createKeepaProvider({ apiKey: "private-key", fetch });

    const result = await provider.productHistory({
      asins: ["b00m0qvg3w"],
      days: 90,
    });

    expect(result.status).toBe("partial");
    expect(result.tokens).toEqual({
      tokensLeft: 24,
      tokensConsumed: 1,
      refillRate: 5,
      refillInMs: 42_000,
    });
    expect(result.data?.[0]).toEqual(
      expect.objectContaining({
        asin: "B00M0QVG3W",
        marketplace: "amazon.com",
        requestedDays: 90,
        histories: expect.objectContaining({
          amazon: {
            currency: "USD",
            shippingIncluded: false,
            points: [
              { observedAt: "2011-01-01T00:00:00.000Z", amountMinor: 2999 },
              { observedAt: "2011-01-01T00:01:00.000Z", amountMinor: null },
            ],
          },
        }),
      }),
    );

    const requestedUrl = fetch.mock.calls[0]![0] as URL;
    expect(requestedUrl.origin).toBe("https://api.keepa.com");
    expect(requestedUrl.pathname).toBe("/product");
    expect(requestedUrl.searchParams.get("history")).toBe("1");
    expect(requestedUrl.searchParams.get("days")).toBe("90");
    expect(requestedUrl.searchParams.get("update")).toBe("-1");
    expect(requestedUrl.searchParams.has("offers")).toBe(false);
  });

  it("normalizes seller information without requesting paid storefront data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        tokensLeft: 9,
        tokensConsumed: 1,
        refillRate: 1,
        refillIn: 10_000,
        sellers: {
          A2L77EE7U53NWQ: {
            sellerId: "A2L77EE7U53NWQ",
            sellerName: "Amazon Warehouse",
            businessName: "Amazon.com Services LLC",
            address: ["Seattle", "US"],
            hasFBA: true,
            lastUpdate: 7_661_520,
            positiveRating: [96, 98, 98, 95],
            ratingCount: [10, 20, 30, 40],
          },
        },
      }),
    );
    const provider = createKeepaProvider({ apiKey: "private-key", fetch });

    const result = await provider.sellers({ sellerIds: ["A2L77EE7U53NWQ"] });

    expect(result.status).toBe("partial");
    expect(result.data).toEqual([
      expect.objectContaining({
        sellerId: "A2L77EE7U53NWQ",
        name: "Amazon Warehouse",
        hasFba: true,
        positiveRatingPercent: [96, 98, 98, 95],
        source: "keepa",
      }),
    ]);
    const requestedUrl = fetch.mock.calls[0]![0] as URL;
    expect(requestedUrl.pathname).toBe("/seller");
    expect(requestedUrl.searchParams.get("storefront")).toBe("0");
  });

  it("bounds token-spending batch size before fetch and suppresses API keys in failures", async () => {
    const secret = "super-secret-keepa-key";
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(
        new Error(
          `network failed for https://api.keepa.com/product?key=${secret}`,
        ),
      );
    const provider = createKeepaProvider({
      apiKey: secret,
      fetch,
      maxItemsPerRequest: 1,
    });

    const rejected = await provider.productHistory({
      asins: ["B00M0QVG3W", "B0F3GWXLTS"],
    });
    expect(rejected).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "invalid_request" },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();

    const failed = await provider.productHistory({ asins: ["B00M0QVG3W"] });
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "provider_error" },
      }),
    );
    expect(JSON.stringify(failed)).not.toContain(secret);
  });

  it("reserves estimated tokens when a call fails without token metadata and returns invalid days safely", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockRejectedValue(new Error("timeout"));
    const provider = createKeepaProvider({
      apiKey: "private-key",
      fetch,
      maxTokensPerSession: 1,
    });

    const invalidDays = await provider.productHistory({
      asins: ["B00M0QVG3W"],
      days: 0,
    });
    expect(invalidDays).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "invalid_request" },
      }),
    );
    expect(fetch).not.toHaveBeenCalled();

    expect(await provider.productHistory({ asins: ["B00M0QVG3W"] })).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "provider_error" },
      }),
    );
    expect(await provider.productHistory({ asins: ["B00M0QVG3W"] })).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "session_budget_exhausted" },
      }),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("honors the returned token refill window before making another paid call", async () => {
    let now = 1_000_000;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        jsonResponse(
          {
            tokensLeft: 0,
            tokensConsumed: 1,
            refillRate: 1,
            refillIn: 5_000,
            products: [],
          },
          { status: 429 },
        ),
      );
    const provider = createKeepaProvider({
      apiKey: "private-key",
      fetch,
      now: () => now,
    });

    const first = await provider.productHistory({ asins: ["B00M0QVG3W"] });
    const second = await provider.productHistory({ asins: ["B00M0QVG3W"] });

    expect(first.error).toEqual({
      code: "rate_limited",
      retryAt: new Date(1_005_000).toISOString(),
    });
    expect(second.error).toEqual({
      code: "rate_limited",
      retryAt: new Date(1_005_000).toISOString(),
    });
    expect(fetch).toHaveBeenCalledOnce();

    now = 1_005_000;
    await provider.productHistory({ asins: ["B00M0QVG3W"] });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects unexpected returned ASINs and enforces a local session budget", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        tokensLeft: 10,
        tokensConsumed: 1,
        refillRate: 1,
        refillIn: 5_000,
        products: [{ asin: "B0F3GWXLTS", csv: [] }],
      }),
    );
    const provider = createKeepaProvider({
      apiKey: "private-key",
      fetch,
      maxCallsPerSession: 1,
      maxTokensPerSession: 1,
    });

    const mismatched = await provider.productHistory({ asins: ["B00M0QVG3W"] });
    expect(mismatched).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "provider_error" },
      }),
    );

    const overBudget = await provider.productHistory({ asins: ["B00M0QVG3W"] });
    expect(overBudget).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "session_budget_exhausted" },
      }),
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects duplicate products even when the response count matches the request count", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      jsonResponse({
        tokensLeft: 8,
        tokensConsumed: 2,
        refillRate: 1,
        refillIn: 5_000,
        products: [
          { asin: "B00M0QVG3W", csv: [] },
          { asin: "B00M0QVG3W", csv: [] },
        ],
      }),
    );
    const provider = createKeepaProvider({ apiKey: "private-key", fetch });

    const result = await provider.productHistory({
      asins: ["B00M0QVG3W", "B0F3GWXLTS"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: "failed",
        error: { code: "provider_error" },
      }),
    );
  });
});

describe("Keepa history decoder", () => {
  it("converts Keepa minutes and represents unavailable prices as null", () => {
    expect(keepaTimeToUnixMilliseconds(0)).toBe(Date.UTC(2011, 0, 1));
    expect(decodePriceHistory([0, 1234, 60, -1])).toEqual([
      { observedAt: "2011-01-01T00:00:00.000Z", amountMinor: 1234 },
      { observedAt: "2011-01-01T01:00:00.000Z", amountMinor: null },
    ]);
  });

  it("rejects malformed history instead of returning shifted observations", () => {
    expect(() => decodePriceHistory([0, 1234, 60])).toThrow(
      "Invalid Keepa price history",
    );
    expect(() => decodePriceHistory([0, 12.34])).toThrow(
      "Invalid Keepa price history point",
    );
    expect(() => decodePriceHistory([0, -2])).toThrow(
      "Unknown Keepa price sentinel",
    );
  });
});

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}
