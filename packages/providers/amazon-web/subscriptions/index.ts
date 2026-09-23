import type { Page } from "playwright";
import { money } from "../types.js";

export async function extractSubscriptions(page: Page) {
  const recognized =
    (await page
      .locator(
        "#subscriptions-container, [data-subscription-id], .subscription-card, .sns-subscription",
      )
      .count()) > 0;
  const subscriptions = await page
    .locator("[data-subscription-id], .subscription-card, .sns-subscription")
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const root = node as HTMLElement;
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        return {
          subscriptionRef:
            root.dataset.subscriptionId || `subscription-${index + 1}`,
          title: text(".product-title, h2, h3"),
          frequency: text('.frequency, [data-testid="frequency"]'),
          nextDate: text('.next-delivery, [data-testid="next-delivery"]'),
          priceText: text(".a-price .a-offscreen"),
          actions: Array.from(root.querySelectorAll("button, a"))
            .map((el) => el.textContent?.trim())
            .filter((v) => v && /skip|pause|cancel|change|edit/i.test(v)),
        };
      }),
    );
  return {
    recognized,
    subscriptions: subscriptions
      .filter((item) => item.title)
      .map((item) => ({
        ...item,
        title: item.title!,
        estimatedPrice: money(item.priceText),
        priceText: undefined,
      })),
  };
}
