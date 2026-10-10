import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { chromium, type Browser } from "playwright";
import pg from "pg";
import { Store } from "../packages/store/index.js";
import { createOwnerUi } from "../apps/gateway/owner-ui.js";
import { serve } from "../apps/gateway/server.js";
const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)("Owner review authorization", () => {
  let store: Store, admin: pg.Pool;
  const db = `owner_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: connection });
    await admin.query(`CREATE DATABASE ${db}`);
    const u = new URL(connection!);
    u.pathname = `/${db}`;
    store = new Store(u.toString(), randomBytes(32).toString("base64"));
    await store.migrate();
  }, 30000);
  afterAll(async () => {
    await store?.close();
    await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await admin?.end();
  });
  it("allows browser form login and exact-intent approval with same-origin checks", async () => {
    const token = randomBytes(32).toString("hex");
    const config = { ownerId: "browser-owner", ownerToken: token, origin: "" };
    const ui = createOwnerUi(store, config);
    const server = serve(ui, 0);
    let browser: Browser | undefined;
    try {
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Missing test port");
      config.origin = `http://127.0.0.1:${address.port}`;
      const account = await store.account(config.ownerId);
      const intent = await store.prepare(
        config.ownerId, account.id, "fixture_purchase", {
          title: "Browser approval fixture",
          total: { currency: "USD", minorUnits: 1000 },
        },
      );
      browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto(config.origin + "/owner");
      await page.getByLabel("Owner token").fill(token);
      const [login] = await Promise.all([
        page.waitForResponse((response) =>
          response.url().endsWith("/owner/login"),
        ),
        page.getByRole("button", { name: "Sign in" }).click(),
      ]);
      expect(await login.request().headerValue("origin")).toBe(config.origin);
      expect(login.status()).toBe(303);
      await page.waitForURL(config.origin + "/owner");
      expect(await page.getByRole("heading", {
        name: "Amazon MCP owner control",
      }).count()).toBe(1);
      const path = `/owner/intents/${intent.id}`;
      await page.goto(config.origin + path);
      const [approval] = await Promise.all([
        page.waitForResponse((response) =>
          response.url() === config.origin + path &&
          response.request().method() === "POST",
        ),
        page.getByRole("button", { name: "Approve these exact terms once" }).click(),
      ]);
      expect(await approval.request().headerValue("origin")).toBe(config.origin);
      expect(approval.status()).toBe(200);
      expect((await store.getIntent(config.ownerId, intent.id)).approved_at)
        .not.toBeNull();
    } finally {
      await browser?.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => error ? reject(error) : resolve()),
      );
    }
  }, 15000);
  it("requires separate owner login and CSRF, escapes untrusted terms, and consumes approval once", async () => {
    const origin = "http://127.0.0.1:3433";
    const token = randomBytes(32).toString("hex");
    const ui = createOwnerUi(store, {
      ownerId: "owner",
      ownerToken: token,
      origin,
    });
    const a = await store.account("owner");
    const intent = await store.prepare("owner", a.id, "fixture_purchase", {
      title: "<script>alert(1)</script>",
      total: { currency: "USD", minorUnits: 1000 },
    });
    const post = (
      path: string,
      body: Record<string, string>,
      cookie?: string,
      requestOrigin = origin,
    ) =>
      ui(
        new Request(origin + path, {
          method: "POST",
          headers: {
            origin: requestOrigin,
            "content-type": "application/x-www-form-urlencoded",
            ...(cookie ? { cookie } : {}),
          },
          body: new URLSearchParams(body),
        }),
      );
    expect((await post("/owner/login", { token: "mcp-token" })).status).toBe(
      401,
    );
    expect(
      (await post("/owner/login", { token }, undefined, "https://evil.example"))
        .status,
    ).toBe(403);
    expect((await post("/owner/login", { token }, undefined, "null")).status)
      .toBe(403);
    expect((await ui(new Request(origin + "/owner/login", {
      method: "POST",
      body: new URLSearchParams({ token }),
    }))).status).toBe(403);
    const login = await post("/owner/login", { token });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(cookie).toContain("owner_session=");
    const url = `/owner/intents/${intent.id}`;
    const page = await ui(new Request(origin + url, { headers: { cookie } }));
    const body = await page.text();
    expect(body).not.toContain("<script>alert");
    expect(body).toContain("&lt;script&gt;");
    const csrf = /name="csrf" value="([^"]+)"/.exec(body)![1]!;
    expect(
      (
        await post(
          url,
          { action: "approve", digest: intent.digest, csrf: "fake" },
          cookie,
        )
      ).status,
    ).toBe(403);
    expect((await store.getIntent("owner", intent.id)).approved_at).toBeNull();
    expect(
      (
        await post(
          url,
          { action: "approve", digest: intent.digest, csrf },
          cookie,
        )
      ).status,
    ).toBe(200);
    const op = await store.submit("owner", intent.id, "approved-once");
    expect((await store.submit("owner", intent.id, "new-key")).id).toBe(op.id);
  });
});
