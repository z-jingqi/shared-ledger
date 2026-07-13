import { request } from "../../services/api";
import { chooseActiveBook, optionalSession, requireLogin } from "../../services/session";
import { errorStatus } from "../../utils/error";
import { currency } from "../../utils/format";
import { currentMonth, transactionView, type TransactionView } from "../../utils/transactions";

interface ImportJob {
  id: string;
  status: string;
}

interface HomeData {
  loading: boolean;
  guest: boolean;
  book: LedgerBook | null;
  monthLabel: string;
  total: string;
  expense: string;
  income: string;
  count: number;
  recent: TransactionView[];
  pendingCount: number;
  taskCount: number;
  bookMark: string;
}

Page({
  data: {
    loading: true,
    guest: false,
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
  } as HomeData,

  onShow() {
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
    this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      const state = await optionalSession();
      if (!state) {
        this.setData({ loading: false, guest: true, book: null, recent: [] });
        return;
      }
      const { activeBook: book } = state;
      if (!book) {
        this.setData({ loading: false, book: null });
        return;
      }
      const [transactionResult, importResult] = await Promise.all([
        request<{ transactions: LedgerTransaction[] }>({ path: `/books/${book.id}/transactions` }),
        request<{ imports: ImportJob[] }>({ path: `/books/${book.id}/imports` }).catch(() => ({
          imports: [],
        })),
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
        guest: false,
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
      if (errorStatus(error) === 401) this.setData({ guest: true, book: null });
      this.setData({ loading: false });
    }
  },

  async onBookTap() {
    if (!(await requireLogin("/pages/home/index"))) return;
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

  onAllRecords() {
    wx.switchTab({ url: "/pages/records/index" });
  },

  async onManualRecord() {
    if (!(await requireLogin("/pages/record-form/index"))) return;
    wx.navigateTo({ url: "/pages/record-form/index" });
  },

  async onTasks() {
    if (!(await requireLogin("/pages/imports/index"))) return;
    wx.navigateTo({ url: "/pages/imports/index" });
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/login/index?redirect=%2Fpages%2Fhome%2Findex" });
  },
});
