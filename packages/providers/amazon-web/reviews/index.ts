import type { Page } from "playwright";
import { asinFrom, integer, rating } from "../types.js";

export async function extractReviews(page: Page) {
  const observedAsin = asinFrom(
    await page
      .locator("body")
      .getAttribute("data-asin")
      .catch(() => null),
  );
  const aggregateText = await page
    .locator('[data-hook="rating-out-of-text"], #acrPopover .a-icon-alt')
    .first()
    .textContent()
    .catch(() => null);
  const totalText = await page
    .locator('[data-hook="total-review-count"], #acrCustomerReviewText')
    .first()
    .textContent()
    .catch(() => null);
  const reviews = await page
    .locator('[data-hook="review"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const root = node as HTMLElement;
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        return {
          id: root.id || root.getAttribute("data-review-id") || undefined,
          title: text(
            '[data-hook="review-title"] span:last-child, [data-hook="review-title"]',
          ),
          ratingText: text(
            '[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt',
          ),
          author: text(".a-profile-name"),
          date: text('[data-hook="review-date"]'),
          verified: /verified purchase/i.test(
            text('[data-hook="avp-badge"]') || "",
          ),
          variant: text('[data-hook="format-strip"]'),
          body: text(
            '[data-hook="review-body"] span, [data-hook="review-body"]',
          ),
        };
      }),
    );
  return {
    asin: observedAsin,
    aggregate: {
      rating: rating(aggregateText),
      totalCount: integer(totalText),
      retrievedCount: reviews.length,
    },
    reviews: reviews.map((item) => ({
      ...item,
      rating: rating(item.ratingText),
      ratingText: undefined,
    })),
  };
}
