import type { LedgerUser } from "../types";

const encoder = new TextEncoder();
const sessionTtlMs = 15 * 60 * 1000;
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;
const passwordHashIterations = 100_000;
const maxWorkerPbkdf2Iterations = 100_000;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
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
] as const;

type UserRow = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  phone: string | null;
  plan: "free" | "pro" | null;
};

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function digest(value: string) {
  return base64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hashPassword(password: string) {
  const salt = randomToken(16);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: passwordHashIterations },
    key,
    256,
  );
  return `pbkdf2$${passwordHashIterations}$${salt}$${base64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterations, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2" || !iterations || !salt || !expected) return false;
  const iterationCount = Number(iterations);
  if (
    !Number.isInteger(iterationCount) ||
    iterationCount <= 0 ||
    iterationCount > maxWorkerPbkdf2Iterations
  ) {
    return false;
  }
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: iterationCount },
    key,
    256,
  );
  const actual = base64(new Uint8Array(bits));
  if (actual.length !== expected.length) return false;
  return (
    actual
      .split("")
      .reduce(
        (match, character, index) => match | (character.charCodeAt(0) ^ expected.charCodeAt(index)),
        0,
      ) === 0
  );
}

function toLedgerUser(row: UserRow): LedgerUser {
  const avatarUrl = normalizeStoredAvatarUrl(row.avatarUrl);
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    ...(row.phone ? { phone: row.phone } : {}),
    plan: row.plan ?? "free",
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function normalizeStoredAvatarUrl(value: string | null) {
  if (!value || value.includes("/auth/avatar/")) return undefined;
  return value;
}

async function findUser(db: D1Database, where: string, value: string) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl, u.phone, s.plan
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       LEFT JOIN auth_identities i ON i.user_id = u.id AND i.provider = 'password'
       WHERE u.deleted_at IS NULL AND (${where})
       ORDER BY s.created_at DESC
       LIMIT 1`,
    )
    .bind(...Array((where.match(/\?/g) ?? []).length).fill(value))
    .first<UserRow>();
}

export async function createPasswordAccount(db: D1Database, input: { name: string; password: string }) {
  const username = input.name.trim();
  const existingIdentity = await db
    .prepare("SELECT id FROM auth_identities WHERE provider = 'password' AND provider_account_id = ? LIMIT 1")
    .bind(username)
    .first<{ id: string }>();
  if (existingIdentity || (await findUser(db, "u.name = ?", username))) throw new Error("用户名已被使用");

  const now = new Date().toISOString();
  const userId = `user_${crypto.randomUUID()}`;
  const bookId = `book_${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(input.password);
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO users (id,name,email,phone,password_hash,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(userId, username, null, null, passwordHash, userId, userId, now, now),
    db
      .prepare(
        "INSERT INTO auth_identities (id,user_id,provider,provider_account_id,password_hash,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        `identity_${crypto.randomUUID()}`,
        userId,
        "password",
        username,
        passwordHash,
        userId,
        userId,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(`subscription_${crypto.randomUUID()}`, userId, "free", "active", now, userId, userId, now, now),
    db
      .prepare(
        "INSERT INTO books (id,name,currency,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(bookId, username, "CNY", userId, userId, now, now),
    db
      .prepare(
        "INSERT INTO book_members (id,book_id,user_id,role,joined_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(`member_${crypto.randomUUID()}`, bookId, userId, "creator", now, userId, userId, now, now),
  ];
  defaultCategories.forEach((category, index) => {
    statements.push(
      db
        .prepare(
          "INSERT INTO categories (id,user_id,name,type,icon,sort_order,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          `category_${crypto.randomUUID()}`,
          userId,
          category.name,
          category.type,
          category.icon,
          index + 1,
          userId,
          userId,
          now,
          now,
        ),
    );
  });
  await db.batch(statements);
  return { id: userId, name: username, email: "", plan: "free" as const };
}

export async function authenticatePassword(db: D1Database, identifier: string, password: string) {
  const user = await findUser(
    db,
    "(i.provider = 'password' AND i.provider_account_id = ?) OR u.name = ? OR u.email = ? OR u.phone = ?",
    identifier,
  );
  if (!user) return null;
  const identity = await db
    .prepare("SELECT password_hash FROM auth_identities WHERE user_id = ? AND provider = 'password'")
    .bind(user.id)
    .first<{ password_hash: string }>();
  return identity && (await verifyPassword(password, identity.password_hash)) ? toLedgerUser(user) : null;
}

export async function createSession(db: D1Database, userId: string) {
  const token = randomToken();
  const now = new Date();
  await db
    .prepare("INSERT INTO auth_sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(
      `session_${crypto.randomUUID()}`,
      userId,
      await digest(token),
      new Date(now.getTime() + sessionTtlMs).toISOString(),
      now.toISOString(),
    )
    .run();
  return token;
}

export async function createRefreshToken(db: D1Database, userId: string) {
  const token = randomToken();
  const now = new Date();
  await db
    .prepare("INSERT INTO refresh_tokens (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(
      id("refresh"),
      userId,
      await digest(token),
      new Date(now.getTime() + refreshTtlMs).toISOString(),
      now.toISOString(),
    )
    .run();
  return token;
}

export async function createSessionPair(db: D1Database, userId: string) {
  const [accessToken, refreshToken] = await Promise.all([
    createSession(db, userId),
    createRefreshToken(db, userId),
  ]);
  return { accessToken, refreshToken };
}

export async function findSessionUser(db: D1Database, token?: string) {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl, u.phone, s.plan
       FROM auth_sessions session
       JOIN users u ON u.id = session.user_id
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE session.token_hash = ? AND session.expires_at > ?
       LIMIT 1`,
    )
    .bind(await digest(token), new Date().toISOString())
    .first<UserRow>();
  return row ? toLedgerUser(row) : null;
}

export async function revokeSession(db: D1Database, token?: string) {
  if (token)
    await db
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .bind(await digest(token))
      .run();
}

export async function revokeRefreshToken(db: D1Database, token?: string) {
  if (!token) return;
  await db
    .prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), await digest(token))
    .run();
}

export async function refreshSession(db: D1Database, refreshToken?: string) {
  if (!refreshToken) return null;
  const row = await db
    .prepare(
      `SELECT user_id AS userId
       FROM refresh_tokens
       WHERE token_hash = ? AND expires_at > ? AND revoked_at IS NULL
       LIMIT 1`,
    )
    .bind(await digest(refreshToken), new Date().toISOString())
    .first<{ userId: string }>();
  if (!row) return null;
  await revokeRefreshToken(db, refreshToken);
  return createSessionPair(db, row.userId);
}

export async function upgradeSubscription(
  db: D1Database,
  userId: string,
  contact: { email?: string; phone?: string },
) {
  if (!contact.email && !contact.phone) throw new Error("订阅前请补充邮箱或手机号");

  if (contact.email) {
    const owner = await findUser(db, "u.email = ?", contact.email);
    if (owner && owner.id !== userId) throw new Error("邮箱已被其他用户使用");
  }
  if (contact.phone) {
    const owner = await findUser(db, "u.phone = ?", contact.phone);
    if (owner && owner.id !== userId) throw new Error("手机号已被其他用户使用");
  }

  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE users SET email = COALESCE(?, email), phone = COALESCE(?, phone), updated_at = ?, updated_by_user_id = ? WHERE id = ?",
      )
      .bind(contact.email ?? null, contact.phone ?? null, now, userId, userId),
    db
      .prepare(
        "UPDATE subscriptions SET status = 'expired', updated_at = ?, updated_by_user_id = ? WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL",
      )
      .bind(now, userId, userId),
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_by_user_id,updated_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .bind(`subscription_${crypto.randomUUID()}`, userId, "pro", "active", now, userId, userId, now, now),
  ]);
}

export async function updateUserProfile(
  db: D1Database,
  userId: string,
  input: { name: string; email?: string },
) {
  const name = input.name.trim();
  const email = input.email?.trim() || null;
  const current = await findUser(db, "u.id = ?", userId);
  if (!current) throw new Error("用户不存在");

  const sameName = await findUser(db, "u.name = ?", name);
  if (sameName && sameName.id !== userId) throw new Error("用户名已被使用");
  if (email) {
    const sameEmail = await findUser(db, "u.email = ?", email);
    if (sameEmail && sameEmail.id !== userId) throw new Error("邮箱已被其他用户使用");
  }

  await db
    .prepare("UPDATE users SET name = ?, email = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
    .bind(name, email, new Date().toISOString(), userId, userId)
    .run();
  const updated = await findUser(db, "u.id = ?", userId);
  if (!updated) throw new Error("用户不存在");
  return toLedgerUser(updated);
}

export async function changeUserPassword(
  db: D1Database,
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const identity = await db
    .prepare(
      "SELECT id,password_hash AS passwordHash FROM auth_identities WHERE user_id = ? AND provider = 'password'",
    )
    .bind(userId)
    .first<{ id: string; passwordHash: string }>();
  if (!identity) throw new Error("当前账号不支持密码修改");
  if (!(await verifyPassword(input.currentPassword, identity.passwordHash)))
    throw new Error("当前密码不正确");
  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE auth_identities SET password_hash = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?",
      )
      .bind(passwordHash, now, userId, identity.id),
    db
      .prepare("UPDATE users SET password_hash = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
      .bind(passwordHash, now, userId, userId),
  ]);
}

export async function findUserForInvitation(db: D1Database, target: string) {
  const value = target.trim();
  if (!value) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl, u.phone, s.plan
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE u.deleted_at IS NULL AND (u.id = ? OR u.name = ? OR u.email = ? OR u.phone = ?)
       ORDER BY s.created_at DESC
       LIMIT 1`,
    )
    .bind(value, value, value, value)
    .first<UserRow>();
  if (!row) return null;
  return { ...toLedgerUser(row), phone: row.phone ?? undefined };
}

export async function updateUserAvatar(db: D1Database, userId: string, avatarUrl: string) {
  const timestamp = new Date().toISOString();
  await db
    .prepare("UPDATE users SET avatar_url = ?, updated_at = ?, updated_by_user_id = ? WHERE id = ?")
    .bind(avatarUrl, timestamp, userId, userId)
    .run();
}
