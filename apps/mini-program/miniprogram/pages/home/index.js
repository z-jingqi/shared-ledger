const api = require("../../services/api");
const session = require("../../services/session");
const { currency } = require("../../utils/format");
const { currentMonth, transactionView } = require("../../utils/transactions");

Page({
  data: {
    loading: true,
    book: null,
    monthLabel: "本月记账",
    total: "¥0.00",
    expense: "¥0.00",
    income: "¥0.00",
    count: 0,
    recent: [],
    pendingCount: 0,
    taskCount: 0,
    bookMark: "账",
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      if (!getApp().globalData.activeBook) await session.restore();
      const book = getApp().globalData.activeBook;
      if (!book) {
        this.setData({ loading: false, book: null });
        return;
      }
      const [transactionResult, importResult] = await Promise.all([
        api.request({ path: `/books/${book.id}/transactions` }),
        api.request({ path: `/books/${book.id}/imports` }).catch(() => ({ imports: [] })),
      ]);
      const all = transactionResult.transactions || [];
      const month = currentMonth(all);
      const expenseValue = month
        .filter((item) => item.type === "expense")
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const incomeValue = month
        .filter((item) => item.type === "income")
        .reduce((sum, item) => sum + Number(item.amount), 0);
      const jobs = importResult.imports || [];
      this.setData({
        loading: false,
        book,
        bookMark: book.name ? book.name.slice(0, 1) : "账",
        monthLabel: `${new Date().getMonth() + 1}月记账`,
        total: currency(expenseValue, book.currency),
        expense: currency(expenseValue, book.currency),
        income: currency(incomeValue, book.currency),
        count: month.length,
        recent: all.slice(0, 5).map((item) => transactionView(item, book.currency)),
        pendingCount: jobs.filter((job) => job.status === "pending_confirmation").length,
        taskCount: jobs.filter((job) => !["completed", "failed", "cancelled"].includes(job.status)).length,
      });
    } catch (error) {
      if (error.statusCode === 401) {
        wx.reLaunch({ url: "/pages/login/index" });
        return;
      }
      this.setData({ loading: false });
    }
  },

  onBookTap() {
    const books = getApp().globalData.books || [];
    if (!books.length) return;
    wx.showActionSheet({
      itemList: books.map((book) => book.name),
      success: ({ tapIndex }) => {
        session.setActiveBook(books[tapIndex].id);
        this.loadPage();
      },
    });
  },

  onAiTap() {
    wx.navigateTo({ url: "/pages/ai/index" });
  },

  onDetail(event) {
    wx.navigateTo({ url: `/pages/transaction-detail/index?id=${event.detail.id}` });
  },

  onAllRecords() {
    wx.switchTab({ url: "/pages/records/index" });
  },

  onManualRecord() {
    wx.navigateTo({ url: "/pages/record-form/index" });
  },

  onTasks() {
    wx.navigateTo({ url: "/pages/imports/index" });
  },
});
