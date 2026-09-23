import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { Server } from "node:http";
import pg from "pg";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Store } from "../packages/store/index.js";
import { Executor } from "../packages/core/execution.js";
import { createRegistry, cartWriteSchemas } from "../apps/gateway/registry.js";
import { createGateway } from "../apps/gateway/transport.js";
import { serve } from "../apps/gateway/server.js";
const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)(
  "Production registry via real HTTP and database",
  () => {
    let store: Store, admin: pg.Pool, server: Server, client: Client;
    const db = `registry_test_${randomUUID().replaceAll("-", "")}`;
    beforeAll(async () => {
      admin = new pg.Pool({ connectionString: connection });
      await admin.query(`CREATE DATABASE ${db}`);
      const url = new URL(connection!);
      url.pathname = `/${db}`;
      store = new Store(url.toString(), randomBytes(32).toString("base64"));
      await store.migrate();
      const registry = createRegistry(store, {
        liveEnabled: true,
        retainObservations: false,
        origin: "http://127.0.0.1",
        writeSchemas: cartWriteSchemas,
      });
      server = serve(
        createGateway({
          ...registry,
          authenticate: (r) =>
            r.headers.get("authorization") === "Bearer fixture-token"
              ? {
                  id: "fixture-owner",
                  scopes: ["account:read", "catalog:read", "cart:write"],
                }
              : undefined,
        }),
        0,
      );
      await once(server, "listening");
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No server port");
      client = new Client(
        { name: "integrated-registry", version: "1.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${address.port}/mcp`),
          { authProvider: { token: async () => "fixture-token" } },
        ),
      );
    }, 30000);
    afterAll(async () => {
      await client?.close();
      await new Promise<void>((r) => server?.close(() => r()));
      await store?.close();
      await admin?.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
      await admin?.end();
    });
    it("discovers complete typed registry, queues an owner read, and returns its worker result", async () => {
      const tools = (await client.listTools()).tools;
      expect(tools.some((t) => t.name === "cart_add")).toBe(true);
      expect(tools.some((t) => t.name === "checkout_submit")).toBe(false);
      const account = await store.account("fixture-owner");
      const call = await client.callTool({
        name: "products_get",
        arguments: { accountRef: account.id, asin: "B000000001" },
      });
      const pending = call.structuredContent as {
        status: string;
        operationId: string;
      };
      expect(pending.status).toBe("pending");
      const executor = new Executor(
        store,
        {
          read: async () => ({
            status: "partial",
            data: { asin: "B000000001", title: "Fixture" },
            coverage: { complete: false, missing: ["price"] },
          }),
          mutate: async () => {
            throw new Error("No mutation expected");
          },
          close: async () => {},
        },
        "fixture-worker",
      );
      await executor.run(pending.operationId);
      const result = await client.callTool({
        name: "operations_get",
        arguments: { operationId: pending.operationId },
      });
      expect(result.structuredContent).toMatchObject({
        status: "ok",
        data: { status: "partial", result: { data: { title: "Fixture" } } },
      });
      const foreign = await store.account("other-owner");
      expect(
        (
          await client.callTool({
            name: "cart_get",
            arguments: { accountRef: foreign.id },
          })
        ).isError,
      ).toBe(true);
    });
    it("checks scope and exact cart schema before enqueueing side effects", async () => {
      const account = await store.account("fixture-owner");
      const denied = await client.callTool({
        name: "account_disconnect",
        arguments: { accountRef: account.id },
      });
      expect(denied.structuredContent).toMatchObject({
        status: "failed",
        error: { code: "FORBIDDEN" },
      });
      const invalid = await client.callTool({
        name: "cart_add",
        arguments: {
          accountRef: account.id,
          idempotencyKey: "no-offer-proof",
          asin: "B000000001",
          quantity: 1,
        },
      });
      expect(invalid.isError).toBe(true);
      expect(
        (
          await store.pool.query(
            "SELECT count(*) FROM operations WHERE mode='write'",
          )
        ).rows[0].count,
      ).toBe("0");
    });
    it("preserves exact user review text without claiming eligibility or publishing", async () => {
      const a = await store.account("fixture-owner");
      const text = "My own words <script>untrusted</script> $()";
      const result = await client.callTool({
        name: "content_draft",
        arguments: {
          accountRef: a.id,
          kind: "product_review",
          destinationRef: "B000000001",
          userText: text,
        },
      });
      expect(result.structuredContent).toMatchObject({
        status: "ok",
        data: {
          source: "user-provided-text",
          eligibilityVerified: false,
          draft: { userText: text, executor: "owner_handoff_only" },
        },
      });
    });
    it("preserves product history across runtime generations with separate point provenance", async () => {
      const account = await store.account("fixture-owner");
      let price = 100;
      const provider = {
        read: async () => ({
          status: "ok" as const,
          data: {
            asin: "B000000001",
            price: { currency: "USD", minorUnits: price },
          },
          observation: {
            observedAt: "2026-09-22T12:00:00.000Z",
            source: "fixture-provider",
            contextRef: "fixture-account-context",
          },
        }),
        mutate: async () => ({ status: "unsupported" as const }),
        close: async () => {},
      };
      const executor = new Executor(store, provider, "history-worker", true);
      const first = await store.start(
        "fixture-owner",
        account.id,
        "products_get",
        "read",
        { asin: "B000000001" },
        "history-before",
      );
      await executor.run(first.id);
      const beforeHistory = await client.callTool({
        name: "prices_history",
        arguments: { accountRef: account.id, asin: "B000000001" },
      });
      const firstContext = (
        beforeHistory.structuredContent as {
          data: { items: Array<{ provenance: { contextRef: string } }> };
        }
      ).data.items[0]!.provenance.contextRef;
      await store.pool.query(
        "UPDATE accounts SET session_generation=session_generation+1 WHERE id=$1",
        [account.id],
      );
      price = 95;
      const second = await store.start(
        "fixture-owner",
        account.id,
        "products_get",
        "read",
        { asin: "B000000001" },
        "history-after",
      );
      await executor.run(second.id);
      const result = await client.callTool({
        name: "prices_history",
        arguments: { accountRef: account.id, asin: "B000000001" },
      });
      const data = (
        result.structuredContent as {
          data: {
            items: Array<{
              provenance: {
                sessionGeneration: number;
                contextRef: string;
                source: string;
                deliveryContext: { status: string };
                quoteEligible: boolean;
              };
            }>;
            quoteEligible: boolean;
          };
        }
      ).data;
      expect(data.items).toHaveLength(2);
      expect(
        data.items.some(
          (point) => point.provenance.contextRef === firstContext,
        ),
      ).toBe(true);
      expect(
        data.items.map((v) => v.provenance.sessionGeneration).sort(),
      ).toEqual([account.session_generation, account.session_generation + 1]);
      expect(new Set(data.items.map((v) => v.provenance.contextRef)).size).toBe(
        2,
      );
      for (const point of data.items)
        expect(point.provenance).toMatchObject({
          source: "fixture-provider",
          sourceObservedAt: "2026-09-22T12:00:00.000Z",
          deliveryContext: { status: "unverified" },
          quoteEligible: false,
        });
      expect(data.quoteEligible).toBe(false);
      const foreign = await store.account("different-owner");
      expect(
        (
          await client.callTool({
            name: "prices_history",
            arguments: { accountRef: foreign.id, asin: "B000000001" },
          })
        ).isError,
      ).toBe(true);
    });
  },
);
