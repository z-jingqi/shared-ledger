import { request } from "../../services/api";
import { chooseActiveBook, logout, optionalSession, requireLogin } from "../../services/session";
import { errorMessage } from "../../utils/error";

interface Invitation {
  id: string;
  status: string;
}

interface ImportJob {
  id: string;
  status: string;
}

interface SettingsData {
  loading: boolean;
  guest: boolean;
  user: LedgerUser | null;
  book: LedgerBook | null;
  invitationCount: number;
  pendingCount: number;
  taskCount: number;
  profileInitial: string;
  bookMark: string;
}

Page({
  data: {
    loading: true,
    guest: false,
    user: null,
    book: null,
    invitationCount: 0,
    pendingCount: 0,
    taskCount: 0,
    profileInitial: "我",
    bookMark: "账",
  } as SettingsData,

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 3 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      const state = await optionalSession();
      if (!state) {
        this.setData({ loading: false, guest: true, user: null, book: null });
        return;
      }
      const { user, activeBook: book } = state;
      const [invitationResult, importResult] = await Promise.all([
        request<{ invitations: Invitation[] }>({ path: "/invitations/received" }).catch(() => ({
          invitations: [],
        })),
        book
          ? request<{ imports: ImportJob[] }>({ path: `/books/${book.id}/imports` }).catch(() => ({
              imports: [],
            }))
          : Promise.resolve({ imports: [] }),
      ]);
      const jobs = importResult.imports || [];
      this.setData({
        loading: false,
        guest: false,
        user,
        book,
        profileInitial: user && user.name ? user.name.slice(0, 1).toUpperCase() : "我",
        bookMark: book && book.name ? book.name.slice(0, 1) : "账",
        invitationCount: (invitationResult.invitations || []).filter((item) => item.status === "pending")
          .length,
        pendingCount: jobs.filter((job) => job.status === "pending_confirmation").length,
        taskCount: jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)).length,
      });
    } catch {
      this.setData({ loading: false, guest: true, user: null, book: null });
    }
  },

  onNavigate(event: DatasetEvent<{ url?: string }>) {
    const url = event.currentTarget.dataset.url;
    if (url) wx.navigateTo({ url });
  },

  async onBookTap() {
    if (!(await requireLogin("/pages/settings/index"))) return;
    const selected = await chooseActiveBook();
    if (selected) this.loadPage();
  },

  onProfile() {
    wx.navigateTo({ url: "/pages/profile/index" });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/login/index?redirect=%2Fpages%2Fsettings%2Findex" });
  },

  onSubscription() {
    wx.showModal({
      title: this.data.user?.plan === "pro" ? "Pro 权益" : "升级 Pro",
      content:
        this.data.user?.plan === "pro"
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
      const data = await request<Record<string, unknown>>({ path: `/books/${book.id}/export` });
      wx.setClipboardData({
        data: JSON.stringify(data, null, 2),
        success: () => wx.showToast({ title: "数据已复制", icon: "success" }),
      });
    } catch (error) {
      wx.showToast({ title: errorMessage(error, "导出失败"), icon: "none" });
    }
  },

  async onLogout() {
    const result = await new Promise<WechatMiniprogram.ShowModalSuccessCallbackResult>((resolve) => {
      wx.showModal({
        title: "退出登录",
        content: "确定要退出当前账号吗？",
        confirmColor: "#ef5b55",
        success: resolve,
      });
    });
    if (!result.confirm) return;
    await logout();
    wx.switchTab({ url: "/pages/home/index" });
  },
});
