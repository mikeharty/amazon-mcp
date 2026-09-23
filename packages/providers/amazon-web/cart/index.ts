import { createHash } from "node:crypto";
import type { Page } from "playwright";
import { money } from "../types.js";

export async function extractCart(page: Page) {
  const recognized =
    (await page
      .locator(
        '#sc-active-cart, [data-name="Active Items"], [data-name="Saved Items"]',
      )
      .count()) > 0;
  const raw = await page
    .locator(
      '.sc-list-item[data-asin], [data-name="Active Items"] [data-asin], [data-name="Saved Items"] [data-asin]',
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const root = node as HTMLElement;
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        const quantity =
          root.querySelector<HTMLSelectElement>('select[name*="quantity"]')
            ?.value ??
          root.querySelector<HTMLInputElement>('input[name*="quantity"]')
            ?.value ??
          text(".a-dropdown-prompt");
        const purchaseModeElement = root.querySelector<HTMLElement>(
          '[data-purchase-mode][aria-checked="true"], [data-purchase-mode].selected',
        );
        const purchaseMode =
          root.dataset.purchaseMode ||
          purchaseModeElement?.dataset.purchaseMode;
        return {
          lineRef: root.dataset.itemid || root.dataset.itemId || undefined,
          asin: root.dataset.asin || undefined,
          title: text(".sc-product-title, .a-truncate-cut"),
          quantity:
            quantity && /^\d+$/.test(quantity.trim())
              ? Number(quantity)
              : undefined,
          selected: root.querySelector<HTMLInputElement>(
            'input[type="checkbox"]',
          )?.checked,
          seller: text(
            '.sc-product-seller, [data-feature-id="sc-product-seller"]',
          ),
          sellerId:
            root.dataset.sellerId ||
            root
              .querySelector<HTMLAnchorElement>('a[href*="seller="]')
              ?.href.match(/[?&]seller=([A-Z0-9]+)/i)?.[1],
          condition: text(
            '.sc-product-condition, [data-feature-id="sc-product-condition"]',
          ),
          priceText: text(".sc-product-price, .a-price .a-offscreen"),
          purchaseMode:
            purchaseMode === "one_time" || purchaseMode === "subscription"
              ? purchaseMode
              : undefined,
          location: root.closest('[data-name="Saved Items"], #sc-saved-cart')
            ? "saved"
            : "active",
        };
      }),
    );
  const subtotalText = await page
    .locator(
      '#sc-subtotal-amount-activecart, [data-name="Subtotals"] .a-price .a-offscreen',
    )
    .first()
    .textContent()
    .catch(() => null);
  const warnings = await page
    .locator(
      ".sc-list-item-content .a-alert-content, #sc-active-cart .a-alert-content",
    )
    .allTextContents();
  const lines = raw
    .filter((item) => item.title)
    .map((item) => ({
      ...item,
      title: item.title!,
      price: money(item.priceText),
      priceText: undefined,
    }));
  const revision = createHash("sha256")
    .update(
      JSON.stringify({
        lines: lines.map(
          ({
            lineRef,
            asin,
            quantity,
            selected,
            sellerId,
            condition,
            purchaseMode,
            location,
            price,
          }) => ({
            lineRef,
            asin,
            quantity,
            selected,
            sellerId,
            condition,
            purchaseMode,
            location,
            price,
          }),
        ),
        subtotal: money(subtotalText),
        warnings: warnings.map((v) => v.trim()).filter(Boolean),
      }),
    )
    .digest("hex")
    .slice(0, 24);
  return {
    recognized,
    revision,
    lines,
    subtotal: money(subtotalText),
    warnings: warnings.map((v) => v.trim()).filter(Boolean),
  };
}
