import { execFile } from "node:child_process";

export type LoginCredentials = { username: string; password: string };
type OpRunner = (args: string[], signal?: AbortSignal) => Promise<string>;

export class OnePasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OnePasswordError";
  }
}

// Capture stdout in memory. Never propagate CLI stderr or execution errors:
// either may contain sensitive values. No secrets are passed as arguments.
const runOp: OpRunner = (args, signal) =>
  new Promise((resolve, reject) => {
    execFile("op", args, {
      encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, signal,
      env: { ...process.env, OP_DEBUG: "false" },
    }, (error, stdout) => {
      if (error) reject(new OnePasswordError(
        "1Password is unavailable. Unlock the app and enable its CLI integration, then retry.",
      ));
      else resolve(stdout);
    });
  });

export async function readAmazonLogin(
  options: { item?: string; vault?: string; signal?: AbortSignal } = {},
  run: OpRunner = runOp,
): Promise<LoginCredentials> {
  try {
    const scope = options.vault ? ["--vault", options.vault] : [];
    const listed: unknown = JSON.parse(await run(
      ["item", "list", "--categories", "Login", "--format", "json", ...scope],
      options.signal,
    ));
    if (!Array.isArray(listed)) throw new Error();
    const candidates = listed.filter((item) => {
      if (!item || typeof item !== "object" || typeof item.id !== "string") return false;
      if (options.item && item.id !== options.item && item.title !== options.item) return false;
      return Array.isArray(item.urls) && item.urls.some((entry: { href?: unknown }) => {
        if (typeof entry?.href !== "string") return false;
        try {
          const url = new URL(entry.href);
          return url.protocol === "https:" && ["amazon.com", "www.amazon.com"].includes(url.hostname);
        } catch { return false; }
      });
    });
    if (candidates.length !== 1) throw new OnePasswordError(
      candidates.length === 0
        ? "No matching Amazon login found. Set AMAZON_1PASSWORD_ITEM to a Login item with an https://www.amazon.com website."
        : "Multiple Amazon logins found. Set AMAZON_1PASSWORD_ITEM to the intended item ID and optionally AMAZON_1PASSWORD_VAULT.",
    );
    const item = candidates[0];
    const vault = item.vault?.id;
    if (typeof vault !== "string" || !/^[a-z0-9]{26}$/i.test(item.id) || !/^[a-z0-9]{26}$/i.test(vault)) throw new Error();
    const fields: unknown = JSON.parse(await run(
      ["item", "get", item.id, "--vault", vault, "--fields", "label=username,label=password", "--format", "json", "--reveal"],
      options.signal,
    ));
    if (!Array.isArray(fields)) throw new Error();
    const field = (name: string): string => {
      // Built-in fields retain their stable ID/purpose when the owner renames
      // the display label (for example "passwordNew"). Older CLI-shaped
      // responses without IDs can still use the canonical label.
      const byId = fields.filter((entry) => entry?.id === name &&
        (!entry.purpose || entry.purpose === name.toUpperCase()));
      const matches = byId.length ? byId : fields.filter((entry) =>
        entry?.id === undefined && entry?.label === name);
      if (matches.length !== 1 || typeof matches[0].value !== "string" || !matches[0].value) throw new Error();
      return matches[0].value;
    };
    return { username: field("username"), password: field("password") };
  } catch (error) {
    if (error instanceof OnePasswordError) throw error;
    throw new OnePasswordError("Unable to read the Amazon username and password from 1Password. No credential details were logged.");
  }
}
