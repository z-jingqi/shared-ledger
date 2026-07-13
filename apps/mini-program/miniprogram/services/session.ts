import { clearSession, request, storedRefreshToken, storeSession } from "./api";

const ACTIVE_BOOK_KEY = "shared-ledger:mini-active-book";
let restoreAttempted = false;
let restorePromise: Promise<SessionState> | null = null;

export interface SessionState {
  user: LedgerUser;
  books: LedgerBook[];
  activeBook: LedgerBook | null;
}

function applyState(user: LedgerUser, books: LedgerBook[]): SessionState {
  const app = getApp<IAppOption>();
  const storedId = String(wx.getStorageSync(ACTIVE_BOOK_KEY) || "");
  const activeBook = books.find((book) => book.id === storedId) || books[0] || null;
  app.globalData.user = user;
  app.globalData.books = books;
  app.globalData.activeBook = activeBook;
  return { user, books, activeBook };
}

export async function restore() {
  if (!restorePromise) {
    restoreAttempted = true;
    restorePromise = Promise.all([
      request<{ user: LedgerUser }>({ path: "/auth/me" }),
      request<{ books: LedgerBook[] }>({ path: "/books" }),
    ])
      .then(([me, result]) => applyState(me.user, result.books || []))
      .finally(() => {
        restorePromise = null;
      });
  }
  return restorePromise;
}

export async function ensure(): Promise<SessionState> {
  const app = getApp<IAppOption>();
  if (app.globalData.user) {
    return {
      user: app.globalData.user,
      books: app.globalData.books || [],
      activeBook: app.globalData.activeBook,
    };
  }
  return restore();
}

export async function optionalSession(): Promise<SessionState | null> {
  const app = getApp<IAppOption>();
  if (restorePromise) {
    try {
      return await restorePromise;
    } catch {
      clearState();
      return null;
    }
  }
  if (restoreAttempted && !app.globalData.user) return null;
  try {
    return await ensure();
  } catch {
    clearState();
    return null;
  }
}

export async function wechatLogin() {
  const code = await new Promise<string>((resolve, reject) => {
    wx.login({
      success: (result) => (result.code ? resolve(result.code) : reject(new Error("微信登录凭证为空"))),
      fail: reject,
    });
  });
  const result = await request<{
    user: LedgerUser;
    accessToken: string;
    refreshToken: string;
  }>({
    path: "/auth/wechat/session",
    method: "POST",
    auth: false,
    header: { "Content-Type": "application/json" },
    data: { code },
  });
  storeSession({ accessToken: result.accessToken, refreshToken: result.refreshToken });
  restoreAttempted = true;
  const books = await request<{ books: LedgerBook[] }>({ path: "/books" });
  return applyState(result.user, books.books || []);
}

export async function logout() {
  try {
    await request({
      path: "/auth/logout",
      method: "POST",
      header: { "Content-Type": "application/json" },
      data: { refreshToken: storedRefreshToken() },
    });
  } finally {
    clearSession();
    restoreAttempted = true;
    clearState();
  }
}

export function setActiveBook(bookId: string) {
  const app = getApp<IAppOption>();
  const activeBook = app.globalData.books.find((book) => book.id === bookId) || null;
  if (!activeBook) return null;
  wx.setStorageSync(ACTIVE_BOOK_KEY, bookId);
  app.globalData.activeBook = activeBook;
  return activeBook;
}

export async function chooseActiveBook() {
  const state = await ensure();
  if (!state.books.length) return null;
  const selectedIndex = await new Promise<number>((resolve) => {
    wx.showActionSheet({
      itemList: state.books.map((book) => book.name),
      success: ({ tapIndex }) => resolve(tapIndex),
      fail: () => resolve(-1),
    });
  });
  return selectedIndex < 0 ? null : setActiveBook(state.books[selectedIndex].id);
}

export async function requireLogin(redirect?: string) {
  const state = await optionalSession();
  if (state) return state;
  const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
    wx.showModal({
      title: "登录后继续",
      content: "登录后可以同步账本、记账并使用 AI 功能。",
      confirmText: "去登录",
      confirmColor: "#ff681c",
      success: resolve,
    });
  });
  if (result.confirm) {
    const target = redirect ? `?redirect=${encodeURIComponent(redirect)}` : "";
    wx.navigateTo({ url: `/pages/login/index${target}` });
  }
  return null;
}

function clearState() {
  const app = getApp<IAppOption>();
  app.globalData.user = null;
  app.globalData.books = [];
  app.globalData.activeBook = null;
}
