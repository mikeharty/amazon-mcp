import type { Page } from "playwright";
import { money } from "../types.js";

export async function extractOrders(page: Page) {
  const recognized =
    (await page
      .locator("#ordersContainer, .order-card, .js-order-card, [data-order-id]")
      .count()) > 0;
  const orders = await page
    .locator(".order-card, .js-order-card, [data-order-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const root = node as HTMLElement;
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        const all = root.textContent || "";
        const orderId =
          root.dataset.orderId || all.match(/\d{3}-\d{7}-\d{7}/)?.[0];
        return {
          orderId,
          date: text(
            ".order-header .a-color-secondary, .order-date-invoice-item",
          ),
          totalText: text(
            ".order-header .a-color-price, .yohtmlc-order-total .a-color-secondary",
          ),
          status: text(
            ".shipment-top-row, .delivery-box__primary-text, .a-box-title",
          ),
          lines: Array.from(
            root.querySelectorAll<HTMLAnchorElement>(
              'a[href*="/dp/"], a[href*="/gp/product/"]',
            ),
          )
            .map((link) => ({
              title: link.textContent?.trim(),
              url: link.href,
              asin: link.href
                .match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]
                ?.toUpperCase(),
            }))
            .filter((line) => line.title && line.asin),
        };
      }),
    );
  return {
    recognized,
    orders: orders
      .filter((order) => order.orderId)
      .map((order) => ({
        ...order,
        orderId: order.orderId!,
        total: money(order.totalText),
        totalText: undefined,
      })),
  };
}

export async function extractOrder(page: Page, requestedOrderId: string) {
  const list = await extractOrders(page);
  const visible = list.orders.find(
    (order) => order.orderId === requestedOrderId,
  );
  const documents = await page
    .locator('a[href*="invoice"], a[href*="print.html"]')
    .evaluateAll((links) =>
      links.map((link, i) => ({
        documentRef: `document-${i + 1}`,
        label: link.textContent?.trim() || "Order document",
        available: true,
      })),
    );
  const actions = await page
    .locator("a, button")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.textContent?.trim())
        .filter(
          (text) =>
            text && /cancel|return|replace|track|buy it again/i.test(text),
        ),
    );
  return {
    recognized: list.recognized,
    found: Boolean(visible),
    ...(visible ?? {}),
    documents: visible ? documents : [],
    actions: visible ? actions : [],
  };
}

export async function extractShipments(page: Page, orderId: string) {
  const orderIdentityObserved =
    (await page.locator(`[data-order-id=${JSON.stringify(orderId)}]`).count()) >
      0 ||
    (
      (await page
        .locator("body")
        .textContent()
        .catch(() => "")) ?? ""
    ).includes(orderId);
  const shipments = await page
    .locator(".shipment, .a-box.shipment, [data-shipment-id]")
    .evaluateAll((nodes) =>
      nodes.map((node, index) => {
        const root = node as HTMLElement;
        const text = (selector: string) =>
          root.querySelector(selector)?.textContent?.trim() || undefined;
        const all = root.textContent || "";
        return {
          shipmentRef: root.dataset.shipmentId || `shipment-${index + 1}`,
          status: text(
            ".shipment-top-row, .delivery-box__primary-text, .a-box-title",
          ),
          eta: text(
            ".js-shipment-info-container .a-color-success, .delivery-estimate",
          ),
          trackingId: all.match(
            /(?:tracking(?: ID| number)?[:\s]+)([A-Z0-9-]{6,})/i,
          )?.[1],
          events: Array.from(
            root.querySelectorAll(".tracking-event, .milestone"),
          )
            .map((el) => el.textContent?.trim())
            .filter(Boolean),
        };
      }),
    );
  return {
    orderId: orderIdentityObserved ? orderId : undefined,
    orderIdentityObserved,
    shipments: orderIdentityObserved ? shipments : [],
  };
}
