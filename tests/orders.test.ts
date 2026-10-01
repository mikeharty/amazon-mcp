import { readFile } from "node:fs/promises";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AmazonWebProvider } from "../packages/providers/amazon-web/provider.js";
import { extractOrder, extractOrders, extractTracking } from "../packages/providers/amazon-web/orders/index.js";

let browser: Browser;
let page: Page;
let detail: string;
let tracker: string;
let history: string;
let visited: string[];
const id = "111-2222222-3333333";
const context = { ownerId: "fixture", accountRef: "fixture", marketplace: "amazon.com" as const, sessionGeneration: 1 };
beforeAll(async () => {
  browser = await chromium.launch({ channel: "chromium", headless: true });
  const fixture = (name: string) => readFile(new URL(`./fixtures/${name}.html`, import.meta.url), "utf8");
  [detail, tracker, history] = await Promise.all([
    fixture("order-details-modern"), fixture("tracking-modern"), fixture("orders-modern"),
  ]);
});
afterAll(async () => { await browser?.close(); });
beforeEach(async () => {
  page = await browser.newPage(); visited = [];
  await page.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname; visited.push(path);
    return route.fulfill({ contentType: "text/html", body: path === "/progress-tracker/package" ? tracker
      : path.includes("order-history") ? history : detail });
  });
});
afterEach(async () => { await page.context().close(); });
const provider = () => new AmazonWebProvider({ run: async (fn) => fn(page), close: async () => {} });

describe("modern order and tracking reads", () => {
  it("reads the labeled history values and reports observed pagination", async () => {
    await page.goto("https://www.amazon.com/gp/your-account/order-history");
    const result = await extractOrders(page);
    expect(result.orders).toHaveLength(1);
    expect(result.orders[0]).toMatchObject({ orderId: id, date: "September 20, 2026", total: { minorUnits: 4250 } });
    expect(result.pagination).toEqual({ currentPage: 1, hasNextPage: true, nextPage: 2 });
  });

  it("detects when Amazon returns a different page than requested", async () => {
    const result = await provider().read("orders_list", { page: 2 }, context);
    expect(result.coverage?.missing).toContain("required:orders_page");
  });

  it("parses exact order detail, totals and split-package item mapping", async () => {
    const result = await provider().read("orders_get", { orderId: id }, context);
    expect(result.status).toBe("ok");
    expect(result.data).toMatchObject({ found: true, orderId: id, total: { minorUnits: 4250 },
      lines: [{ asin: "B0FIXTURE1" }, { asin: "B0FIXTURE2" }],
      documents: [{ label: "Invoice" }],
      shipments: [{ status: "Arriving Thursday", lines: [{ asin: "B0FIXTURE1" }] },
        { status: "Delivered September 22", lines: [{ asin: "B0FIXTURE2" }] }],
    });
    expect(JSON.stringify(result)).not.toMatch(/Unrelated|unrelated|synthetic-one|private|trackerUrl/);
  });

  it("does not establish identity from an unrelated order number elsewhere on the page", async () => {
    await page.goto("https://www.amazon.com/your-orders/order-details");
    const result = await extractOrder(page, "999-9999999-9999999");
    expect(result).toMatchObject({ found: false, documents: [], actions: [] });
    expect(result).not.toHaveProperty("orderId");
    const shipments = await provider().read("shipments_get", { orderId: "999-9999999-9999999" }, context);
    expect(shipments.data).toMatchObject({ orderIdentityObserved: false, shipments: [] });
    expect(visited).not.toContain("/progress-tracker/package");
  });

  it.each(["pt-page-container", "pageContainer"])("follows tracking links in %s and preserves incomplete future milestones", async (rootId) => {
    await page.route("**/progress-tracker/package*", (route) => {
      visited.push("/progress-tracker/package");
      return route.fulfill({ contentType: "text/html", body: tracker.replace('id="pt-page-container"', `id="${rootId}"`) });
    });
    const result = await provider().read("shipments_get", { orderId: id }, context);
    expect(result.observation?.authentication).toBe("verified");
    expect(result.coverage?.missing).toEqual(["source_completeness"]);
    const data = result.data as any;
    expect(data.shipments).toHaveLength(2);
    expect(visited.filter((path) => path === "/progress-tracker/package")).toHaveLength(2);
    expect(data.shipments[0].tracking).toMatchObject({ orderIdentityObserved: true, status: "Shipped", eta: "Arriving Thursday",
      milestones: [{ label: "Ordered", state: "complete" }, { label: "Shipped", state: "incomplete" }, { label: "Delivered", state: "incomplete" }],
    });
    expect(JSON.stringify(result)).not.toMatch(/trackerUrl|synthetic-one|packageIndex/);
  });

  it.each(["https://evil.test", "https://www.amazon.com/ap/signin", "https://www.amazon.com/progress-tracker/package?orderId=999-9999999-9999999"])("never follows an untrusted or wrong-order tracking destination: %s", async (url) => {
    await page.route("**/*order-details*", (route) => route.fulfill({ contentType: "text/html", body: detail.replace(/href="\/progress-tracker\/package[^"]*"/g, `href="${url}"`) }));
    const result = await provider().read("shipments_get", { orderId: id }, context);
    expect((result.data as any).shipments.every((s: any) => !s.trackingAvailable)).toBe(true);
    expect(visited).not.toContain("/progress-tracker/package");
  });

  it("rejects a redirected tracking page for another package", async () => {
    const expected = `https://www.amazon.com/progress-tracker/package?orderId=${id}&shipmentId=one`;
    await page.goto(expected.replace("shipmentId=one", "shipmentId=other"));
    expect(await extractTracking(page, id, expected)).toEqual({ recognized: true, orderIdentityObserved: false });
  });

  it("requires the visible tracking page's order-info link as identity evidence", async () => {
    await page.goto(`https://www.amazon.com/progress-tracker/package?orderId=${id}`);
    await page.locator("#ordersInPackage-container a").evaluate((a) => a.setAttribute("href", "/gp/your-account/order-details?orderID=999-9999999-9999999"));
    expect(await extractTracking(page, id)).toEqual({ recognized: true, orderIdentityObserved: false });
  });

  it.each(["display:none", "visibility:hidden"])("ignores hidden tracking identity evidence: %s", async (style) => {
    await page.goto(`https://www.amazon.com/progress-tracker/package?orderId=${id}`);
    await page.locator("#ordersInPackage-container a").evaluate((a, style) => a.setAttribute("style", style), style);
    expect(await extractTracking(page, id)).toEqual({ recognized: true, orderIdentityObserved: false });
  });

  it("bounds tracking navigation and marks unvisited package details as partial", async () => {
    await page.route("**/*order-details*", (route) => route.fulfill({ contentType: "text/html", body: detail.replace('</main>',
      Array.from({ length: 4 }, (_, i) => `<div class="a-box"><div id="shipment-top-row"><h4 class="od-status-message">Shipped</h4></div><a href="/dp/B0FIXTURE1">Fixture mug</a><a href="/progress-tracker/package?orderId=${id}&amp;shipmentId=extra-${i}">Track package</a></div>`).join('') + '</main>') }));
    const result = await provider().read("shipments_get", { orderId: id }, context);
    expect((result.data as any).shipments).toHaveLength(6);
    expect(visited.filter((path) => path === "/progress-tracker/package")).toHaveLength(5);
    expect(result.coverage?.missing).toContain("tracking_details");
  });

  it("hands off instead of returning tracking from a signed-out page", async () => {
    await page.route("**/progress-tracker/package*", (route) => route.fulfill({ contentType: "text/html", body: tracker.replace("Hello, Fixture", "Hello, sign in") }));
    const result = await provider().read("shipments_get", { orderId: id }, context);
    expect(result.status).toBe("requires_user_action");
  });
});
