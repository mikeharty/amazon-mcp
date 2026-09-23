import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("browser login configuration", () => {
  it("loads AMAZON_PROFILE_DIR from .env and matches worker path resolution", async () => {
    const workingDirectory = await mkdtemp(join(tmpdir(), "amazon-login-config-"));
    try {
      await symlink(
        join(repositoryRoot, "scripts"),
        join(workingDirectory, "scripts"),
        "dir",
      );
      await symlink(
        join(repositoryRoot, "node_modules"),
        join(workingDirectory, "node_modules"),
        "dir",
      );
      await writeFile(
        join(workingDirectory, ".env"),
        "AMAZON_PROFILE_DIR=.profiles/custom-amazon\n",
        { mode: 0o600 },
      );

      const environment = {
        HOME: workingDirectory,
        NODE_NO_WARNINGS: "1",
        PATH: process.env.PATH,
        TMPDIR: process.env.TMPDIR,
      };
      const login = await execFileAsync(
        process.execPath,
        [
          "--env-file=.env",
          "--import",
          "tsx",
          "scripts/browser-login.ts",
          "--check-config",
        ],
        { cwd: workingDirectory, env: environment },
      );

      const configModule = pathToFileURL(
        join(repositoryRoot, "packages/core/config.ts"),
      ).href;
      const config = await execFileAsync(
        process.execPath,
        [
          "--env-file=.env",
          "--import",
          "tsx",
          "--input-type=module",
          "--eval",
          [
            `import { loadConfig } from ${JSON.stringify(configModule)};`,
            "const env = { ...process.env, DATABASE_URL: 'postgres://test', DATA_ENCRYPTION_KEY: 'test', MCP_TOKEN: 'm'.repeat(32), OWNER_TOKEN: 'o'.repeat(32) };",
            "process.stdout.write(loadConfig(env).profileDir + '\\n');",
          ].join(" "),
        ],
        { cwd: workingDirectory, env: environment },
      );

      expect(login.stderr).toBe("");
      expect(login.stdout).toBe(config.stdout);
      expect(login.stdout.trim()).toBe(
        join(await realpath(workingDirectory), ".profiles/custom-amazon"),
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  });
});
