import { resolve } from "node:path";

export function pnpmCommand(args) {
  if (process.env.npm_execpath) return { command: process.execPath, args: [process.env.npm_execpath, ...args], shell: false };
  return {
    command: process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    args,
    shell: false,
  };
}

export function localWranglerEnv(root) {
  return {
    ...process.env,
    CI: "true",
    XDG_CONFIG_HOME: resolve(root, ".wrangler", "xdg.config"),
  };
}
