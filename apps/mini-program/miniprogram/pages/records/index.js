const api = require("../../services/api");
const session = require("../../services/session");
const { groupTransactions } = require("../../utils/transactions");

Page({
  data: {
    book: null,
    loading: true,
    query: "",
    type: "all",
    groups: [],
    source: [],
    bookMark: "账",
  },

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      if (!getApp().globalData.activeBook) await session.restore();
      const book = getApp().globalData.activeBook;
      if (!book) {
        this.setData({ loading: false, book: null, groups: [] });
        return;
      }
      const result = await api.request({ path: `/books/${book.id}/transactions` });
      this.setData({
        book,
        bookMark: book.name ? book.name.slice(0, 1) : "账",
        source: result.transactions || [],
        loading: false,
      });
      this.applyFilters();
    } catch (error) {
      if (error.statusCode === 401) wx.reLaunch({ url: "/pages/login/index" });
      this.setData({ loading: false, groups: [] });
    }
  },

  applyFilters() {
    const query = this.data.query.trim().toLowerCase();
    const filtered = this.data.source.filter((item) => {
      const typeMatches = this.data.type === "all" || item.type === this.data.type;
      const copy = `${item.note || ""} ${item.categoryName || ""} ${item.amount}`.toLowerCase();
      return typeMatches && (!query || copy.includes(query));
    });
    this.setData({ groups: groupTransactions(filtered, this.data.book.currency) });
  },

  onInput(event) {
    this.setData({ query: event.detail.value });
    this.applyFilters();
  },

  onType(event) {
    this.setData({ type: event.currentTarget.dataset.type });
    this.applyFilters();
  },

  onAiSearch() {
    const query = this.data.query.trim();
    if (!query) {
      wx.showToast({ title: "先输入搜索内容", icon: "none" });
      return;
    }
    wx.navigateTo({ url: `/pages/ai/index?mode=search&prompt=${encodeURIComponent(query)}` });
  },

  onFilter() {
    wx.showActionSheet({
      itemList: ["按时间倒序", "按金额从高到低", "清除搜索"],
      success: ({ tapIndex }) => {
        if (tapIndex === 1)
          this.setData({ source: [...this.data.source].sort((a, b) => b.amount - a.amount) });
        if (tapIndex === 2) this.setData({ query: "" });
        this.applyFilters();
      },
    });
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

  onAiTap() {
    wx.navigateTo({ url: "/pages/ai/index" });
  },

  onDetail(event) {
    wx.navigateTo({ url: `/pages/transaction-detail/index?id=${event.detail.id}` });
  },
});
