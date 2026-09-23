import type { Page } from "playwright";
import { asinFrom, money } from "../types.js";

export async function extractOffers(page: Page) {
  const observedAsin = asinFrom(
    await page
      .locator("body")
      .getAttribute("data-asin")
      .catch(() => null),
  );
  const raw = await page
    .locator(
      '#aod-offer, .olpOffer, [data-csa-c-type="widget"][data-csa-c-content-id="offer"]',
    )
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const root = node as HTMLElement;
        const sellerLink = root.querySelector<HTMLAnchorElement>(
          '#aod-offer-soldBy a, .olpSellerName a, a[href*="seller="]',
        );
        return {
          offerId: root.dataset.offerId || `visible-${index + 1}`,
          sellerName: root
            .querySelector("#aod-offer-soldBy, .olpSellerName")
            ?.textContent?.replace(/^Sold by\s*/i, "")
            .trim(),
          sellerUrl: sellerLink?.href,
          condition: root
            .querySelector("#aod-offer-heading, .olpCondition")
            ?.textContent?.trim(),
          fulfilment: root
            .querySelector("#aod-offer-shipsFrom, .olpBadgeContainer")
            ?.textContent?.trim(),
          priceText: root
            .querySelector(".a-price .a-offscreen, .olpOfferPrice")
            ?.textContent?.trim(),
          shippingText: root
            .querySelector("#aod-offer-shipping, .olpShippingInfo")
            ?.textContent?.trim(),
          delivery: root
            .querySelector("#mir-layout-DELIVERY_BLOCK, .olpDeliveryColumn")
            ?.textContent?.trim(),
          returnPolicy: root
            .querySelector('[data-csa-c-content-id*="return"], .return-policy')
            ?.textContent?.trim(),
        };
      }),
    );
  return {
    asin: observedAsin,
    offers: raw.map((item) => ({
      offerId: item.offerId,
      sellerName: item.sellerName || undefined,
      sellerId: item.sellerUrl?.match(/[?&]seller=([A-Z0-9]+)/i)?.[1],
      condition: item.condition || undefined,
      fulfilment: item.fulfilment || undefined,
      price: money(item.priceText),
      shipping: money(item.shippingText),
      delivery: item.delivery || undefined,
      returnPolicy: item.returnPolicy || undefined,
    })),
  };
}

export async function extractSeller(page: Page) {
  const name = await page
    .locator("#sellerName, #seller-profile-container h1, h1")
    .first()
    .textContent()
    .catch(() => null);
  const periods = await page
    .locator("[data-feedback-summary-period], #feedback-summary-table tr")
    .evaluateAll((rows) =>
      rows.map((row) => {
        const root = row as HTMLElement;
        const countText =
          root.querySelector("[data-feedback-count], .feedback-count")
            ?.textContent ??
          root.textContent?.match(/([\d,]+)\s*(?:ratings?|total)\b/i)?.[1];
        return {
          period:
            root.dataset.feedbackSummaryPeriod ||
            root.querySelector("th, td")?.textContent?.trim(),
          positivePercent: root.textContent?.match(/(\d+(?:\.\d+)?)%/)?.[1],
          count: countText ? Number(countText.replace(/,/g, "")) : undefined,
        };
      }),
    );
  return {
    sellerId: new URL(page.url()).searchParams.get("seller") ?? undefined,
    name: name?.trim() || undefined,
    feedbackPeriods: periods,
  };
}

export async function extractSellerFeedback(page: Page) {
  const feedback = await page
    .locator("[data-feedback-id], .feedback-row, .a-section.feedback")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const root = node as HTMLElement;
        const text = root.textContent?.replace(/\s+/g, " ").trim();
        return {
          id: root.dataset.feedbackId || undefined,
          rating: text?.match(/([1-5])\s*(?:out of 5|stars?)/i)?.[1],
          text,
        };
      }),
    );
  return { feedback };
}
