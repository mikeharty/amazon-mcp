import { z } from "zod";
import {
  DomainError,
  type ProviderContext,
  type Result,
  type ShoppingProvider,
} from "../contracts/index.js";

const asin = z.string().regex(/^[A-Z0-9]{10}$/);
export const orderSearchInput = z
  .object({
    query: z.string().trim().max(200).default(""),
    dateFrom: z.iso.date().optional(),
    dateTo: z.iso.date().optional(),
    startPage: z.number().int().min(1).max(10).default(1),
    maxPages: z.number().int().min(1).max(10).default(5),
  })
  .strict()
  .refine(
    (i) => !i.dateFrom || !i.dateTo || i.dateFrom <= i.dateTo,
    "dateFrom must precede dateTo",
  );
export const researchInput = z
  .object({
    asins: z
      .array(asin)
      .min(2)
      .max(5)
      .refine((a) => new Set(a).size === a.length, "Use distinct ASINs"),
    desiredFeatures: z
      .array(z.string().trim().min(1).max(80))
      .max(10)
      .default([]),
    budgetMinorUnits: z
      .number()
      .int()
      .nonnegative()
      .max(100_000_000)
      .optional(),
    weights: z
      .object({
        price: z.number().min(0).max(10),
        rating: z.number().min(0).max(10),
        features: z.number().min(0).max(10),
      })
      .strict()
      .default({ price: 5, rating: 3, features: 2 }),
  })
  .strict()
  .refine(
    (i) =>
      i.weights.price +
        i.weights.rating +
        (i.desiredFeatures.length ? i.weights.features : 0) >
      0,
    "Choose at least one applicable weight",
  );
const money = z.object({
  currency: z.literal("USD"),
  minorUnits: z.number().int().nonnegative().max(100_000_000),
});
const order = z.object({
  orderId: z.string().regex(/^\d{3}-\d{7}-\d{7}$/),
  date: z.string().optional(),
  total: money.optional(),
  status: z.string().optional(),
  lines: z
    .array(z.object({ asin, title: z.string(), url: z.string().optional() }))
    .default([]),
});
const product = z.object({
  asin,
  title: z.string().min(1),
  price: money.optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  availability: z.string().optional(),
  features: z.array(z.string()).default([]),
  attributes: z.record(z.string(), z.string()).default({}),
  media: z
    .array(
      z.object({
        kind: z.string(),
        url: z.string(),
        alt: z.string().optional(),
      }),
    )
    .default([]),
});

export function observedDate(value?: string): string | undefined {
  if (!value) return;
  if (z.iso.date().safeParse(value).success) return value;
  const match =
    /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/i.exec(
      value.trim(),
    );
  if (!match) return;
  const month =
    [
      "january",
      "february",
      "march",
      "april",
      "may",
      "june",
      "july",
      "august",
      "september",
      "october",
      "november",
      "december",
    ].indexOf(match[1]!.toLowerCase()) + 1;
  const date = `${match[3]}-${String(month).padStart(2, "0")}-${match[2]!.padStart(2, "0")}`;
  return z.iso.date().safeParse(date).success ? date : undefined;
}

export async function searchOrders(
  provider: ShoppingProvider,
  input: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<Result> {
  const args = orderSearchInput.parse(input);
  const seen = new Map<string, z.infer<typeof order> & { dateISO?: string }>();
  const pages: number[] = [];
  let nextPage: number | undefined = args.startPage,
    stopReason = "page_limit",
    unknownDates = 0;
  let handoff: Result | undefined;
  for (
    let n = 0;
    n < args.maxPages && nextPage !== undefined && nextPage <= 10;
    n++
  ) {
    const page: number = nextPage;
    const result = await provider.read("orders_list", { page }, ctx);
    if (result.status === "requires_user_action") {
      handoff = result;
      stopReason = "human_handoff";
      break;
    }
    const data = z
      .object({
        recognized: z.literal(true),
        unparsedCount: z.number().default(0),
        orders: z.array(order),
        pagination: z.object({
          currentPage: z.number().optional(),
          hasNextPage: z.boolean().optional(),
          nextPage: z.number().optional(),
        }),
      })
      .safeParse(result.data);
    if (
      !["ok", "partial"].includes(result.status) ||
      result.observation?.authentication !== "verified" ||
      result.coverage?.missing.some((m) => m.startsWith("required:")) ||
      !data.success ||
      data.data.unparsedCount > 0 ||
      (data.data.pagination.currentPage !== undefined
        ? data.data.pagination.currentPage !== page
        : page !== 1)
    ) {
      stopReason = "unverified_page";
      break;
    }
    pages.push(page);
    let added = 0;
    for (const item of data.data.orders)
      if (!seen.has(item.orderId)) {
        seen.set(item.orderId, { ...item, dateISO: observedDate(item.date) });
        added++;
      }
    const pagination = data.data.pagination;
    if (pagination.hasNextPage === false) {
      nextPage = undefined;
      stopReason = "end_of_observed_view";
      break;
    }
    if (
      pagination.hasNextPage !== true ||
      pagination.nextPage !== page + 1 ||
      (n > 0 && added === 0)
    ) {
      nextPage = undefined;
      stopReason = "pagination_unverified";
      break;
    }
    nextPage = pagination.nextPage;
  }
  const orders = [...seen.values()].filter((item) => {
    if ((args.dateFrom || args.dateTo) && !item.dateISO) {
      unknownDates++;
      return false;
    }
    return (
      (!args.dateFrom || item.dateISO! >= args.dateFrom) &&
      (!args.dateTo || item.dateISO! <= args.dateTo) &&
      `${item.orderId} ${item.lines.map((l) => `${l.title} ${l.asin}`).join(" ")}`
        .toLowerCase()
        .includes(args.query.toLowerCase())
    );
  });
  const priced = orders.filter((o) => o.total);
  return {
    status: handoff ? "requires_user_action" : "partial",
    ...(handoff?.action ? { action: handoff.action } : {}),
    data: {
      orders,
      scannedPages: pages,
      scannedOrders: seen.size,
      nextPage: nextPage && nextPage <= 10 ? nextPage : undefined,
      stopReason,
      unknownDatesExcluded: unknownDates,
      summary: {
        matchedOrders: orders.length,
        observedOrderTotals: {
          currency: "USD",
          minorUnits: priced.reduce((sum, o) => sum + o.total!.minorUnits, 0),
        },
        missingTotals: orders.length - priced.length,
        basis:
          "Displayed whole-order totals; not item spending, net refunds, or lifetime spending.",
      },
      scope:
        "Current Amazon order-history view only; date filters do not change Amazon's selected history window.",
    },
    observation: {
      source: "amazon-web",
      observedAt: new Date().toISOString(),
      contextRef: ctx.accountRef,
      ...(pages.length ? { authentication: "verified" as const } : {}),
    },
    coverage: {
      complete: false,
      missing: [
        "exhaustive_history",
        ...(stopReason === "end_of_observed_view" ? [] : [stopReason]),
        ...(unknownDates ? ["unrecognized_dates"] : []),
      ],
    },
  };
}

export async function researchProducts(
  provider: ShoppingProvider,
  input: Record<string, unknown>,
  ctx: ProviderContext,
): Promise<Result> {
  const args = researchInput.parse(input);
  const items: Array<
    z.infer<typeof product> & { observedAt?: string; sourceCoverage: string[] }
  > = [];
  const unavailable: Array<{ asin: string; reason: string }> = [];
  for (const asin of args.asins) {
    const result = await provider.read("products_get", { asin }, ctx);
    if (result.status === "requires_user_action")
      return {
        ...result,
        data: {
          fetchedAsins: items.map((p) => p.asin),
          comparisonAvailable: false,
        },
      };
    const parsed = product.safeParse(result.data);
    if (
      !["ok", "partial"].includes(result.status) ||
      !parsed.success ||
      parsed.data.asin !== asin ||
      result.coverage?.missing.some((m) => m.startsWith("required:"))
    ) {
      unavailable.push({
        asin,
        reason: "Product identity or required evidence unavailable",
      });
      continue;
    }
    items.push({
      ...parsed.data,
      observedAt: result.observation?.observedAt,
      sourceCoverage: result.coverage?.missing ?? [],
    });
  }
  const prices = items.flatMap((p) => (p.price ? [p.price.minorUnits] : []));
  const low = Math.min(...prices),
    high = Math.max(...prices);
  const weights = {
    ...args.weights,
    features: args.desiredFeatures.length ? args.weights.features : 0,
  };
  const totalWeight = weights.price + weights.rating + weights.features;
  const ranked = items
    .map((p) => {
      const text = [
        p.title,
        ...p.features,
        ...Object.entries(p.attributes).map(([k, v]) => `${k}: ${v}`),
      ];
      const featureEvidence = args.desiredFeatures.map((term) => {
        const excerpt = text.find((s) =>
          s.toLowerCase().includes(term.toLowerCase()),
        );
        const position =
          excerpt?.toLowerCase().indexOf(term.toLowerCase()) ?? 0;
        const prefix =
          excerpt?.slice(Math.max(0, position - 30), position).toLowerCase() ??
          "";
        return {
          term,
          excerpt: excerpt?.slice(0, 500) ?? null,
          matched:
            Boolean(excerpt) &&
            !/\b(?:not|no|without|never)\b[^.!?;]*$/.test(prefix),
        };
      });
      const missing = [
        ...(weights.price && !p.price ? ["price"] : []),
        ...(weights.rating && p.rating === undefined ? ["rating"] : []),
      ];
      const components = {
        price: p.price
          ? high === low
            ? 1
            : (high - p.price.minorUnits) / (high - low)
          : null,
        rating: p.rating === undefined ? null : p.rating / 5,
        features: featureEvidence.length
          ? featureEvidence.filter((f) => f.matched).length /
            featureEvidence.length
          : 0,
      };
      const withinBudget =
        args.budgetMinorUnits === undefined
          ? null
          : p.price
            ? p.price.minorUnits <= args.budgetMinorUnits
            : null;
      const score =
        missing.length ||
        withinBudget === false ||
        (args.budgetMinorUnits !== undefined && withinBudget === null)
          ? null
          : Math.round(
              (1000 *
                ((components.price ?? 0) * weights.price +
                  (components.rating ?? 0) * weights.rating +
                  components.features * weights.features)) /
                totalWeight,
            ) / 10;
      return {
        ...p,
        url: `https://www.amazon.com/dp/${p.asin}`,
        score,
        withinBudget,
        missing,
        featureEvidence,
        components,
      };
    })
    .sort(
      (a, b) =>
        (b.score ?? -1) - (a.score ?? -1) || a.asin.localeCompare(b.asin),
    );
  return {
    status: "partial",
    data: {
      items: ranked,
      unavailable,
      weights,
      recommendedAsin:
        ranked[0]?.score !== null && ranked[0] && ranked[0].score > 0
          ? ranked[0].asin
          : null,
      method:
        "Weighted observed price, displayed rating and desired-feature text matches. Price scores are relative to these candidates; equal prices tie. Missing weighted price/rating prevents ranking. Budget uses item price only.",
      limitations: [
        "Feature text matches are evidence to inspect, not verified compatibility or proof an unmatched feature is absent.",
        "Ratings are not independent quality assessments; review count is shown separately.",
        "Shipping, tax, coupons, seller, condition, delivery and long-term reliability are not scored. No purchase is authorized.",
      ],
    },
    coverage: {
      complete: false,
      missing: [
        "verified_delivered_cost",
        "independent_quality",
        ...unavailable.map((p) => `product:${p.asin}`),
      ],
    },
  };
}

export function exportOrders(data: unknown, format: "csv" | "json") {
  const parsed = z
    .object({
      orders: z.array(order.extend({ dateISO: z.string().optional() })),
      scannedPages: z.array(z.number()),
      stopReason: z.string(),
      summary: z.unknown(),
      scope: z.string(),
    })
    .safeParse(data);
  if (!parsed.success)
    throw new DomainError(
      "INVALID_ORDER_RESULT",
      "Use a completed orders_search operation",
      400,
    );
  const cell = (v: unknown) => {
    let text = String(v ?? "");
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return {
    mimeType: format === "csv" ? "text/csv" : "application/json",
    filename: `amazon-observed-orders.${format}`,
    text:
      format === "json"
        ? JSON.stringify(parsed.data, null, 2)
        : [
            "order_id,date,currency,order_total_minor_units,status,items",
            ...parsed.data.orders.map((o) =>
              [
                o.orderId,
                o.dateISO ?? o.date,
                o.total?.currency,
                o.total?.minorUnits,
                o.status,
                o.lines.map((l) => l.title).join("; "),
              ]
                .map(cell)
                .join(","),
            ),
          ].join("\r\n"),
    coverage: {
      complete: false,
      scannedPages: parsed.data.scannedPages,
      stopReason: parsed.data.stopReason,
      scope: parsed.data.scope,
    },
  };
}
