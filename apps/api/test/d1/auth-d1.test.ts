import { describe, expect, it } from "vitest";
import { verifyPassword } from "../../src/services/auth";
import { createD1TestApp } from "./harness";

const jsonHeaders = { "Content-Type": "application/json" };

function cookieHeader(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  return header
    .split(/,(?=\s*ledger_)/)
    .map((value) => value.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

describe("D1 auth session lifecycle", () => {
  it("rejects legacy PBKDF2 hashes above Workers iteration limits without throwing", async () => {
    await expect(verifyPassword("123456", "pbkdf2$210000$legacy_salt$legacy_hash")).resolves.toBe(false);
  });

  it("registers, rejects duplicate usernames, refreshes, logs out, and invalidates old passwords after change", async () => {
    const context = createD1TestApp();

    const registered = await context.app.request(
      "/auth/register",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "SoundOnly", password: "123456" }),
      },
      context.env,
    );
    const registeredCookie = cookieHeader(registered);
    const registeredBody = await registered.json<any>();

    expect(registered.status).toBe(201);
    expect(registeredBody.user).toMatchObject({ name: "SoundOnly", plan: "free" });
    expect(registeredCookie).toContain("ledger_session=");
    const userId = registeredBody.user.id;
    expect(context.db.rows.books).toContainEqual(
      expect.objectContaining({ name: "SoundOnly的账本", currency: "CNY", created_by_user_id: userId }),
    );
    expect(context.db.rows.book_members).toContainEqual(
      expect.objectContaining({ user_id: userId, role: "creator" }),
    );
    const defaultCategories = context.db.rows.categories.filter(
      (category) => category.user_id === userId && !category.deleted_at,
    );
    expect(defaultCategories).toHaveLength(17);
    expect(defaultCategories.filter((category) => category.type === "expense")).toHaveLength(10);
    expect(defaultCategories.filter((category) => category.type === "income")).toHaveLength(7);
    expect(defaultCategories.map((category) => category.name)).toEqual(
      expect.arrayContaining([
        "餐饮",
        "交通",
        "购物",
        "水电燃气",
        "医疗健康",
        "娱乐休闲",
        "教育学习",
        "旅行出差",
        "宠物",
        "其他支出",
        "工资",
        "奖金",
        "兼职副业",
        "投资理财",
        "报销",
        "红包转账",
        "其他收入",
      ]),
    );
    expect(defaultCategories.map((category) => category.name)).not.toEqual(
      expect.arrayContaining(["住房", "人情礼物", "通讯网络", "保险", "日用品"]),
    );

    const duplicate = await context.app.request(
      "/auth/register",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ name: "SoundOnly", password: "abcdef" }),
      },
      context.env,
    );
    expect(duplicate.status).toBe(409);

    const me = await context.app.request("/auth/me", { headers: { Cookie: registeredCookie } }, context.env);
    expect(me.status).toBe(200);

    const passwordChanged = await context.app.request(
      "/auth/me/password",
      {
        method: "PUT",
        headers: { ...jsonHeaders, Cookie: registeredCookie },
        body: JSON.stringify({ currentPassword: "123456", newPassword: "654321" }),
      },
      context.env,
    );
    expect(passwordChanged.status).toBe(204);

    const oldPassword = await context.app.request(
      "/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ identifier: "SoundOnly", password: "123456" }),
      },
      context.env,
    );
    expect(oldPassword.status).toBe(401);

    const login = await context.app.request(
      "/auth/login",
      {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ identifier: "SoundOnly", password: "654321" }),
      },
      context.env,
    );
    const loginCookie = cookieHeader(login);
    expect(login.status).toBe(200);
    expect(loginCookie).toContain("ledger_refresh=");

    const refreshed = await context.app.request(
      "/auth/refresh",
      { method: "POST", headers: { Cookie: loginCookie } },
      context.env,
    );
    expect(refreshed.status).toBe(204);
    expect(cookieHeader(refreshed)).toContain("ledger_session=");

    const logout = await context.app.request(
      "/auth/logout",
      { method: "POST", headers: { Cookie: loginCookie } },
      context.env,
    );
    expect(logout.status).toBe(204);

    const refreshAfterLogout = await context.app.request(
      "/auth/refresh",
      { method: "POST", headers: { Cookie: loginCookie } },
      context.env,
    );
    expect(refreshAfterLogout.status).toBe(401);
  });
});
