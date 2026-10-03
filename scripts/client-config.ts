import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../packages/core/config.js";
const config = loadConfig();
await mkdir(".local", { recursive: true, mode: 0o700 });
// A fresh filename/exclusive creation prevents following an existing symlink.
const file = `.local/mcp-client-${Date.now()}.json`;
await writeFile(
  file,
  JSON.stringify(
    {
      mcpServers: {
        amazon: {
          url: `http://127.0.0.1:${config.port}/mcp`,
          headers: { Authorization: `Bearer ${config.mcpToken}` },
        },
      },
    },
    null,
    2,
  ) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  `Private Streamable HTTP configuration written to ${file}. Import the URL and header into a compatible client; client-specific formats vary. Never paste this file into chat or commit it.`,
);
