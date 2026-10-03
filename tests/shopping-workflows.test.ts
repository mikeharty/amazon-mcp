import { describe, it, expect, vi } from "vitest";
import {
  exportOrders,
  observedDate,
  researchProducts,
  searchOrders,
  researchInput,
  orderSearchInput,
} from "../packages/core/shopping-workflows.js";
import type {
  ShoppingProvider,
  Result,
  ProviderContext,
} from "../packages/contracts/index.js";
const ctx: ProviderContext = {
  ownerId: "fixture",
  accountRef: "fixture-account",
  sessionGeneration: 1,
  marketplace: "amazon.com",
};
const provider = (read: ShoppingProvider["read"]): ShoppingProvider => ({
  read,
  mutate: vi.fn().mockRejectedValue(new Error("No writes")),
  close: async () => {},
});
const order = (
  id: string,
  date = "September 20, 2026",
  title = "Fixture mug",
) => ({
  orderId: id,
  date,
  total: { currency: "USD", minorUnits: 1000 },
  lines: [{ asin: "B000000001", title }],
});
function page(orders: unknown[], currentPage = 1, hasNextPage = false): Result {
  return {
    status: "partial",
    observation: {
      observedAt: "2026-10-02T12:00:00Z",
      source: "amazon-web",
      contextRef: ctx.accountRef,
      authentication: "verified",
    },
    data: {
      recognized: true,
      orders,
      pagination: {
        currentPage,
        hasNextPage,
        nextPage: hasNextPage ? currentPage + 1 : undefined,
      },
    },
  };
}
describe("bounded purchase history workflows", () => {
  it("deduplicates pages, filters observed dates/titles and keeps totals at order level", async () => {
    const first = order("111-2222222-3333333"),
      second = order("111-2222222-4444444", "September 22, 2026", "Mug lid");
    const read = vi
      .fn()
      .mockResolvedValueOnce(page([first], 1, true))
      .mockResolvedValueOnce(
        page([first, second, order("111-2222222-5555555", "unknown")], 2),
      );
    const result = await searchOrders(
      provider(read),
      { query: "mug", dateFrom: "2026-09-21" },
      ctx,
    );
    expect(result).toMatchObject({
      status: "partial",
      data: {
        orders: [{ orderId: second.orderId }],
        scannedPages: [1, 2],
        scannedOrders: 3,
        unknownDatesExcluded: 1,
        stopReason: "end_of_observed_view",
        summary: {
          matchedOrders: 1,
          observedOrderTotals: { minorUnits: 1000 },
        },
      },
      coverage: { complete: false },
    });
  });
  it("returns a continuation at the page bound and stops on repeated or wrong pages", async () => {
    const read = vi
      .fn()
      .mockResolvedValue(page([order("111-2222222-3333333")], 1, true));
    expect(
      await searchOrders(provider(read), { maxPages: 1 }, ctx),
    ).toMatchObject({ data: { nextPage: 2, stopReason: "page_limit" } });
    read.mockClear();
    expect(
      await searchOrders(provider(read), { maxPages: 5 }, ctx),
    ).toMatchObject({
      data: { scannedPages: [1], stopReason: "unverified_page" },
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("preserves partial results and stops all navigation on a human challenge", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(page([order("111-2222222-3333333")], 1, true))
      .mockResolvedValueOnce({
        status: "requires_user_action",
        action: { kind: "signin" },
      });
    expect(await searchOrders(provider(read), {}, ctx)).toMatchObject({
      status: "requires_user_action",
      action: { kind: "signin" },
      data: { scannedPages: [1], nextPage: 2, stopReason: "human_handoff" },
    });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("does not accept an unverified empty page or make an exhaustive-history claim", async () => {
    const result = page([]);
    delete result.observation;
    expect(
      await searchOrders(
        provider(async () => result),
        {},
        ctx,
      ),
    ).toMatchObject({
      data: { scannedPages: [], stopReason: "unverified_page" },
      coverage: { complete: false },
    });
  });
  it("escapes CSV formulas and preserves raw data only in JSON, with coverage", async () => {
    const result = await searchOrders(
      provider(async () =>
        page([order("111-2222222-3333333", "2026-09-20", '=HYPERLINK("bad")')]),
      ),
      {},
      ctx,
    );
    expect(exportOrders(result.data, "csv").text).toContain(
      '"\'=HYPERLINK(""bad"")"',
    );
    expect(exportOrders(result.data, "json").coverage.complete).toBe(false);
    expect(
      JSON.parse(exportOrders(result.data, "json").text).orders[0].lines[0]
        .title,
    ).toBe('=HYPERLINK("bad")');
  });
  it("rejects reversed ranges, impossible dates, and ambiguous localized dates", () => {
    expect(
      orderSearchInput.safeParse({
        dateFrom: "2026-10-01",
        dateTo: "2026-09-01",
      }).success,
    ).toBe(false);
    expect(observedDate("February 30, 2026")).toBeUndefined();
    expect(observedDate("01/02/2026")).toBeUndefined();
  });
});
describe("product research with explainable preferences", () => {
  const asins = ["B000000001", "B000000002", "B000000003"];
  const read = async (
    _: string,
    input: Record<string, unknown>,
  ): Promise<Result> => ({
    status: "partial",
    data: {
      asin: input.asin,
      title: "Fixture mug",
      price:
        input.asin === asins[2]
          ? undefined
          : {
              currency: "USD",
              minorUnits: input.asin === asins[0] ? 1000 : 2000,
            },
      rating: 4,
      reviewCount: 20,
      features: input.asin === asins[1] ? ["Dishwasher safe"] : [],
    },
    observation: {
      source: "amazon-web",
      observedAt: "2026-10-02T12:00:00Z",
      contextRef: ctx.accountRef,
    },
  });
  it("ranks the cheaper candidate by default without turning unknown prices into bargains", async () => {
    const result = await researchProducts(provider(read), { asins }, ctx);
    expect(result).toMatchObject({
      status: "partial",
      data: {
        recommendedAsin: asins[0],
        items: [
          { asin: asins[0] },
          { asin: asins[1] },
          { asin: asins[2], score: null, missing: ["price"] },
        ],
      },
    });
  });
  it("lets explicit feature weights change the recommendation with a source excerpt", async () => {
    const result = await researchProducts(
      provider(read),
      {
        asins: asins.slice(0, 2),
        desiredFeatures: ["dishwasher"],
        weights: { price: 1, rating: 0, features: 10 },
      },
      ctx,
    );
    expect(result).toMatchObject({
      data: {
        recommendedAsin: asins[1],
        items: expect.arrayContaining([
          expect.objectContaining({
            featureEvidence: [
              { term: "dishwasher", excerpt: "Dishwasher safe", matched: true },
            ],
          }),
        ]),
      },
    });
    expect((result.data as { items: unknown[] }).items).toHaveLength(2);
  });
  it("excludes over-budget products and unknown prices from a budget recommendation", async () => {
    const result = await researchProducts(
      provider(read),
      { asins, budgetMinorUnits: 500 },
      ctx,
    );
    expect(result).toMatchObject({ data: { recommendedAsin: null } });
  });
  it("rejects mismatched products and stops comparisons on authentication handoff", async () => {
    const result = await researchProducts(
      provider(async () => ({
        status: "ok",
        data: { asin: "B999999999", title: "Wrong product" },
      })),
      { asins },
      ctx,
    );
    expect(result).toMatchObject({
      data: { items: [], recommendedAsin: null },
    });
    const call = vi.fn().mockResolvedValue({ status: "requires_user_action" });
    expect(
      await researchProducts(provider(call), { asins }, ctx),
    ).toMatchObject({
      status: "requires_user_action",
      data: { comparisonAvailable: false },
    });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does not count explicitly negated feature mentions as support", async () => {
    const result = await researchProducts(
      provider(async (_kind, i) => ({
        status: "ok",
        data: { asin: i.asin, title: "Not dishwasher safe" },
      })),
      {
        asins: asins.slice(0, 2),
        desiredFeatures: ["dishwasher safe"],
        weights: { price: 0, rating: 0, features: 1 },
      },
      ctx,
    );
    expect(result).toMatchObject({ data: { recommendedAsin: null } });
    expect(
      (
        result.data as {
          items: Array<{ featureEvidence: Array<{ matched: boolean }> }>;
        }
      ).items[0]?.featureEvidence[0]?.matched,
    ).toBe(false);
  });
  it("rejects duplicate candidates and zero applicable weights", () => {
    expect(
      researchInput.safeParse({ asins: [asins[0], asins[0]] }).success,
    ).toBe(false);
    expect(
      researchInput.safeParse({
        asins,
        weights: { price: 0, rating: 0, features: 1 },
      }).success,
    ).toBe(false);
  });
});
