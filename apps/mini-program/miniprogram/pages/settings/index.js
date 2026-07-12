const api = require("../../services/api");
const session = require("../../services/session");

Page({
  data: {
    loading: true,
    user: null,
    book: null,
    invitationCount: 0,
    pendingCount: 0,
    taskCount: 0,
    profileInitial: "我",
    bookMark: "账",
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 3 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      if (!getApp().globalData.activeBook) await session.restore();
      const app = getApp();
      const user = app.globalData.user;
      const book = app.globalData.activeBook;
      const [invitationResult, importResult] = await Promise.all([
        api.request({ path: "/invitations/received" }).catch(() => ({ invitations: [] })),
        book
          ? api.request({ path: `/books/${book.id}/imports` }).catch(() => ({ imports: [] }))
          : Promise.resolve({ imports: [] }),
      ]);
      const jobs = importResult.imports || [];
      this.setData({
        loading: false,
        user,
        book,
        profileInitial: user && user.name ? user.name.slice(0, 1).toUpperCase() : "我",
        bookMark: book && book.name ? book.name.slice(0, 1) : "账",
        invitationCount: (invitationResult.invitations || []).filter((item) => item.status === "pending")
          .length,
        pendingCount: jobs.filter((job) => job.status === "pending_confirmation").length,
        taskCount: jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)).length,
      });
    } catch (error) {
      if (error.statusCode === 401) wx.reLaunch({ url: "/pages/login/index" });
      this.setData({ loading: false });
    }
  },

  onNavigate(event) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  onBookTap() {
    const books = getApp().globalData.books || [];
    wx.showActionSheet({
      itemList: books.map((book) => book.name),
      success: ({ tapIndex }) => {
        session.setActiveBook(books[tapIndex].id);
        this.loadPage();
      },
    });
  },

  onProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },

  onSubscription() {
    wx.showModal({
      title: this.data.user.plan === "pro" ? "Pro 权益" : "升级 Pro",
      content:
        this.data.user.plan === "pro"
          ? "当前账号已启用图片识别、批量处理和高级分析。"
          : "升级入口会在接入正式支付后开放；当前不会自动变更套餐。",
      showCancel: false,
      confirmColor: "#ff681c",
    });
  },

  async onExport() {
    const book = this.data.book;
    if (!book) return;
    try {
      const data = await api.request({ path: `/books/${book.id}/export` });
      wx.setClipboardData({
        data: JSON.stringify(data, null, 2),
        success: () => wx.showToast({ title: "数据已复制", icon: "success" }),
      });
    } catch (error) {
      wx.showToast({ title: error.message || "导出失败", icon: "none" });
    }
  },

  async onLogout() {
    const result = await new Promise((resolve) => {
      wx.showModal({
        title: "退出登录",
        content: "确定要退出当前账号吗？",
        confirmColor: "#ef5b55",
        success: resolve,
      });
    });
    if (!result.confirm) return;
    await session.logout();
    wx.reLaunch({ url: "/pages/login/index" });
  },
});
