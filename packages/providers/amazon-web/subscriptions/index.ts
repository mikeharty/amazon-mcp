import type { Page } from "playwright";
import { money } from "../types.js";

export async function extractSubscriptions(page: Page) {
  const legacyRecognized =
    (await page
      .locator(
        "#subscriptions-container, [data-subscription-id], .subscription-card, .sns-subscription",
      )
      .count()) > 0;
  const modernGrid = page.locator("#subscriptionsDesktopGridLayout");
  if (await modernGrid.count()) {
    await page.waitForFunction(() => {
      const grid = document.querySelector("#subscriptionsDesktopGridLayout");
      return Boolean(grid?.querySelector("[data-edit-url]")) ||
        /(?:you (?:don't|do not) have any|no active) subscriptions/i.test(grid?.textContent ?? "");
    }, undefined, { timeout: 5_000 }).catch(() => undefined);
  }
  const modernEmpty = await modernGrid.evaluateAll((nodes) => nodes.some((node) =>
    (node as HTMLElement).getClientRects().length > 0 &&
    /(?:you (?:don't|do not) have any|no active) subscriptions/i.test(node.textContent ?? ""),
  ));
  const subscriptions = await page
    .locator("[data-subscription-id], .subscription-card, .sns-subscription, #subscriptionsDesktopGridLayout > [data-edit-url]")
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const root = node as HTMLElement;
        const modern = root.parentElement?.id === "subscriptionsDesktopGridLayout";
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        const details = Array.from(root.querySelectorAll("span"))
          .filter((element) => element.children.length === 0)
          .map((element) => element.textContent?.trim() ?? "");
        const schedule = details.find((value) => /^\d+\s+units?\s+every\s+/i.test(value));
        let subscriptionRef = root.dataset.subscriptionId;
        let asin: string | undefined;
        // Read the destination already attached to the rendered edit tile.
        // Never request its AJAX endpoint or inspect embedded application JSON.
        if (modern && root.dataset.editUrl) {
          try {
            const url = new URL(root.dataset.editUrl, location.href);
            if (url.origin === "https://www.amazon.com" && url.pathname === "/auto-deliveries/ajax/subscription/") {
              subscriptionRef = url.searchParams.get("subscriptionId") ?? undefined;
              const candidate = url.searchParams.get("subAsin");
              if (candidate && /^[A-Z0-9]{10}$/.test(candidate)) asin = candidate;
            }
          } catch { /* Unknown destinations do not establish identity. */ }
        }
        return {
          modern,
          subscriptionRef: subscriptionRef || (modern ? undefined : `subscription-${index + 1}`),
          asin,
          title: text(".product-title, h2, h3, [class*='_singleLineTitle_'] .a-truncate-full"),
          frequency: text('.frequency, [data-testid="frequency"]') ?? schedule?.replace(/^\d+\s+units?\s+/i, ""),
          quantity: schedule ? Number(schedule.match(/^\d+/)?.[0]) : undefined,
          nextDate: text('.next-delivery, [data-testid="next-delivery"]') ??
            details.find((value) => /^next delivery:/i.test(value))?.replace(/^next delivery:\s*/i, ""),
          priceText: text(".a-price .a-offscreen"),
          actions: Array.from(root.querySelectorAll("button, a"))
            .map((el) => el.textContent?.trim())
            .filter((v) => v && /skip|pause|cancel|change|edit/i.test(v)),
        };
      }),
    );
  return {
    recognized: legacyRecognized || modernEmpty || subscriptions.some((item) => item.modern && item.subscriptionRef && item.title),
    unparsedCount: subscriptions.filter((item) => !item.title || !item.subscriptionRef).length,
    subscriptions: subscriptions
      .filter((item) => item.title && item.subscriptionRef)
      .map((item) => ({
        ...item,
        modern: undefined,
        title: item.title!,
        estimatedPrice: money(item.priceText),
        priceText: undefined,
      })),
  };
}
