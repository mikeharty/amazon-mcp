import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { sep } from "node:path";
import { createInterface } from "node:readline";
import { resolveAmazonProfileDir } from "../packages/core/login-config.js";

const profileDir = resolveAmazonProfileDir();
const marker = `${profileDir}/.amazon-mcp-dedicated-profile`;

rejectNormalBrowserProfile(profileDir);
if (process.argv.slice(2).includes("--check-config")) {
  process.stdout.write(`${profileDir}\n`);
} else {
  try {
    await login(profileDir, marker);
  } catch {
    // Browser errors can include sign-in URLs and filled values.
    process.stderr.write("Amazon login could not finish. Check that no worker owns the dedicated profile, then retry. No credential details were logged.\n");
    process.exitCode = 1;
  }
}

async function login(profileDir: string, marker: string): Promise<void> {
  // Playwright debug output can contain values passed to fill().
  delete process.env.DEBUG;
  delete process.env.PWDEBUG;
  const { PersistentBrowserRuntime } =
    await import("../packages/browser-runtime/index.js");
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
  const input = createInterface({ input: process.stdin, terminal: false });
  const lines = input[Symbol.asyncIterator]();
  const abort = new AbortController();
  const stop = () => { abort.abort(); input.close(); };
  let checkTimer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  let completed = false;
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    await runtime.start();
    if (abort.signal.aborted) { process.exitCode = 2; return; }
    // Let Amazon construct its sign-in URL and return destination. A bare
    // /ap/signin URL can leave the owner on an incomplete sign-in flow.
    const handoff = await runtime.beginHandoff(
      "https://www.amazon.com/gp/css/homepage.html",
    );
    const finishIfReady = async (): Promise<boolean> => {
      const state = await runtime.completeHandoff(handoff.generation);
      if (state.kind === "challenge") return false;
      completed = true;
      process.stdout.write(`Amazon browser session is ready. Session generation: ${runtime.sessionGeneration}.\n`);
      return true;
    };
    if (await finishIfReady()) return;
    if (process.argv.slice(2).includes("--1password")) {
      const { readAmazonLogin, OnePasswordError } = await import("../packages/core/onepassword.js");
      process.stdout.write("Requesting the Amazon login from 1Password. Unlock the app and approve its CLI prompt if needed.\n");
      try {
        const result = await runtime.assistPasswordLogin(handoff.generation, () => readAmazonLogin({
          item: process.env.AMAZON_1PASSWORD_ITEM,
          vault: process.env.AMAZON_1PASSWORD_VAULT,
          signal: abort.signal,
        }));
        process.stdout.write(result === "submitted"
          ? "Password sign-in submitted once. Checking the session.\n"
          : "This sign-in screen needs manual interaction.\n");
      } catch (error) {
        process.stderr.write(error instanceof OnePasswordError
          ? `${error.message}\n`
          : "Login assistance stopped. Continue in the visible browser. No credential details were logged.\n");
      }
      if (abort.signal.aborted) { process.exitCode = 2; return; }
      if (await finishIfReady()) return;
    }
    process.stdout.write(
      [
        `Dedicated Amazon profile: ${profileDir}`,
        "Complete sign-in, MFA, or any challenge directly in the visible Amazon window.",
        "Credentials are never printed or written to files; cookies remain in this dedicated profile.",
        "The session is checked automatically. Press Enter to check immediately, or Ctrl-C to close safely.",
      ].join("\n") + "\n",
    );
    checkTimer = setInterval(() => {
      if (checking || completed || abort.signal.aborted) return;
      checking = finishIfReady().then((ready) => { if (ready) input.close(); })
        .catch(() => { stop(); })
        .finally(() => { checking = undefined; });
    }, 2_000);
    for await (const _line of lines) {
      if (checking) await checking;
      if (completed || await finishIfReady()) return;
      process.stdout.write("Login remains incomplete. Finish sign-in in the visible browser; it will close automatically when the session is verified.\n");
    }
    if (!completed) process.exitCode = 2;
  } finally {
    if (checkTimer) clearInterval(checkTimer);
    if (checking) await checking;
    abort.abort();
    input.close();
    process.stdin.pause();
    await runtime.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
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
      "Refusing to use a normal browser profile; choose a dedicated AMAZON_PROFILE_DIR",
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
