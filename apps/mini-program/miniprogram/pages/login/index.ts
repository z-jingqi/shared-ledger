import { restore, wechatLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

interface LoginData {
  submitting: boolean;
  error: string;
  statusBarHeight: number;
  redirect: string;
}

Page({
  data: {
    submitting: false,
    error: "",
    statusBarHeight: 20,
    redirect: "/pages/home/index",
  } as LoginData,

  onLoad(options: Record<string, string | undefined>) {
    const redirect = safeRedirect(options.redirect);
    this.setData({
      statusBarHeight: getApp<IAppOption>().globalData.chrome.statusBarHeight || 20,
      redirect,
    });
    restore()
      .then(() => this.finishLogin())
      .catch(() => undefined);
  },

  async onWechatLogin() {
    if (this.data.submitting) return;
    this.setData({ submitting: true, error: "" });
    try {
      await wechatLogin();
      this.finishLogin();
    } catch (error) {
      this.setData({ error: errorMessage(error, "微信登录失败，请重试") });
    } finally {
      this.setData({ submitting: false });
    }
  },

  onPreview() {
    wx.switchTab({ url: "/pages/home/index" });
  },

  finishLogin() {
    const tabPages = new Set([
      "/pages/home/index",
      "/pages/records/index",
      "/pages/analysis/index",
      "/pages/settings/index",
    ]);
    if (tabPages.has(this.data.redirect)) wx.switchTab({ url: this.data.redirect });
    else wx.redirectTo({ url: this.data.redirect });
  },
});

function safeRedirect(value?: string) {
  if (!value) return "/pages/home/index";
  try {
    const decoded = decodeURIComponent(value);
    return decoded.startsWith("/pages/") && !decoded.includes("://") ? decoded : "/pages/home/index";
  } catch {
    return "/pages/home/index";
  }
}
