const api = require("../../services/api");

Page({
  data: { members: [], invitations: [], loading: true },

  onShow() {
    this.loadPage();
  },

  async loadPage() {
    const book = getApp().globalData.activeBook;
    if (!book) return;
    try {
      const [members, invitations] = await Promise.all([
        api.request({ path: `/books/${book.id}/members` }),
        api.request({ path: "/invitations/received" }),
      ]);
      this.setData({
        members: (members.members || []).map((member) => ({
          ...member,
          initial: member.name ? member.name.slice(0, 1) : "成",
        })),
        invitations: invitations.invitations || [],
        loading: false,
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.message || "成员加载失败", icon: "none" });
    }
  },

  async onAccept(event) {
    try {
      await api.request({
        path: `/invitations/${event.currentTarget.dataset.id}/accept`,
        method: "POST",
        header: { "Content-Type": "application/json" },
        data: {},
      });
      wx.showToast({ title: "已加入账本", icon: "success" });
      await this.loadPage();
    } catch (error) {
      wx.showToast({ title: error.message || "接受失败", icon: "none" });
    }
  },
});
