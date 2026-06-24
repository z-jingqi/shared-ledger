import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [target, environment] = process.argv.slice(2);
if (!target || !["web", "api"].includes(target) || !["dev", "prod"].includes(environment)) {
  throw new Error("Usage: node scripts/prepare-wrangler-config.mjs <web|api> <dev|prod>");
}

const suffix = environment.toUpperCase();
const values = {
  __ENV__: environment,
  __WEB_DOMAIN__: environment === "prod" ? "leger.aleph-cat.com" : "dev.leger.aleph-cat.com",
  __API_DOMAIN__: environment === "prod" ? "api.leger.aleph-cat.com" : "api.dev.leger.aleph-cat.com",
  __WEB_ORIGIN__: environment === "prod" ? "https://leger.aleph-cat.com" : "https://dev.leger.aleph-cat.com",
  __ALEPH_OCR_BASE_URL__:
    process.env[`ALEPH_OCR_BASE_URL_${suffix}`] ??
    (environment === "prod" ? "https://ocr.aleph-cat.com" : "https://ocr.dev.aleph-cat.com"),
  __D1_DATABASE_ID__: process.env[`CLOUDFLARE_D1_DATABASE_ID_${suffix}`] ?? "__D1_DATABASE_ID__",
  __R2_BUCKET__: process.env[`CLOUDFLARE_R2_BUCKET_${suffix}`] ?? `shared-ledger-files-${environment}`,
  __QUEUE__: process.env[`CLOUDFLARE_QUEUE_${suffix}`] ?? `shared-ledger-imports-${environment}`,
};
if (target.startsWith("api") && values.__D1_DATABASE_ID__ === "__D1_DATABASE_ID__") {
  throw new Error(`CLOUDFLARE_D1_DATABASE_ID_${suffix} is required to deploy the API.`);
}
const appDir = resolve(repoRoot, "apps", target);
const template = "wrangler.template.jsonc";
let config = await readFile(resolve(appDir, template), "utf8");
for (const [token, value] of Object.entries(values)) config = config.replaceAll(token, value);
await mkdir(appDir, { recursive: true });
await writeFile(resolve(appDir, `wrangler.generated-${target}-${environment}.json`), config);
console.log(`Generated ${target} ${environment} Wrangler config.`);
