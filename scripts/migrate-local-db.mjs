import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localWranglerEnv, pnpmCommand } from "./local-wrangler-runner.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
mkdirSync(resolve(root, ".wrangler", "xdg.config"), { recursive: true });

const command = pnpmCommand([
    "--filter",
    "@shared-ledger/api",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "shared-ledger-local",
    "--local",
    "--config",
    "wrangler.local.jsonc",
]);
const result = spawnSync(
  command.command,
  command.args,
  {
    cwd: root,
    env: localWranglerEnv(root),
    shell: command.shell,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
}
if (result.status !== 0) process.exit(result.status ?? 1);
