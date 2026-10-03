import { spawnSync } from "node:child_process";

// Invoked through pnpm; never interpolate shell commands or print environment values.
const pnpm = process.env.npm_execpath;
if (!pnpm) throw new Error("Run pnpm run local:setup");
function run(command, args) {
  const child = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (child.error || child.status !== 0) {
    console.error(
      "Setup stopped. Resolve the preceding step and run local:setup again; existing secrets are preserved.",
    );
    process.exit(1);
  }
}
const packageCommand = (...args) => run(process.execPath, [pnpm, ...args]);
packageCommand("install", "--frozen-lockfile");
packageCommand(
  "exec",
  "playwright",
  "install",
  ...(process.platform === "linux" ? ["--with-deps"] : []),
  "chromium",
);
packageCommand("run", "local:init");
if (!process.argv.includes("--no-docker"))
  run("docker", ["compose", "up", "-d", "--wait", "postgres"]);
packageCommand("run", "build");
packageCommand("run", "migrate");
packageCommand("run", "client:config");
console.log(
  "Setup complete. Run pnpm run local:start. For sign-in or session recovery use pnpm run local:start --login. Live browsing remains opt-in in .env.",
);
