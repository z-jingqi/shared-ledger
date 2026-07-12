const api = require("../../services/api");

Page({
  data: { name: "", email: "", avatarUrl: "", initial: "我", saving: false },

  onLoad() {
    const user = getApp().globalData.user || {};
    this.setData({
      name: user.name || "",
      email: user.email || "",
      avatarUrl: user.avatarUrl || "",
      initial: user.name ? user.name.slice(0, 1).toUpperCase() : "我",
    });
  },

  onName(event) {
    this.setData({ name: event.detail.value });
  },

  onEmail(event) {
    this.setData({ email: event.detail.value });
  },

  async onChooseAvatar(event) {
    const path = event.detail.avatarUrl;
    if (!path) return;
    try {
      const result = await api.upload({
        path: "/auth/me/avatar",
        method: "PUT",
        filePath: path,
        name: "avatar",
      });
      getApp().globalData.user = result.user;
      this.setData({ avatarUrl: result.user.avatarUrl || path });
    } catch (error) {
      wx.showToast({ title: error.message || "头像保存失败", icon: "none" });
    }
  },

  async onSave() {
    if (!this.data.name.trim()) {
      wx.showToast({ title: "请输入用户名", icon: "none" });
      return;
    }
    this.setData({ saving: true });
    try {
      const result = await api.request({
        path: "/auth/me/profile",
        method: "PATCH",
        header: { "Content-Type": "application/json" },
        data: { name: this.data.name.trim(), email: this.data.email.trim() },
      });
      getApp().globalData.user = result.user;
      wx.showToast({ title: "资料已保存", icon: "success" });
      setTimeout(() => wx.navigateBack(), 400);
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },
});
