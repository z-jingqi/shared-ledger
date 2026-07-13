import { exec } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const execAsync = promisify(exec);

const [target, environment] = process.argv.slice(2);
if (!target || !["web", "api"].includes(target) || !["preview", "prod"].includes(environment)) {
  throw new Error("Usage: node scripts/prepare-wrangler-config.mjs <web|api> <preview|prod>");
}

const suffix = environment.toUpperCase();
const isProd = environment === "prod";
const envValue = (name) => {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
};
const webDomain = isProd ? "leger.aleph-cat.com" : "dev.leger.aleph-cat.com";
const webOrigin = `https://${webDomain}`;
const values = {
  __ENV__: environment,
  __WEB_DOMAIN__: webDomain,
  __WEB_ORIGIN__: webOrigin,
  __ZONE_NAME__: "aleph-cat.com",
  __AI_PROVIDER__: envValue(`AI_PROVIDER_${suffix}`) ?? "openrouter",
  __OPENROUTER_MODEL__: envValue(`OPENROUTER_MODEL_${suffix}`) ?? "deepseek/deepseek-v4-flash",
  __WECHAT_MINI_APP_ID__: envValue(`WECHAT_MINI_APP_ID_${suffix}`) ?? "wx1d840b80e978929d",
  __D1_DATABASE_ID__: target === "api" ? await resolveD1DatabaseId() : "__D1_DATABASE_ID__",
  __R2_BUCKET__: envValue(`CLOUDFLARE_R2_BUCKET_${suffix}`) ?? `shared-ledger-files-${environment}`,
  __IMPORT_PIPELINE_QUEUE__:
    envValue(`CLOUDFLARE_IMPORT_PIPELINE_QUEUE_${suffix}`) ?? `shared-ledger-import-pipeline-${environment}`,
  __IMPORT_PIPELINE_DLQ__:
    envValue(`CLOUDFLARE_IMPORT_PIPELINE_DLQ_${suffix}`) ??
    `shared-ledger-import-pipeline-${environment}-dlq`,
};
const appDir = resolve(repoRoot, "apps", target);
const template = "wrangler.template.jsonc";
let config = await readFile(resolve(appDir, template), "utf8");
for (const [token, value] of Object.entries(values)) config = config.replaceAll(token, value);
await mkdir(appDir, { recursive: true });
await writeFile(resolve(appDir, `wrangler.generated-${target}-${environment}.json`), config);
console.log(`Generated ${target} ${environment} Wrangler config.`);

async function resolveD1DatabaseId() {
  const explicitId = envValue(`CLOUDFLARE_D1_DATABASE_ID_${suffix}`);
  if (explicitId) return explicitId;

  const databaseName = envValue(`CLOUDFLARE_D1_DATABASE_NAME_${suffix}`) ?? `shared-ledger-${environment}`;
  const wranglerBin = resolve(
    repoRoot,
    "apps",
    "api",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
  let stdout;
  try {
    // Run through a shell: Windows cannot spawn .cmd shims directly.
    ({ stdout } = await execAsync(`"${wranglerBin}" d1 list --json`, {
      cwd: resolve(repoRoot, "apps", "api"),
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    throw new Error(
      `Could not resolve D1 database id for ${databaseName}. ` +
        `Ensure Wrangler can access Cloudflare or set CLOUDFLARE_D1_DATABASE_ID_${suffix}. ` +
        commandErrorMessage(error),
    );
  }

  const databases = parseD1List(stdout);
  const match = databases.find(
    (database) => database.name === databaseName || database.database_name === databaseName,
  );
  const databaseId = match?.uuid ?? match?.id ?? match?.database_id;
  if (!databaseId) {
    const names =
      databases
        .map((database) => database.name ?? database.database_name)
        .filter(Boolean)
        .join(", ") || "none";
    throw new Error(
      `Could not find D1 database "${databaseName}". ` +
        `Set CLOUDFLARE_D1_DATABASE_NAME_${suffix} or CLOUDFLARE_D1_DATABASE_ID_${suffix}. ` +
        `Available databases: ${names}.`,
    );
  }
  console.log(`Resolved D1 database ${databaseName} (${databaseId}).`);
  return databaseId;
}

function parseD1List(stdout) {
  const trimmed = stdout.trim();
  const jsonStarts = [trimmed.indexOf("["), trimmed.indexOf("{")].filter((index) => index >= 0);
  if (!jsonStarts.length) throw new Error("Wrangler did not return JSON for D1 database list.");
  const jsonStart = Math.min(...jsonStarts);
  const parsed = JSON.parse(trimmed.slice(jsonStart));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.result)) return parsed.result;
  if (Array.isArray(parsed.databases)) return parsed.databases;
  throw new Error("Wrangler returned an unsupported D1 database list shape.");
}

function commandErrorMessage(error) {
  if (!error || typeof error !== "object") return String(error);
  const stderr = typeof error.stderr === "string" && error.stderr.trim() ? error.stderr.trim() : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return stderr ?? message;
}
