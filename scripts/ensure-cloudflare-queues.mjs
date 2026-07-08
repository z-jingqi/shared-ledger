import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const [environment] = process.argv.slice(2);
if (!environment || !["preview", "prod"].includes(environment)) {
  throw new Error("Usage: node scripts/ensure-cloudflare-queues.mjs <preview|prod>");
}

const suffix = environment.toUpperCase();
const envValue = (name) => {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
};

const queueName =
  envValue(`CLOUDFLARE_IMPORT_PIPELINE_QUEUE_${suffix}`) ?? `shared-ledger-import-pipeline-${environment}`;
const dlqName =
  envValue(`CLOUDFLARE_IMPORT_PIPELINE_DLQ_${suffix}`) ?? `shared-ledger-import-pipeline-${environment}-dlq`;

for (const name of [queueName, dlqName]) {
  await ensureQueue(name);
}

async function ensureQueue(name) {
  if (await queueExists(name)) {
    console.log(`Queue already exists: ${name}`);
    return;
  }
  await runWrangler(["queues", "create", name]);
  console.log(`Created queue: ${name}`);
}

async function queueExists(name) {
  try {
    await runWrangler(["queues", "info", name]);
    return true;
  } catch (error) {
    const message = commandErrorMessage(error);
    if (
      message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("could not find")
    ) {
      return false;
    }
    throw error;
  }
}

async function runWrangler(args) {
  const wranglerBin = resolve(
    repoRoot,
    "apps",
    "api",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  return execFileAsync(wranglerBin, args, {
    cwd: resolve(repoRoot, "apps", "api"),
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
    shell: process.platform === "win32",
  });
}

function commandErrorMessage(error) {
  if (!error || typeof error !== "object") return String(error);
  const stderr = typeof error.stderr === "string" && error.stderr.trim() ? error.stderr.trim() : undefined;
  const stdout = typeof error.stdout === "string" && error.stdout.trim() ? error.stdout.trim() : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return `${stderr ?? ""}\n${stdout ?? ""}\n${message}`.toLowerCase();
}
