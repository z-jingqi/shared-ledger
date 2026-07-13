import { request, upload } from "../../services/api";
import { ensure, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

Page({
  data: { name: "", email: "", avatarUrl: "", initial: "我", saving: false },

  async onLoad() {
    if (!(await requireLogin("/pages/profile/index"))) return;
    const { user } = await ensure();
    this.setData({
      name: user.name || "",
      email: user.email || "",
      avatarUrl: user.avatarUrl || "",
      initial: user.name ? user.name.slice(0, 1).toUpperCase() : "我",
    });
  },

  onName(event: InputEvent) {
    this.setData({ name: event.detail.value });
  },

  onEmail(event: InputEvent) {
    this.setData({ email: event.detail.value });
  },

  async onChooseAvatar(event: WechatMiniprogram.CustomEvent<{ avatarUrl: string }>) {
    const path = event.detail.avatarUrl;
    if (!path) return;
    try {
      const result = await upload<{ user: LedgerUser }>({
        path: "/auth/me/avatar",
        method: "PUT",
        filePath: path,
        name: "avatar",
      });
      getApp<IAppOption>().globalData.user = result.user;
      this.setData({ avatarUrl: result.user.avatarUrl || path });
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "头像保存失败"), icon: "none" });
    }
  },

  async onSave() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: "请输入用户名", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const result = await request<{ user: LedgerUser }>({
        path: "/auth/me/profile",
        method: "PATCH",
        header: { "Content-Type": "application/json" },
        data: { name: this.data.name.trim(), email: this.data.email.trim() },
      });
      getApp<IAppOption>().globalData.user = result.user;
      wx.showToast({ title: "资料已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "保存失败"), icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
