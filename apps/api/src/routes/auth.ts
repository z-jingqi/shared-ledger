import { changePasswordSchema, loginSchema, registerSchema, subscriptionContactSchema, updateProfileSchema } from "@shared-ledger/shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import {
  authenticatePassword,
  changeUserPassword,
  createPasswordAccount,
  createSessionPair,
  findSessionUser,
  refreshSession,
  revokeRefreshToken,
  revokeSession,
  updateUserAvatar,
  updateUserProfile,
  upgradeSubscription,
} from "../services/auth";
import { currentUser } from "../services/access";
import type { MemoryLedgerStore } from "../store";
import type { Env } from "../types";

const accessCookieOptions = (environment?: string) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
  secure: environment !== "local" && environment !== "test",
  maxAge: 60 * 15,
});
const refreshCookieOptions = (environment?: string) => ({
  httpOnly: true,
  sameSite: "Lax" as const,
  path: "/",
  secure: environment !== "local" && environment !== "test",
  maxAge: 60 * 60 * 24 * 30,
});
const avatarTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const maxAvatarBytes = 1024 * 1024;

function setAuthCookies(context: any, tokens: { accessToken: string; refreshToken: string }) {
  setCookie(context, "ledger_session", tokens.accessToken, accessCookieOptions(context.env.APP_ENV));
  setCookie(context, "ledger_refresh", tokens.refreshToken, refreshCookieOptions(context.env.APP_ENV));
}
function clearAuthCookies(context: any) {
  deleteCookie(context, "ledger_session", { path: "/" });
  deleteCookie(context, "ledger_refresh", { path: "/" });
}
function avatarContentType(file: File) {
  const type = file.type.toLowerCase();
  return avatarTypes[type] ? type : undefined;
}
function dataUrlFromBytes(contentType: string, buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

export function registerAuthRoutes(app: Hono<{ Bindings: Env }>, store?: MemoryLedgerStore) {
  app.post("/auth/register", async (context) => {
    const body = await parseJson(context, registerSchema);
    if (!body) return jsonError(context, "注册信息不合法");
    try {
      if (context.env.DB) {
        const user = await createPasswordAccount(context.env.DB, body);
        setAuthCookies(context, await createSessionPair(context.env.DB, user.id));
        return context.json({ user }, 201);
      }
      if (context.env.APP_ENV !== "test" || !store) return jsonError(context, "认证需要 D1 运行时", 503);
      return context.json({ user: store.createUser(body.name, "") }, 201);
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "注册失败", 409);
    }
  });
  app.post("/auth/login", async (context) => {
    const body = await parseJson(context, loginSchema);
    if (!body) return jsonError(context, "请输入账号和密码");
    if (context.env.DB) {
      const user = await authenticatePassword(context.env.DB, body.identifier, body.password);
      if (!user) return jsonError(context, "账号或密码错误", 401);
      setAuthCookies(context, await createSessionPair(context.env.DB, user.id));
      return context.json({ user });
    }
    if (context.env.APP_ENV !== "test" || !store) return jsonError(context, "认证需要 D1 运行时", 503);
    const user = store.users.find(
      (item) => item.name === body.identifier || item.email === body.identifier || item.id === body.identifier,
    );
    return user ? context.json({ user }) : jsonError(context, "账号或密码错误", 401);
  });
  app.post("/auth/logout", async (context) => {
    if (context.env.DB) await revokeSession(context.env.DB, getCookie(context, "ledger_session"));
    if (context.env.DB) await revokeRefreshToken(context.env.DB, getCookie(context, "ledger_refresh"));
    clearAuthCookies(context);
    return context.body(null, 204);
  });
  app.post("/auth/refresh", async (context) => {
    if (!context.env.DB) return jsonError(context, "认证需要 D1 运行时", 503);
    const tokens = await refreshSession(context.env.DB, getCookie(context, "ledger_refresh"));
    if (!tokens) {
      clearAuthCookies(context);
      return jsonError(context, "登录已过期，请重新登录", 401);
    }
    setAuthCookies(context, tokens);
    return context.body(null, 204);
  });
  app.get("/auth/me", async (context) => {
    const user = await currentUser(context, store);
    return user ? context.json({ user }) : jsonError(context, "未登录", 401);
  });

  app.patch("/auth/me/profile", async (context) => {
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "未登录", 401);
    const body = await parseJson(context, updateProfileSchema);
    if (!body) return jsonError(context, "资料不合法");

    if (context.env.DB) {
      try {
        return context.json({ user: await updateUserProfile(context.env.DB, user.id, body) });
      } catch (error) {
        return jsonError(context, error instanceof Error ? error.message : "保存失败", 409);
      }
    }

    if (context.env.APP_ENV === "test" && store) {
      const duplicateName = store.users.find((item) => item.name === body.name && item.id !== user.id);
      if (duplicateName) return jsonError(context, "用户名已被使用", 409);
      const email = body.email?.trim() || "";
      const duplicateEmail = email && store.users.find((item) => item.email === email && item.id !== user.id);
      if (duplicateEmail) return jsonError(context, "邮箱已被其他用户使用", 409);
      const stored = store.users.find((item) => item.id === user.id);
      if (!stored) return jsonError(context, "用户不存在", 404);
      stored.name = body.name;
      stored.email = email;
      return context.json({ user: stored });
    }
    return jsonError(context, "资料编辑需要 D1 运行时", 503);
  });

  app.put("/auth/me/password", async (context) => {
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "未登录", 401);
    const body = await parseJson(context, changePasswordSchema);
    if (!body) return jsonError(context, "密码不合法");

    if (context.env.DB) {
      try {
        await changeUserPassword(context.env.DB, user.id, body);
        return context.body(null, 204);
      } catch (error) {
        return jsonError(context, error instanceof Error ? error.message : "修改密码失败", 400);
      }
    }

    if (context.env.APP_ENV === "test") return context.body(null, 204);
    return jsonError(context, "密码修改需要 D1 运行时", 503);
  });

  app.put("/auth/me/avatar", async (context) => {
    const user = await currentUser(context, store);
    if (!user) return jsonError(context, "未登录", 401);
    const data = await context.req.formData().catch(() => null);
    const avatar = data?.get("avatar");
    if (!(avatar instanceof File)) return jsonError(context, "请选择头像文件");
    const contentType = avatarContentType(avatar);
    if (!contentType) return jsonError(context, "头像仅支持 JPG、PNG 或 WebP");
    if (avatar.size > maxAvatarBytes) return jsonError(context, "头像不能超过 1MB");
    const avatarUrl = dataUrlFromBytes(contentType, await avatar.arrayBuffer());

    if (context.env.DB) {
      await updateUserAvatar(context.env.DB, user.id, avatarUrl);
      return context.json({ user: { ...user, avatarUrl } });
    }

    if (context.env.APP_ENV === "test" && store) {
      const stored = store.users.find((item) => item.id === user.id);
      if (stored) stored.avatarUrl = avatarUrl;
      return context.json({ user: { ...user, avatarUrl } });
    }
    return jsonError(context, "头像上传需要 D1 运行时", 503);
  });

  app.post("/subscriptions/pro", async (context) => {
    if (!context.env.DB) return jsonError(context, "订阅功能需要 D1 运行时", 503);
    const user = await findSessionUser(context.env.DB, getCookie(context, "ledger_session"));
    if (!user) return jsonError(context, "未登录", 401);
    const body = await context.req.json().catch(() => ({}));
    const parsed = subscriptionContactSchema.safeParse(body);
    try {
      await upgradeSubscription(context.env.DB, user.id, parsed.success ? parsed.data : {});
      return context.json({ plan: "pro" });
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "订阅失败", 400);
    }
  });
}
