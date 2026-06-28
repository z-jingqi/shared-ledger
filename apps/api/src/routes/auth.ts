import { changePasswordSchema, loginSchema, registerSchema, subscriptionContactSchema, updateProfileSchema } from "@shared-ledger/shared";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Hono } from "hono";
import { jsonError, parseJson } from "../lib/http";
import {
  authenticatePassword,
  changeUserPassword,
  consumeOAuthState,
  createOAuthState,
  createOrFindOAuthUser,
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
const providers = ["google", "wechat"] as const;
type Provider = (typeof providers)[number];
const isProvider = (provider: string): provider is Provider =>
  (providers as readonly string[]).includes(provider);
const avatarTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const maxAvatarBytes = 1024 * 1024;

function callbackUrl(context: any, provider: Provider) {
  return new URL(`/auth/oauth/${provider}/callback`, context.req.url).toString();
}
function safeRedirect(context: any, value?: string) {
  const origin = context.env.WEB_ORIGIN;
  if (!value || !origin) return origin ?? "/";
  try {
    return new URL(value).origin === new URL(origin).origin ? value : origin;
  } catch {
    return origin;
  }
}
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

  app.get("/auth/oauth/:provider", async (context) => {
    const provider = context.req.param("provider");
    if (!isProvider(provider)) return jsonError(context, "不支持的授权登录方式", 404);
    if (!context.env.DB) return jsonError(context, "授权登录需要 D1 运行时", 503);
    const state = await createOAuthState(
      context.env.DB,
      provider,
      safeRedirect(context, context.req.query("redirectTo")),
    );
    const redirectUri = callbackUrl(context, provider);
    if (provider === "google") {
      if (!context.env.GOOGLE_CLIENT_ID || !context.env.GOOGLE_CLIENT_SECRET)
        return jsonError(context, "Google OAuth 尚未配置", 503);
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: context.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state,
        access_type: "offline",
        prompt: "select_account",
      }).toString();
      return context.redirect(url.toString(), 302);
    }
    if (!context.env.WECHAT_APP_ID || !context.env.WECHAT_APP_SECRET)
      return jsonError(context, "微信 OAuth 尚未配置", 503);
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.search = new URLSearchParams({
      appid: context.env.WECHAT_APP_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "snsapi_userinfo",
      state,
    }).toString();
    return context.redirect(`${url.toString()}#wechat_redirect`, 302);
  });

  app.get("/auth/oauth/:provider/callback", async (context) => {
    const provider = context.req.param("provider");
    if (!isProvider(provider)) return jsonError(context, "不支持的授权登录方式", 404);
    if (!context.env.DB) return jsonError(context, "授权登录需要 D1 运行时", 503);
    const code = context.req.query("code"),
      state = context.req.query("state");
    if (!code || !state) return jsonError(context, "授权回调缺少 code 或 state");
    const redirectTo = await consumeOAuthState(context.env.DB, provider, state);
    if (redirectTo === null) return jsonError(context, "授权状态无效或已过期", 400);
    try {
      const redirectUri = callbackUrl(context, provider);
      let profile: { provider: Provider; providerAccountId: string; name: string; email?: string };
      if (provider === "google") {
        if (!context.env.GOOGLE_CLIENT_ID || !context.env.GOOGLE_CLIENT_SECRET)
          return jsonError(context, "Google OAuth 尚未配置", 503);
        const token = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: context.env.GOOGLE_CLIENT_ID,
            client_secret: context.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        }).then((response) =>
          response.ok
            ? response.json<{ access_token: string }>()
            : Promise.reject(new Error("Google 授权码兑换失败")),
        );
        const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { authorization: `Bearer ${token.access_token}` },
        }).then((response) =>
          response.ok
            ? response.json<{ sub: string; name?: string; email?: string }>()
            : Promise.reject(new Error("读取 Google 用户信息失败")),
        );
        profile = {
          provider,
          providerAccountId: info.sub,
          name: info.name ?? info.email ?? "Google 用户",
          email: info.email,
        };
      } else {
        if (!context.env.WECHAT_APP_ID || !context.env.WECHAT_APP_SECRET)
          return jsonError(context, "微信 OAuth 尚未配置", 503);
        const tokenUrl = new URL("https://api.weixin.qq.com/sns/oauth2/access_token");
        tokenUrl.search = new URLSearchParams({
          appid: context.env.WECHAT_APP_ID,
          secret: context.env.WECHAT_APP_SECRET,
          code,
          grant_type: "authorization_code",
        }).toString();
        const token = await fetch(tokenUrl).then((response) =>
          response.ok
            ? response.json<{ access_token?: string; openid?: string }>()
            : Promise.reject(new Error("微信授权码兑换失败")),
        );
        if (!token.access_token || !token.openid) throw new Error("微信授权码无效");
        const infoUrl = new URL("https://api.weixin.qq.com/sns/userinfo");
        infoUrl.search = new URLSearchParams({
          access_token: token.access_token,
          openid: token.openid,
          lang: "zh_CN",
        }).toString();
        const info = await fetch(infoUrl).then((response) =>
          response.ok
            ? response.json<{ openid?: string; nickname?: string }>()
            : Promise.reject(new Error("读取微信用户信息失败")),
        );
        if (!info.openid) throw new Error("微信未返回用户标识");
        profile = { provider, providerAccountId: info.openid, name: info.nickname ?? "微信用户" };
      }
      const user = await createOrFindOAuthUser(context.env.DB, profile);
      setAuthCookies(context, await createSessionPair(context.env.DB, user.id));
      return context.redirect(safeRedirect(context, redirectTo), 302);
    } catch (error) {
      return jsonError(context, error instanceof Error ? error.message : "第三方授权失败", 502);
    }
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
