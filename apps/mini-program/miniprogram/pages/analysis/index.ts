import { request } from "../../services/api";
import { chooseActiveBook, optionalSession, requireLogin } from "../../services/session";
import { errorStatus } from "../../utils/error";
import { currency, ymd } from "../../utils/format";

type AnalysisRange = "week" | "month" | "year";

interface RangeLimits {
  start: string;
  end: string;
}

interface ChartBar {
  label: string;
  expense: number;
  income: number;
  expenseHeight: number;
  incomeHeight: number;
  expenseText: string;
  incomeText: string;
}

interface BreakdownRow {
  name: string;
  value: string;
  width: string;
  color: string;
}

interface Member {
  id: string;
  name: string;
}

interface AnalysisData {
  book: LedgerBook | null;
  loading: boolean;
  guest: boolean;
  range: AnalysisRange;
  transactions: LedgerTransaction[];
  bars: ChartBar[];
  selectedBar: ChartBar | null;
  showExpense: boolean;
  showIncome: boolean;
  expense: string;
  income: string;
  categories: BreakdownRow[];
  members: BreakdownRow[];
  memberSource: Member[];
  bookMark: string;
}

Page({
  data: {
    book: null,
    loading: true,
    guest: false,
    range: "week",
    transactions: [],
    bars: [],
    selectedBar: null,
    showExpense: true,
    showIncome: true,
    expense: "¥0.00",
    income: "¥0.00",
    categories: [],
    members: [],
    memberSource: [],
    bookMark: "账",
  } as AnalysisData,

  onShow() {
    const tabBar = this.getTabBar?.();
    if (tabBar) tabBar.setData({ selected: 2 });
    void this.loadPage();
  },

  async loadPage() {
    this.setData({ loading: true });
    try {
      const state = await optionalSession();
      if (!state) {
        this.setData({
          loading: false,
          guest: true,
          book: { id: "", name: "预览账本", currency: "CNY", incomeEnabled: true },
          transactions: [],
          memberSource: [],
        });
        this.rebuild();
        return;
      }
      const { activeBook: book } = state;
      if (!book) {
        this.setData({ loading: false, book: null });
        return;
      }
      const [transactionResult, memberResult] = await Promise.all([
        request<{ transactions: LedgerTransaction[] }>({ path: `/books/${book.id}/transactions` }),
        request<{ members: Member[] }>({ path: `/books/${book.id}/members` }).catch(() => ({ members: [] })),
      ]);
      this.setData({
        book,
        guest: false,
        bookMark: book.name ? book.name.slice(0, 1) : "账",
        transactions: transactionResult.transactions || [],
        memberSource: memberResult.members || [],
        loading: false,
      });
      this.rebuild();
    } catch (error) {
      if (errorStatus(error) === 401) this.setData({ guest: true });
      this.setData({ loading: false });
    }
  },

  onRange(event: DatasetEvent<{ range: AnalysisRange }>) {
    this.setData({ range: event.currentTarget.dataset.range });
    this.rebuild();
  },

  rebuild() {
    const book = this.data.book;
    if (!book) return;
    const limits = getRange(this.data.range);
    const visible = this.data.transactions.filter((item) => {
      const date = String(item.occurredAt || "").slice(0, 10);
      return date >= limits.start && date <= limits.end;
    });
    const expenseValue = sum(visible, "expense");
    const incomeValue = sum(visible, "income");
    const bars = rangeBars(this.data.range, visible, limits);
    const max = Math.max(1, ...bars.map((item) => Math.max(item.expense, item.income)));
    const categoryMap = groupAmounts(
      visible.filter((item) => item.type === "expense"),
      (item) => item.categoryName || "未分类",
    );
    const memberNames = new Map(this.data.memberSource.map((member) => [member.id, member.name]));
    const memberMap = groupAmounts(
      visible.filter((item) => item.type === "expense"),
      (item) => (item.memberId ? memberNames.get(item.memberId) : undefined) || "我",
    );
    const decorate = (entries: [string, number][], total: number): BreakdownRow[] =>
      entries.slice(0, 5).map(([name, value], index) => ({
        name,
        value: currency(value, book.currency),
        width: `${Math.max(8, Math.round((value / Math.max(1, total)) * 100))}%`,
        color: ["#ff681c", "#ff9160", "#ffb28d", "#f4c3a8", "#d6a98d"][index],
      }));
    const readyBars: ChartBar[] = bars.map((item) => ({
      ...item,
      expenseHeight: Math.max(4, Math.round((item.expense / max) * 100)),
      incomeHeight: Math.max(4, Math.round((item.income / max) * 100)),
      expenseText: currency(item.expense, book.currency),
      incomeText: currency(item.income, book.currency),
    }));
    this.setData({
      expense: currency(expenseValue, book.currency),
      income: currency(incomeValue, book.currency),
      bars: readyBars,
      selectedBar: readyBars[0] || null,
      categories: decorate(
        [...categoryMap.entries()].sort((a, b) => b[1] - a[1]),
        expenseValue,
      ),
      members: decorate(
        [...memberMap.entries()].sort((a, b) => b[1] - a[1]),
        expenseValue,
      ),
    });
  },

  onBar(event: DatasetEvent<{ index: string | number }>) {
    this.setData({ selectedBar: this.data.bars[Number(event.currentTarget.dataset.index)] });
  },

  onToggleExpense() {
    this.setData({ showExpense: !this.data.showExpense });
  },

  onToggleIncome() {
    this.setData({ showIncome: !this.data.showIncome });
  },

  async onBookTap() {
    if (!(await requireLogin("/pages/analysis/index"))) return;
    const selected = await chooseActiveBook();
    if (selected) void this.loadPage();
  },

  onLogin() {
    wx.navigateTo({ url: "/pages/login/index?redirect=%2Fpages%2Fanalysis%2Findex" });
  },
});

function getRange(range: AnalysisRange): RangeLimits {
  const now = new Date();
  if (range === "year") {
    return { start: ymd(new Date(now.getFullYear(), 0, 1)), end: ymd(new Date(now.getFullYear(), 11, 31)) };
  }
  if (range === "month") {
    return {
      start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    };
  }
  const weekday = now.getDay() || 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - weekday + 1);
  return {
    start: ymd(monday),
    end: ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)),
  };
}

function rangeBars(range: AnalysisRange, items: LedgerTransaction[], limits: RangeLimits) {
  if (range === "year") {
    const year = new Date().getFullYear();
    return Array.from({ length: 12 }, (_, month) =>
      bar(
        `${month + 1}月`,
        items.filter((item) => {
          const date = new Date(item.occurredAt);
          return date.getFullYear() === year && date.getMonth() === month;
        }),
      ),
    );
  }
  const startParts = limits.start.split("-").map(Number);
  const start = new Date(startParts[0], startParts[1] - 1, startParts[2]);
  const length = range === "week" ? 7 : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return Array.from({ length }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = ymd(date);
    return bar(
      range === "week" ? labels[index] : `${index + 1}`,
      items.filter((item) => String(item.occurredAt).startsWith(key)),
    );
  });
}

function bar(label: string, items: LedgerTransaction[]) {
  return { label, expense: sum(items, "expense"), income: sum(items, "income") };
}

function sum(items: LedgerTransaction[], type: LedgerTransactionType) {
  return items
    .filter((item) => item.type === type)
    .reduce((total, item) => total + Number(item.amount || 0), 0);
}

function groupAmounts(items: LedgerTransaction[], keyFor: (item: LedgerTransaction) => string) {
  const result = new Map<string, number>();
  items.forEach((item) => {
    const key = keyFor(item);
    result.set(key, (result.get(key) || 0) + Number(item.amount || 0));
  });
  return result;
}
