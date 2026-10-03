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
import { verifyAccountReads } from "../packages/core/read-verification.js";
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
        fetchImage: async () => ({ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=" }),
      });
      server = serve(
        createGateway({
          ...registry,
          authenticate: (r) =>
            r.headers.get("authorization") === "Bearer fixture-token"
              ? {
                  id: "fixture-owner",
                  scopes: ["account:read", "catalog:read", "cart:write", "watches:write"],
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
    it("runs history search through the durable executor and exports only the owner's result", async () => {
      const account = await store.account("fixture-owner");
      const call = await client.callTool({ name: "orders_search", arguments: { accountRef: account.id, query: "mug", maxPages: 2 } });
      const id = (call.structuredContent as {operationId:string}).operationId;
      const executor = new Executor(store, {
        read: async () => ({ status: "partial", data: { recognized:true, orders:[{ orderId:"111-2222222-3333333", date:"October 1, 2026",total:{currency:"USD",minorUnits:2500}, lines:[{asin:"B000000001",title:"Fixture mug"}] }],pagination:{currentPage:1,hasNextPage:false} },observation:{source:"amazon-web",observedAt:new Date().toISOString(),contextRef:account.id,authentication:"verified"} }),
        mutate: async () => { throw new Error("No writes"); }, close: async () => {},
      },"search-worker");
      await executor.run(id);
      const output = await client.callTool({name:"orders_export",arguments:{operationId:id,format:"csv"}});
      expect(output.structuredContent).toMatchObject({status:"partial",data:{mimeType:"text/csv",text:expect.stringContaining("Fixture mug"),coverage:{complete:false}}});
      const other = await store.account("foreign-export");
      const foreign = await store.start("foreign-export",other.id,"orders_search","read",{},randomUUID());
      const denied=await client.callTool({name:"orders_export",arguments:{operationId:foreign.id}});
      expect(denied.isError).toBe(true);
    });
    it("returns an MCP image from verified owner observations and creates one idempotent price alert", async () => {
      const account = await store.account("fixture-owner");
      const op = await store.start("fixture-owner",account.id,"products_get","read",{asin:"B000000001"},randomUUID());
      const claimed = await store.claim(op.id,"image-worker");
      await store.finish(claimed!,"image-worker",{status:"partial",data:{asin:"B000000001",media:[{kind:"image",url:"https://m.media-amazon.com/images/I/fixture.png"}]}});
      const response=await client.callTool({name:"product_image_get",arguments:{operationId:op.id,index:0}});
      expect(response.isError).not.toBe(true);
      expect(response.content).toEqual(expect.arrayContaining([expect.objectContaining({type:"image",mimeType:"image/png"})]));
      const research=await store.start("fixture-owner",account.id,"products_research","read",{asins:["B000000001","B000000002"]},randomUUID());
      const researchClaimed=await store.claim(research.id,"research-image-worker");
      await store.finish(researchClaimed!,"research-image-worker",{status:"partial",data:{items:[{asin:"B000000002",media:[{kind:"image",url:"https://m.media-amazon.com/images/I/fixture.png"}]}]}});
      expect((await client.callTool({name:"product_image_get",arguments:{operationId:research.id,asin:"B000000002"}})).content).toEqual(expect.arrayContaining([expect.objectContaining({type:"image"})]));
      expect((await client.callTool({name:"product_image_get",arguments:{operationId:research.id,asin:"B000000003"}})).isError).toBe(true);
      const args={accountRef:account.id,asin:"B000000001",targetMinorUnits:2500,idempotencyKey:"registry-price-alert"};
      const first=await client.callTool({name:"price_alert_create",arguments:args});
      const again=await client.callTool({name:"price_alert_create",arguments:args});
      const id=(first.structuredContent as {data:{watch:{id:string}}}).data.watch.id;
      expect(again.structuredContent).toMatchObject({status:"ok",data:{watch:{id,priceThreshold:{notifyOnFirstMatch:true}}}});
      const conflict=await client.callTool({name:"price_alert_create",arguments:{...args,targetMinorUnits:2000}});
      expect(conflict.isError).toBe(true);
    });
    it("blocks even previously queued writes in worker read-only mode", async () => {
      const account = await store.account("read-only-worker");
      const op=await store.start("read-only-worker",account.id,"cart_remove","write",{},randomUUID());
      let mutations=0;
      const executor=new Executor(store,{read:async()=>({status:"ok"}),mutate:async()=>{mutations++;return {status:"ok"};},close:async()=>{}},"read-only-worker",false,false,true);
      await executor.run(op.id);
      expect(mutations).toBe(0);
      expect((await store.getOperation("read-only-worker",op.id)).result).toMatchObject({status:"failed",error:{code:"AMAZON_READ_ONLY"}});
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
    it("exposes recovery tools, local health resources and workflow instructions through MCP", async () => {
      const account = await store.account("fixture-owner");
      const tools = (await client.listTools()).tools;
      for (const name of ["amazon_diagnostics", "operations_list"]) {
        expect(tools.find((t) => t.name === name)?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
      }
      const history = await client.callTool({ name: "operations_list", arguments: { accountRef: account.id, limit: 1 } });
      expect(history.structuredContent).toMatchObject({ status: "ok", data: { operations: expect.any(Array) } });
      const diagnostics = await client.callTool({ name: "amazon_diagnostics", arguments: {} });
      expect(diagnostics.structuredContent).toMatchObject({ status: "ok", data: { authentication: "not_checked", account: { accountRef: account.id } } });
      const resources = (await client.listResources()).resources;
      expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["amazon://guide", "amazon://status"]));
      const guide = await client.readResource({ uri: "amazon://guide" });
      expect(guide.contents[0]).toMatchObject({ mimeType: "text/markdown", text: expect.stringContaining("operations_list") });
      const health = await client.readResource({ uri: "amazon://status" });
      expect(health.contents[0]).toMatchObject({ mimeType: "application/json", text: expect.stringContaining('"authentication":"not_checked"') });
      expect(client.getInstructions()).toContain("operations_list");
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
            "SELECT count(*) FROM operations WHERE mode='write' AND owner_id='fixture-owner'",
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
    it("verifies three durable account reads through the SDK without queueing writes", async () => {
      await store.heartbeat("read-verification-worker");
      const executor = new Executor(
        store,
        {
          read: async (kind) => ({
            status: "partial",
            data: {
              recognized: true,
              [kind === "cart_get"
                ? "lines"
                : kind === "orders_list"
                  ? "orders"
                  : "subscriptions"]: [],
            },
            observation: {
              source: "amazon-web",
              authentication: "verified",
              observedAt: new Date().toISOString(),
              contextRef: "fixture",
            },
            coverage: { complete: false, missing: ["source_completeness"] },
          }),
          mutate: async () => {
            throw new Error("Read verification must never mutate");
          },
          close: async () => {},
        },
        "read-verification-worker",
      );
      const report = await verifyAccountReads(async (name, args, signal) => {
        const result = await client.callTool(
          { name, arguments: args },
          { signal },
        );
        const envelope = result.structuredContent as { data?: { id: string; status: string } };
        // Return the first real queued response before completing the job, so
        // polling must tolerate JSON omitting the not-yet-available result.
        if (name === "operations_get" && envelope.data?.status === "queued")
          await executor.run(envelope.data.id);
        return result.structuredContent;
      });
      expect(report.status).toBe("completed");
      expect(report.checks.map((check) => check.tool)).toEqual([
        "cart_get",
        "orders_list",
        "subscriptions_list",
      ]);
      expect(
        (
          await store.pool.query(
            "SELECT count(*) FROM operations WHERE mode <> 'read' AND owner_id='fixture-owner'",
          )
        ).rows[0].count,
      ).toBe("0");
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
