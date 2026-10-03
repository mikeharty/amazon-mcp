import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable Postgres server with CREATEDB permission",
  );
const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const name = `startup_${randomUUID().replaceAll("-", "")}`;
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((r) => probe.close(r));
const isolatedUrl = new URL(process.env.TEST_DATABASE_URL);
isolatedUrl.pathname = `/${name}`;
const temp = await mkdtemp(join(tmpdir(), "amazon-startup-"));
const token = randomBytes(32).toString("base64");
const env = {
  ...process.env,
  DATABASE_URL: isolatedUrl.toString(),
  OWNER_ID: "startup-fixture",
  PORT: String(port),
  MCP_TOKEN: token,
  OWNER_TOKEN: randomBytes(32).toString("base64"),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  AMAZON_LIVE_ENABLED: "false",
  AMAZON_READ_ONLY: "true",
  KEEPA_ENABLED: "false",
  DESKTOP_NOTIFICATIONS: "false",
};
const client = new Client(
  { name: "supervisor-fixture", version: "1" },
  { versionNegotiation: { mode: "auto" } },
);
let child;
try {
  await admin.query(`CREATE DATABASE ${name}`);
  const config = spawnSync(
    process.execPath,
    [resolve("dist/scripts/client-config.js")],
    { env, cwd: temp, encoding: "utf8" },
  );
  assert.equal(config.status, 0);
  assert.ok(!config.stdout.includes(token));
  const [configName] = await readdir(join(temp, ".local"));
  const configPath = join(temp, ".local", configName);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
  assert.equal(
    JSON.parse(await readFile(configPath, "utf8")).mcpServers.amazon.headers
      .Authorization,
    `Bearer ${token}`,
  );
  child = spawn(process.execPath, ["scripts/local-start.mjs"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (b) => (log += b));
  child.stderr.on("data", () => {});
  for (let i = 0; i < 120 && !log.includes("Gateway and worker ready."); i++) {
    assert.equal(child.exitCode, null);
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(log.includes("Gateway and worker ready."));
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const list = await client.listTools();
  assert.ok(list.tools.some((t) => t.name === "products_research"));
  assert.ok(list.tools.some((t) => t.name === "price_alert_create"));
  assert.ok(!list.tools.some((t) => t.name === "cart_add"));
  const capabilities = await client.callTool({
    name: "amazon_capabilities",
    arguments: {},
  });
  assert.equal(capabilities.structuredContent.data.workerOnline, true);
  const duplicate = spawn(process.execPath, ["scripts/local-start.mjs"], {
    env,
    stdio: "ignore",
  });
  const [duplicateCode] = await once(duplicate, "exit");
  assert.equal(duplicateCode, 1);
  const health = await client.callTool({
    name: "amazon_diagnostics",
    arguments: {},
  });
  assert.equal(health.structuredContent.data.worker.online, true);
  console.log(
    `Isolated supervisor verified: ${list.tools.length} tools in read-only mode; gateway and worker ready; duplicate launch fails without disrupting the first service.`,
  );
  await client.close();
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  const [code] = await exit;
  assert.equal(code, 0);
  const db = new pg.Pool({ connectionString: env.DATABASE_URL });
  const result = await db.query("SELECT count(*) FROM worker_health");
  assert.equal(result.rows[0].count, "0");
  await db.end();
  await assert.rejects(fetch(`http://127.0.0.1:${port}/health`));
  console.log(
    "SIGTERM stopped both children, removed worker heartbeat, and released gateway port.",
  );
} finally {
  await client.close().catch(() => {});
  if (child && child.exitCode === null) {
    const exit = once(child, "exit");
    child.kill("SIGTERM");
    await exit;
  }
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  await rm(temp, { recursive: true, force: true });
}
