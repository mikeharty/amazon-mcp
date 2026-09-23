import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { PersistentBrowserRuntime } from "../packages/browser-runtime/index.js";

const profileDir = resolve(
  process.env.AMAZON_PROFILE_DIR ?? ".local/amazon-profile",
);
const marker = `${profileDir}/.amazon-mcp-dedicated-profile`;

rejectNormalBrowserProfile(profileDir);
const initialSessionGeneration = await ensureDedicatedProfile(
  profileDir,
  marker,
);

const runtime = new PersistentBrowserRuntime({
  profileDir,
  headless: false,
  userAgent: "Agent/AmazonShoppingMCP",
  initialSessionGeneration,
  onSessionGeneration: async (sessionGeneration) => {
    await writeFile(
      marker,
      `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), sessionGeneration })}\n`,
      { mode: 0o600 },
    );
  },
});
await runtime.start();
const handoff = await runtime.beginHandoff("https://www.amazon.com/ap/signin");

process.stdout.write(
  [
    `Dedicated Amazon profile: ${profileDir}`,
    "Complete sign-in, MFA, or any challenge directly in the visible Amazon window.",
    "Credentials and cookies are not read or copied by this script.",
    "When the Amazon home/account page is ready, return here and press Enter.",
  ].join("\n") + "\n",
);

await new Promise<void>((resolveInput) =>
  process.stdin.once("data", () => resolveInput()),
);
const state = await runtime.completeHandoff(handoff.generation);
if (state.kind === "challenge") {
  process.stderr.write(
    `Login remains incomplete: ${state.challenge}. The dedicated profile was kept for another attempt.\n`,
  );
  await runtime.close();
  process.exitCode = 2;
} else {
  process.stdout.write(
    `Amazon browser session is ready. Session generation: ${runtime.sessionGeneration}.\n`,
  );
  await runtime.close();
}

function rejectNormalBrowserProfile(path: string): void {
  const normalized = path.toLowerCase();
  const forbidden = [
    `${sep}library${sep}application support${sep}google${sep}chrome`,
    `${sep}library${sep}application support${sep}microsoft edge`,
    `${sep}library${sep}application support${sep}chromium`,
  ];
  if (forbidden.some((part) => normalized.includes(part)))
    throw new Error(
      "Refusing to use a normal browser profile; choose a dedicated AMAZON_MCP_PROFILE_DIR",
    );
}

async function ensureDedicatedProfile(
  path: string,
  markerPath: string,
): Promise<number> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  try {
    await access(markerPath);
    const value = JSON.parse(await readFile(markerPath, "utf8")) as {
      version?: number;
      sessionGeneration?: number;
    };
    if (
      value.version !== 1 ||
      !Number.isInteger(value.sessionGeneration ?? 0) ||
      (value.sessionGeneration ?? 0) < 0
    )
      throw new Error("Dedicated profile marker is invalid");
    return value.sessionGeneration ?? 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const entries = (await readdir(path)).filter((name) => name !== ".DS_Store");
  if (entries.length)
    throw new Error(
      "Profile directory is not empty and lacks the Amazon MCP ownership marker",
    );
  await writeFile(
    markerPath,
    `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), sessionGeneration: 0 })}\n`,
    { mode: 0o600, flag: "wx" },
  );
  return 0;
}
