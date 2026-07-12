const session = require("../../services/session");

Page({
  data: {
    identifier: "",
    password: "",
    submitting: false,
    error: "",
    statusBarHeight: 20,
  },

  onLoad() {
    this.setData({ statusBarHeight: getApp().globalData.chrome.statusBarHeight || 20 });
    session
      .restore()
      .then(() => wx.switchTab({ url: "/pages/home/index" }))
      .catch(() => undefined);
  },

  onIdentifier(event) {
    this.setData({ identifier: event.detail.value, error: "" });
  },

  onPassword(event) {
    this.setData({ password: event.detail.value, error: "" });
  },

  async onSubmit() {
    if (!this.data.identifier.trim() || !this.data.password) {
      this.setData({ error: "请输入用户名和密码" });
      return;
    }
    this.setData({ submitting: true, error: "" });
    try {
      await session.login(this.data.identifier.trim(), this.data.password);
      wx.switchTab({ url: "/pages/home/index" });
    } catch (error) {
      this.setData({ error: error.message || "登录失败" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
