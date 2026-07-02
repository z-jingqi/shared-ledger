import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { localWranglerEnv, pnpmCommand } from "./local-wrangler-runner.mjs";

const encoder = new TextEncoder();
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const timestamp = new Date().toISOString();
const seed = {
  userId: "user_c1e66e4c-20be-4f52-9e97-3dc908281db2",
  username: "SoundOnly",
  password: "123456",
  identityId: "identity_soundonly_password",
  subscriptionId: "subscription_soundonly_free",
  bookId: "book_b9b09bba-5d9c-4947-ba1a-2db10c9b97c1",
  memberId: "member_soundonly_creator",
  bookName: "SoundOnly",
};

const passwordHash = await hashPassword(seed.password);
const sql = `
BEGIN TRANSACTION;

INSERT INTO users (id,name,email,phone,avatar_url,password_hash,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,deleted_by_user_id)
VALUES (${q(seed.userId)},${q(seed.username)},NULL,NULL,NULL,${q(passwordHash)},${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)},NULL,NULL)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  password_hash=excluded.password_hash,
  updated_by_user_id=excluded.updated_by_user_id,
  updated_at=excluded.updated_at,
  deleted_at=NULL,
  deleted_by_user_id=NULL;

INSERT INTO auth_identities (id,user_id,provider,provider_account_id,password_hash,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,deleted_by_user_id)
VALUES (${q(seed.identityId)},${q(seed.userId)},'password',${q(seed.username)},${q(passwordHash)},${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)},NULL,NULL)
ON CONFLICT(provider,provider_account_id) DO UPDATE SET
  user_id=excluded.user_id,
  password_hash=excluded.password_hash,
  updated_by_user_id=excluded.updated_by_user_id,
  updated_at=excluded.updated_at,
  deleted_at=NULL,
  deleted_by_user_id=NULL;

INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,deleted_by_user_id)
VALUES (${q(seed.subscriptionId)},${q(seed.userId)},'free','active',${q(timestamp)},${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)},NULL,NULL)
ON CONFLICT(id) DO UPDATE SET
  user_id=excluded.user_id,
  plan=excluded.plan,
  status=excluded.status,
  updated_by_user_id=excluded.updated_by_user_id,
  updated_at=excluded.updated_at,
  deleted_at=NULL,
  deleted_by_user_id=NULL;

INSERT INTO books (id,name,currency,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,deleted_by_user_id)
VALUES (${q(seed.bookId)},${q(seed.bookName)},'CNY',${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)},NULL,NULL)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  currency=excluded.currency,
  updated_by_user_id=excluded.updated_by_user_id,
  updated_at=excluded.updated_at,
  deleted_at=NULL,
  deleted_by_user_id=NULL;

DELETE FROM book_members WHERE book_id=${q(seed.bookId)} AND user_id=${q(seed.userId)};
INSERT INTO book_members (id,book_id,user_id,role,joined_at,created_by_user_id,updated_by_user_id,created_at,updated_at,deleted_at,deleted_by_user_id)
VALUES (${q(seed.memberId)},${q(seed.bookId)},${q(seed.userId)},'creator',${q(timestamp)},${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)},NULL,NULL);

COMMIT;
`;

const sqlPath = join(tmpdir(), `shared-ledger-local-seed-${Date.now()}.sql`);
writeFileSync(sqlPath, sql, "utf8");
mkdirSync(resolve(root, ".wrangler", "xdg.config"), { recursive: true });

const command = pnpmCommand([
  "--filter",
  "@shared-ledger/api",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "shared-ledger-local",
  "--local",
  "--config",
  "wrangler.local.jsonc",
  "--file",
  sqlPath,
]);
const result = spawnSync(command.command, command.args, {
  cwd: root,
  env: localWranglerEnv(root),
  shell: command.shell,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error);
}
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Seeded local D1 with ${seed.username} / ${seed.password}`);

async function hashPassword(password) {
  const salt = randomToken(16);
  const key = await webcrypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 210_000 },
    key,
    256,
  );
  return `pbkdf2$210000$${salt}$${base64(new Uint8Array(bits))}`;
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  webcrypto.getRandomValues(value);
  return base64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function q(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
