import type { Page } from "playwright";
import { money } from "../types.js";

// All evidence comes from rendered order containers. Navigation parameters and
// an order number elsewhere on the page never establish the displayed order.
async function inspectOrders(page: Page) {
  return page.evaluate(() => {
    const visible = (e: Element) => (e as HTMLElement).getClientRects().length > 0 &&
      getComputedStyle(e).visibility !== "hidden";
    const text = (root: Element, selector: string) =>
      Array.from(root.querySelectorAll(selector)).find(visible)?.textContent?.trim() || undefined;
    const orderId = (value?: string | null) => value && /^\d{3}-\d{7}-\d{7}$/.test(value.trim()) ? value.trim() : undefined;
    const lines = (root: Element) => {
      const seen = new Set<string>();
      return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/dp/"], a[href*="/gp/product/"]'))
        .filter(visible).flatMap((a) => {
          const url = new URL(a.href);
          const asin = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/i)?.[1]?.toUpperCase();
          const title = a.textContent?.trim();
          if (url.origin !== "https://www.amazon.com" || !asin || !title || seen.has(asin)) return [];
          seen.add(asin);
          return [{ asin, title, url: `https://www.amazon.com/dp/${asin}` }];
        });
    };
    const labeled = (root: Element, label: string) => {
      const values = Array.from(root.querySelectorAll("span"))
        .filter((e) => visible(e) && e.textContent?.trim().toLowerCase() === label)
        .map((e) => {
          const next = e.parentElement?.nextElementSibling;
          return next && visible(next) ? next.textContent?.trim() : undefined;
        }).filter((value): value is string => Boolean(value));
      return values.length === 1 ? values[0] : undefined;
    };
    const headerValue = (root: Element, label: string) => {
      const item = Array.from(root.querySelectorAll(".order-header__header-list-item"))
        .find((e) => text(e, ".a-text-caps")?.toLowerCase() === label);
      return item ? text(item, ".a-size-base") : undefined;
    };
    const summaryValue = (root: Element, label: string) => {
      const row = Array.from(root.querySelectorAll("#od-subtotals .od-line-item-row"))
        .find((e) => text(e, ".od-line-item-row-label")?.toLowerCase() === label);
      return row ? text(row, ".od-line-item-row-content") : undefined;
    };
    const parse = (root: HTMLElement, detail: boolean) => {
      const id = detail ? orderId(labeled(root, "order #"))
        : orderId(root.dataset.orderId) ?? orderId(text(root, ".yohtmlc-order-id span:not(.a-text-caps)"));
      const modernGroups = Array.from(root.querySelectorAll('[id="shipment-top-row"]'))
        .filter(visible).map((e) => e.closest(".a-box"))
        .filter((e): e is Element => Boolean(e && root.contains(e) && e.querySelectorAll('[id="shipment-top-row"]').length === 1));
      const legacyGroups = Array.from(root.querySelectorAll(".shipment, [data-shipment-id]"))
        .filter(visible).filter((e) => !e.parentElement?.closest(".shipment, [data-shipment-id]"));
      const groups = [...new Set([...modernGroups, ...legacyGroups])];
      const shipments = groups.map((group, index) => {
        const tracker = Array.from(group.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .filter(visible).find((a) => {
            const u = new URL(a.href);
            return /^track package$/i.test(a.textContent?.trim() ?? "") &&
              u.origin === "https://www.amazon.com" && !u.username && !u.password &&
              u.pathname === "/progress-tracker/package" && u.searchParams.get("orderId") === id;
          });
        return {
          shipmentRef: (group as HTMLElement).dataset.shipmentId || `shipment-${index + 1}`,
          status: text(group, "#shipment-top-row .od-status-message, .shipment-top-row, .delivery-box__primary-text, .a-box-title"),
          eta: text(group, ".js-shipment-info-container .a-color-success, .delivery-estimate"),
          lines: lines(group),
          trackingId: (group as HTMLElement).innerText.match(/(?:tracking(?: ID| number)?[:\s]+)([A-Z0-9-]{6,})/i)?.[1],
          events: Array.from(group.querySelectorAll(".tracking-event")).filter(visible)
            .map((e) => e.textContent?.trim()).filter((v): v is string => Boolean(v)),
          // This URL is only used inside the read workflow and never returned.
          trackerUrl: tracker?.href,
        };
      });
      const documents = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="invoice"], a[href*="print.html"]'))
        .filter(visible).filter((a) => new URL(a.href).origin === "https://www.amazon.com")
        .map((a, i) => ({ documentRef: `document-${i + 1}`, label: a.textContent?.trim() || "Order document", available: true }));
      const actions = [...new Set(Array.from(root.querySelectorAll("a,button")).filter(visible)
        .map((e) => e.textContent?.trim()).filter((v): v is string => Boolean(v && /cancel|return|replace|track|buy it again/i.test(v))))];
      return {
        orderId: id,
        date: detail ? labeled(root, "order placed") : headerValue(root, "order placed") ?? text(root, ".order-date-invoice-item, .order-header .a-color-secondary:not(.a-text-caps)"),
        totalText: detail ? summaryValue(root, "grand total:") : headerValue(root, "total") ?? text(root, ".order-header .a-color-price, .yohtmlc-order-total .a-color-secondary"),
        status: text(root, "#shipment-top-row .od-status-message, .shipment-top-row, .delivery-box__primary-text, .a-box-title"),
        lines: detail ? shipments.flatMap((s) => s.lines) : lines(root),
        documents, actions, shipments,
      };
    };
    const detail = document.querySelector<HTMLElement>("#orderDetails");
    const cards = Array.from(document.querySelectorAll<HTMLElement>(".order-card, .js-order-card, [data-order-id]"))
      .filter(visible).filter((e) => !e.parentElement?.closest(".order-card, .js-order-card, [data-order-id]"));
    const raw = detail && visible(detail) ? [parse(detail, true)] : cards.map((e) => parse(e, false));
    const pagination = document.querySelector(".a-pagination");
    const selected = pagination ? text(pagination, ".a-selected") : undefined;
    const currentPage = selected && /^\d+$/.test(selected) ? Number(selected) : undefined;
    const next = pagination?.querySelector<HTMLAnchorElement>(".a-last:not(.a-disabled) a");
    return {
      recognized: Boolean((detail && visible(detail)) || cards.length || document.querySelector("#ordersContainer")),
      unparsedCount: raw.filter((o) => !o.orderId).length,
      orders: raw.filter((o) => o.orderId).map((o) => ({ ...o, orderId: o.orderId! })),
      pagination: {
        currentPage,
        hasNextPage: pagination ? Boolean(next) : undefined,
        nextPage: next && currentPage ? currentPage + 1 : undefined,
      },
    };
  });
}

export async function extractOrders(page: Page) {
  const result = await inspectOrders(page);
  return {
    recognized: result.recognized,
    unparsedCount: result.unparsedCount,
    pagination: result.pagination,
    orders: result.orders.map(({ documents: _documents, actions: _actions, shipments: _shipments, totalText, ...order }) => ({ ...order, total: money(totalText) })),
  };
}

export async function extractOrder(page: Page, requestedOrderId: string) {
  const result = await inspectOrders(page);
  const order = result.orders.find((o) => o.orderId === requestedOrderId);
  if (!order) return { recognized: result.recognized, found: false, documents: [], actions: [] };
  const { totalText, shipments, ...data } = order;
  return {
    recognized: result.recognized, found: true, ...data, total: money(totalText),
    shipments: shipments.map(({ trackerUrl, ...shipment }) => ({ ...shipment, trackingAvailable: Boolean(trackerUrl) })),
  };
}

export async function extractShipments(
  page: Page,
  requestedOrderId: string,
  navigateToTracking?: (url: string) => Promise<void>,
) {
  const result = await inspectOrders(page);
  const order = result.orders.find((o) => o.orderId === requestedOrderId);
  const shipments = [];
  for (const { trackerUrl, ...shipment } of order?.shipments ?? []) {
    let tracking;
    // Bound the number of additional page reads for one operation. A larger
    // order still returns every observed shipment with explicit partial coverage.
    if (trackerUrl && navigateToTracking && shipments.length < 5) {
      await navigateToTracking(trackerUrl);
      tracking = await extractTracking(page, requestedOrderId, trackerUrl);
    }
    shipments.push({ ...shipment, trackingAvailable: Boolean(trackerUrl), tracking });
  }
  return {
    orderId: order?.orderId,
    orderIdentityObserved: Boolean(order),
    shipments,
  };
}

export async function extractTracking(page: Page, requestedOrderId: string, expectedUrl?: string) {
  return page.evaluate(({ id, expectedUrl }) => {
    const root = document.querySelector<HTMLElement>("#pt-page-container, #pageContainer");
    const visible = (e: Element) => (e as HTMLElement).getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
    const current = new URL(location.href);
    const expected = expectedUrl ? new URL(expectedUrl) : undefined;
    const samePackage = !expected || ["shipmentId", "itemId", "packageIndex"].every((key) =>
      !expected.searchParams.has(key) || current.searchParams.get(key) === expected.searchParams.get(key));
    const identity = Boolean(samePackage && root && visible(root) && current.origin === "https://www.amazon.com" &&
      current.pathname === "/progress-tracker/package" && current.searchParams.get("orderId") === id &&
      Array.from(root.querySelectorAll<HTMLAnchorElement>("#ordersInPackage-container a[href]")).some((a) => {
        const u = new URL(a.href);
        return visible(a) && u.origin === "https://www.amazon.com" && !u.username && !u.password &&
          ["/gp/your-account/order-details", "/your-orders/order-details"].includes(u.pathname) &&
          (u.searchParams.get("orderID") ?? u.searchParams.get("orderId")) === id;
      }));
    const text = (selector: string) => Array.from(root?.querySelectorAll(selector) ?? [])
      .find(visible)?.textContent?.trim() || undefined;
    if (!identity) return { recognized: Boolean(root), orderIdentityObserved: false };
    return {
      recognized: true, orderIdentityObserved: true,
      status: text(".pt-status-main-status"), eta: text(".pt-promise-main-slot"),
      milestones: Array.from(root!.querySelectorAll<HTMLElement>(".pt-status-milestone-label"))
        .filter(visible).map((e) => ({
          label: e.textContent?.trim(),
          state: /: Complete$/i.test(e.getAttribute("aria-label") ?? "") ? "complete"
            : /: Incomplete$/i.test(e.getAttribute("aria-label") ?? "") ? "incomplete" : "unknown",
        })),
    };
  }, { id: requestedOrderId, expectedUrl });
}
