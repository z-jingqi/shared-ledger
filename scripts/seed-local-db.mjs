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
const passwordHashIterations = 100_000;
const seed = {
  userId: "user_c1e66e4c-20be-4f52-9e97-3dc908281db2",
  username: "SoundOnly",
  password: "123456",
  identityId: "identity_soundonly_password",
  subscriptionId: "subscription_soundonly_free",
  bookId: "book_b9b09bba-5d9c-4947-ba1a-2db10c9b97c1",
  memberId: "member_soundonly_creator",
  bookName: "SoundOnly的账本",
};
const defaultCategories = [
  { name: "餐饮", type: "expense", icon: "fork-knife" },
  { name: "交通", type: "expense", icon: "car" },
  { name: "购物", type: "expense", icon: "shopping-bag" },
  { name: "水电燃气", type: "expense", icon: "lightning" },
  { name: "医疗健康", type: "expense", icon: "first-aid" },
  { name: "娱乐休闲", type: "expense", icon: "game-controller" },
  { name: "教育学习", type: "expense", icon: "book-open" },
  { name: "旅行出差", type: "expense", icon: "airplane" },
  { name: "宠物", type: "expense", icon: "paw-print" },
  { name: "其他支出", type: "expense", icon: "dots-three" },
  { name: "工资", type: "income", icon: "wallet" },
  { name: "奖金", type: "income", icon: "trophy" },
  { name: "兼职副业", type: "income", icon: "briefcase" },
  { name: "投资理财", type: "income", icon: "trend-up" },
  { name: "报销", type: "income", icon: "receipt" },
  { name: "红包转账", type: "income", icon: "gift" },
  { name: "其他收入", type: "income", icon: "plus-circle" },
];

const passwordHash = await hashPassword(seed.password);
const categoriesSql = defaultCategories
  .map((category, index) => {
    const categoryId = `category_soundonly_${category.type}_${slug(category.name)}`;
    return `
INSERT INTO categories (id,user_id,name,type,icon,sort_order,created_by_user_id,updated_by_user_id,created_at,updated_at)
SELECT ${q(categoryId)},${q(seed.userId)},${q(category.name)},${q(category.type)},${q(category.icon)},${index + 1},${q(seed.userId)},${q(seed.userId)},${q(timestamp)},${q(timestamp)}
WHERE NOT EXISTS (
  SELECT 1 FROM categories
  WHERE user_id=${q(seed.userId)} AND type=${q(category.type)} AND name=${q(category.name)} AND deleted_at IS NULL
);`;
  })
  .join("\n");
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

${categoriesSql}

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
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: passwordHashIterations },
    key,
    256,
  );
  return `pbkdf2$${passwordHashIterations}$${salt}$${base64(new Uint8Array(bits))}`;
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

function slug(value) {
  return [...value].map((character) => character.codePointAt(0)?.toString(16) ?? "").join("_");
}
