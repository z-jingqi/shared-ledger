import type { LedgerUser } from "../types";

const encoder = new TextEncoder();
const sessionTtlMs = 15 * 60 * 1000;
const refreshTtlMs = 30 * 24 * 60 * 60 * 1000;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

type UserRow = {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  phone: string | null;
  plan: "free" | "pro" | null;
  provider: "password" | "google" | "wechat" | null;
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
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: 210_000 },
    key,
    256,
  );
  return `pbkdf2$210000$${salt}$${base64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, iterations, salt, expected] = encoded.split("$");
  if (algorithm !== "pbkdf2" || !iterations || !salt || !expected) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: Number(iterations) },
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
  return {
    id: row.id,
    name: row.name,
    email: row.email ?? "",
    plan: row.plan ?? "free",
    ...(row.avatarUrl ? { avatarUrl: row.avatarUrl } : {}),
  };
}

async function findUser(db: D1Database, where: string, value: string) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl, u.phone, s.plan, i.provider
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       LEFT JOIN auth_identities i ON i.user_id = u.id
       WHERE ${where}
       ORDER BY s.created_at DESC
       LIMIT 1`,
    )
    .bind(...Array((where.match(/\?/g) ?? []).length).fill(value))
    .first<UserRow>();
}

export async function createPasswordAccount(
  db: D1Database,
  input: { name: string; password: string },
) {
  const username = input.name.trim();
  const existingIdentity = await db
    .prepare("SELECT id FROM auth_identities WHERE provider = 'password' AND provider_account_id = ? LIMIT 1")
    .bind(username)
    .first<{ id: string }>();
  if (existingIdentity || (await findUser(db, "u.name = ?", username))) throw new Error("用户名已被使用");

  const now = new Date().toISOString();
  const userId = `user_${crypto.randomUUID()}`;
  const passwordHash = await hashPassword(input.password);
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id,name,email,phone,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(userId, username, null, null, passwordHash, now, now),
    db
      .prepare(
        "INSERT INTO auth_identities (id,user_id,provider,provider_account_id,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(`identity_${crypto.randomUUID()}`, userId, "password", username, passwordHash, now, now),
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(`subscription_${crypto.randomUUID()}`, userId, "free", "active", now, now, now),
  ]);
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
      `SELECT u.id, u.name, u.email, u.avatar_url AS avatarUrl, u.phone, s.plan, i.provider
       FROM auth_sessions session
       JOIN users u ON u.id = session.user_id
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       LEFT JOIN auth_identities i ON i.user_id = u.id
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
  const identity = await db
    .prepare(
      "SELECT provider FROM auth_identities WHERE user_id = ? AND provider IN ('google','wechat') LIMIT 1",
    )
    .bind(userId)
    .first<{ provider: string }>();
  if (!identity && !contact.email && !contact.phone) throw new Error("订阅前请补充邮箱或手机号");

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
        "UPDATE users SET email = COALESCE(?, email), phone = COALESCE(?, phone), updated_at = ? WHERE id = ?",
      )
      .bind(contact.email ?? null, contact.phone ?? null, now, userId),
    db
      .prepare(
        "UPDATE subscriptions SET status = 'expired', updated_at = ? WHERE user_id = ? AND status = 'active'",
      )
      .bind(now, userId),
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(`subscription_${crypto.randomUUID()}`, userId, "pro", "active", now, now, now),
  ]);
}

export async function createOAuthState(db: D1Database, provider: "google" | "wechat", redirectTo?: string) {
  const state = randomToken(24);
  const timestamp = new Date().toISOString();
  await db
    .prepare("INSERT INTO oauth_states (state,provider,redirect_to,expires_at,created_at) VALUES (?,?,?,?,?)")
    .bind(state, provider, redirectTo ?? null, new Date(Date.now() + 10 * 60 * 1000).toISOString(), timestamp)
    .run();
  return state;
}

export async function consumeOAuthState(db: D1Database, provider: "google" | "wechat", state: string) {
  const value = await db
    .prepare(
      "SELECT redirect_to AS redirectTo, expires_at AS expiresAt FROM oauth_states WHERE state = ? AND provider = ?",
    )
    .bind(state, provider)
    .first<{ redirectTo: string | null; expiresAt: string }>();
  await db.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
  if (!value || new Date(value.expiresAt) <= new Date()) return null;
  return value.redirectTo ?? undefined;
}

export async function createOrFindOAuthUser(
  db: D1Database,
  profile: { provider: "google" | "wechat"; providerAccountId: string; name: string; email?: string },
) {
  const existing = await db
    .prepare(
      `SELECT u.id,u.name,u.email,u.avatar_url AS avatarUrl,u.phone,s.plan,i.provider
       FROM auth_identities i JOIN users u ON u.id = i.user_id
       LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active'
       WHERE i.provider = ? AND i.provider_account_id = ? LIMIT 1`,
    )
    .bind(profile.provider, profile.providerAccountId)
    .first<UserRow>();
  if (existing) return toLedgerUser(existing);

  if (profile.email) {
    const emailOwner = await findUser(db, "u.email = ?", profile.email);
    if (emailOwner) {
      const timestamp = new Date().toISOString();
      await db
        .prepare(
          "INSERT INTO auth_identities (id,user_id,provider,provider_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
        )
        .bind(
          id("identity"),
          emailOwner.id,
          profile.provider,
          profile.providerAccountId,
          timestamp,
          timestamp,
        )
        .run();
      return toLedgerUser(emailOwner);
    }
  }
  const timestamp = new Date().toISOString();
  const userId = id("user");
  await db.batch([
    db
      .prepare("INSERT INTO users (id,name,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(
        userId,
        profile.name.slice(0, 60) || "账本用户",
        profile.email ?? null,
        await hashPassword(randomToken()),
        timestamp,
        timestamp,
      ),
    db
      .prepare(
        "INSERT INTO auth_identities (id,user_id,provider,provider_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(id("identity"), userId, profile.provider, profile.providerAccountId, timestamp, timestamp),
    db
      .prepare(
        "INSERT INTO subscriptions (id,user_id,plan,status,started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(id("subscription"), userId, "free", "active", timestamp, timestamp, timestamp),
  ]);
  return {
    id: userId,
    name: profile.name.slice(0, 60) || "账本用户",
    email: profile.email ?? "",
    plan: "free" as const,
  };
}

export async function updateUserAvatar(db: D1Database, userId: string, avatarUrl: string) {
  const timestamp = new Date().toISOString();
  await db
    .prepare("UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?")
    .bind(avatarUrl, timestamp, userId)
    .run();
}
