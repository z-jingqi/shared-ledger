import { request } from "../../services/api";
import { chooseActiveBook, optionalSession, requireLogin } from "../../services/session";
import { errorStatus } from "../../utils/error";
import { groupTransactions, type TransactionGroup } from "../../utils/transactions";

type RecordFilter = "all" | LedgerTransactionType;

interface RecordsData {
  book: LedgerBook | null;
  loading: boolean;
  guest: boolean;
  query: string;
  type: RecordFilter;
  groups: TransactionGroup[];
  source: LedgerTransaction[];
  bookMark: string;
}

Page({
  data: {
    book: null,
    loading: true,
    guest: false,
    query: "",
    type: "all",
    groups: [],
    source: [],
    bookMark: "账",
  } as RecordsData,

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      const state = await optionalSession();
      if (!state) {
        this.setData({ loading: false, guest: true, book: null, groups: [], source: [] });
        return;
      }
      const { activeBook: book } = state;
      if (!book) {
        this.setData({ loading: false, book: null, groups: [] });
        return;
      }
      const result = await request<{ transactions: LedgerTransaction[] }>({
        path: `/books/${book.id}/transactions`,
      });
      this.setData({
        book,
        guest: false,
        bookMark: book.name ? book.name.slice(0, 1) : "账",
        source: result.transactions || [],
        loading: false,
      });
      this.applyFilters();
    } catch (error) {
      if (errorStatus(error) === 401) this.setData({ guest: true, book: null });
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
    this.setData({ groups: groupTransactions(filtered, this.data.book?.currency || "CNY") });
  },

  onInput(event: InputEvent) {
    this.setData({ query: event.detail.value });
    this.applyFilters();
  },

  onType(event: DatasetEvent<{ type: RecordFilter }>) {
    this.setData({ type: event.currentTarget.dataset.type });
    this.applyFilters();
  },

  async onAiSearch() {
    const query = this.data.query.trim();
    if (!query) {
      wx.showToast({ title: "先输入搜索内容", icon: "none" });
      return;
    }
    if (!(await requireLogin(`/pages/ai/index?mode=search&prompt=${encodeURIComponent(query)}`))) return;
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

  async onBookTap() {
    if (!(await requireLogin("/pages/records/index"))) return;
    const selected = await chooseActiveBook();
    if (selected) this.loadPage();
  },

  async onAiTap() {
    if (!(await requireLogin("/pages/ai/index"))) return;
    wx.navigateTo({ url: "/pages/ai/index" });
  },

  onDetail(event: WechatMiniprogram.CustomEvent<{ id: string }>) {
    wx.navigateTo({ url: `/pages/transaction-detail/index?id=${event.detail.id}` });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/login/index?redirect=%2Fpages%2Frecords%2Findex" });
  },
});
